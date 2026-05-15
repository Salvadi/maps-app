import { db, User } from './database';
import { apiFetch } from '../lib/homeserver';
import { syncFromSupabase } from '../sync/syncEngine';

// ============================================
// PBKDF2 offline auth — costanti e helper
// ============================================

const PBKDF2_ITERATIONS = 600_000;
const PBKDF2_HASH = 'SHA-256';
const SALT_BYTES = 16;
const IV_BYTES = 12;
const OFFLINE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 giorni

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: PBKDF2_HASH },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function saveOfflineAuth(email: string, password: string, user: User): Promise<void> {
  try {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const key = await deriveKey(password, salt);
    const plaintext = new TextEncoder().encode(
      JSON.stringify({ user, expiresAt: Date.now() + OFFLINE_TTL_MS })
    );
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
    await db.authCache.put({
      id: email.toLowerCase(),
      email: email.toLowerCase(),
      salt: bytesToBase64(salt),
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
      createdAt: Date.now(),
      expiresAt: Date.now() + OFFLINE_TTL_MS,
    });
  } catch (err) {
    console.warn('⚠️ saveOfflineAuth fallito (non bloccante):', err);
  }
}

// Rate-limit persistito in db.realtimeState (sopravvive a clearDatabase e clearAndSync)
const RATE_LIMIT_KEY = (email: string) => `offline_fails_${email.toLowerCase()}`;

interface OfflineFails { count: number; lastFail: number; }

async function getOfflineFails(email: string): Promise<OfflineFails> {
  const row = await db.realtimeState.get(RATE_LIMIT_KEY(email));
  if (!row) return { count: 0, lastFail: 0 };
  try { return JSON.parse(row.value) as OfflineFails; }
  catch { return { count: 0, lastFail: 0 }; }
}

async function setOfflineFails(email: string, fails: OfflineFails): Promise<void> {
  await db.realtimeState.put({ key: RATE_LIMIT_KEY(email), value: JSON.stringify(fails) });
}

async function clearOfflineFails(email: string): Promise<void> {
  await db.realtimeState.delete(RATE_LIMIT_KEY(email));
}

/**
 * Homeserver Authentication con fallback offline PBKDF2.
 *
 * Autenticazione tramite better-auth (homeserver same-origin).
 * Il login offline funziona solo per ri-autenticare utenti che si sono
 * già loggati online (token cifrato con PBKDF2 in IndexedDB).
 */

/**
 * Initialize users table (no-op, kept for backward compatibility)
 */
export async function initializeMockUsers(): Promise<void> {
  // No-op: users are now only created via Supabase Auth and cached locally on first login.
  // This function is kept to avoid breaking callers.
}

/**
 * Login con email e password tramite homeserver better-auth.
 * Fallback a loginOffline in caso di errore di rete.
 */
export async function login(email: string, password: string): Promise<User | null> {
  try {
    const response = await apiFetch('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => response.status.toString());
      console.error('❌ Login error:', response.status, errText);
      // 5xx → server degradato, fallback offline (consente login con cache PBKDF2).
      // 401/403 → credenziali errate, nessun fallback.
      if (response.status >= 500) {
        return loginOffline(email, password);
      }
      return null;
    }

    const data = await response.json();
    const u = data.user;

    if (!u) {
      console.error('❌ Login: nessun oggetto user nella risposta');
      return null;
    }

    const user: User = {
      id: u.id,
      email: u.email,
      username: u.name || u.email.split('@')[0],
      role: u.role || 'standard',
      createdAt: new Date(u.createdAt).getTime(),
    };

    // Salva in IndexedDB per accesso offline
    await db.users.put(user);
    await db.metadata.put({ key: 'currentUser', value: user });

    // Salva token cifrato con PBKDF2 per il login offline
    await saveOfflineAuth(email, password, user);

    console.log('✅ User logged in (homeserver):', user.email);

    // Sync dati locali
    // TODO sprint7: sostituire con syncFromHomeserver() quando sync engine migrato
    try {
      console.log('⬇️  Avvio sync iniziale...');
      const syncResult = await syncFromSupabase();
      console.log(`✅ Sync iniziale completato: ${syncResult.projectsCount} progetti, ${syncResult.entriesCount} voci, ${syncResult.photosCount} foto`);
    } catch (syncErr) {
      console.error('⚠️  Sync iniziale fallito, login comunque OK:', syncErr);
      // Non bloccare il login se la sync fallisce — l'utente può lavorare offline
    }

    return user;
  } catch (err) {
    console.error('❌ Login exception:', err);
    // HTTP 401/403 = credenziali errate → null (stesso comportamento Supabase)
    // fetch throws = server irraggiungibile → prova login offline
    return loginOffline(email, password);
  }
}

/**
 * Offline login fallback con PBKDF2 (600k iterations, AES-GCM, TTL 7gg).
 * Verifica le credenziali decifrando il token salvato al login online.
 * Include rate-limit locale per prevenire brute-force.
 */
async function loginOffline(email: string, password: string): Promise<User | null> {
  const emailKey = email.toLowerCase();

  // Rate limit persistito: max 5 tentativi falliti, poi backoff esponenziale
  const fails = await getOfflineFails(email);
  if (fails.count >= 5) {
    const cooldown = Math.min(60_000, Math.pow(2, fails.count - 5) * 1000);
    if (Date.now() - fails.lastFail < cooldown) {
      console.warn('⚠️ Offline login: troppi tentativi per', email);
      return null;
    }
  }

  // Prova PBKDF2 decrypt dalla cache locale
  const cached = await db.authCache.get(emailKey);
  if (cached) {
    try {
      const key = await deriveKey(password, base64ToBytes(cached.salt));
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: base64ToBytes(cached.iv) },
        key,
        base64ToBytes(cached.ciphertext)
      );
      const { user, expiresAt } = JSON.parse(new TextDecoder().decode(decrypted));
      if (Date.now() > expiresAt) {
        await db.authCache.delete(emailKey);
        console.warn('⚠️ Offline token scaduto per', email);
        return null;
      }
      await clearOfflineFails(email);
      console.log('✅ Offline login PBKDF2 OK:', email);
      return user as User;
    } catch {
      await setOfflineFails(email, { count: fails.count + 1, lastFail: Date.now() });
      console.warn('⚠️ Offline login: credenziali non valide per', email);
      return null;
    }
  }

  // Fallback: verifica sessione homeserver attiva (nessuna cache PBKDF2 disponibile)
  console.log('📦 Offline login fallback (no cache PBKDF2) per', email);
  try {
    const response = await apiFetch('/api/auth/get-session');
    if (response.ok) {
      const data = await response.json();
      if (data?.user?.email?.toLowerCase() === emailKey) {
        // Sessione valida: recupera i metadati utente dalla cache locale
        const cachedMeta = await db.metadata.get('currentUser');
        const cachedUser = cachedMeta?.value as User | null;
        if (cachedUser && cachedUser.email.toLowerCase() === emailKey) {
          console.log('✅ User re-authenticated (offline, sessione homeserver):', cachedUser.email);
          return cachedUser;
        }
      }
    }
  } catch (err) {
    console.warn('⚠️ Offline login fallback fallito:', err);
  }

  console.warn('⚠️ Offline login fallito: nessuna cache valida per', email);
  return null;
}

/**
 * Registrazione non disponibile: solo admin crea utenti tramite homeserver.
 * // disableSignUp: true sul homeserver — solo admin crea utenti
 */
export async function signUp(email: string, password: string, username: string): Promise<User | null> {
  // disableSignUp: true sul homeserver — solo admin crea utenti
  throw new Error('Registrazione non disponibile: contattare l\'amministratore Opifiresafe');
}

/**
 * Recupera l'utente corrente.
 * Prima tenta la sessione homeserver, poi cade su IndexedDB.
 */
export async function getCurrentUser(): Promise<User | null> {
  try {
    const response = await apiFetch('/api/auth/get-session');

    if (response.ok) {
      const data = await response.json();
      const u = data?.user;

      if (u) {
        const user: User = {
          id: u.id,
          email: u.email,
          username: u.name || u.email.split('@')[0],
          role: u.role || 'standard',
          createdAt: new Date(u.createdAt).getTime(),
        };

        // Aggiorna cache IndexedDB
        await db.metadata.put({ key: 'currentUser', value: user });
        return user;
      }
    }
  } catch (err) {
    console.warn('⚠️  Controllo sessione homeserver fallito, uso cache offline:', err);
  }

  // Fallback IndexedDB (modalità offline)
  const metadata = await db.metadata.get('currentUser');
  return metadata?.value || null;
}

/**
 * Verifica se l'utente corrente è admin
 */
export async function isAdmin(): Promise<boolean> {
  const user = await getCurrentUser();
  return user?.role === 'admin';
}

/**
 * Logout: chiama homeserver sign-out e pulisce la sessione locale.
 * Pulisce lo stato locale anche in caso di errore di rete.
 */
export async function logout(): Promise<void> {
  try {
    await apiFetch('/api/auth/sign-out', { method: 'POST' });
    console.log('✅ User logged out (homeserver)');
  } catch (err) {
    console.error('❌ Logout error (rete), pulizia locale comunque:', err);
  }

  // Pulisci sessione IndexedDB
  await db.metadata.put({ key: 'currentUser', value: null });
  console.log('✅ User logged out (local)');
}

/**
 * Recupera tutti gli utenti (solo admin) tramite better-auth admin plugin.
 */
export async function getAllUsers(): Promise<User[]> {
  console.log('📥 Recupero utenti da homeserver...');

  try {
    const response = await apiFetch('/api/auth/admin/list-users?limit=100&offset=0');

    if (!response.ok) {
      console.error('❌ Fetch users error:', response.status);
      return [];
    }

    const data = await response.json();
    const users: any[] = data?.users ?? [];

    if (users.length === 0) {
      console.warn('⚠️  Nessun utente trovato');
      return [];
    }

    console.log(`✅ Recuperati ${users.length} utenti da homeserver`);

    return users.map((u: any) => ({
      id: u.id,
      email: u.email,
      username: u.name || u.email.split('@')[0],
      role: u.role || 'standard',
      createdAt: new Date(u.createdAt).getTime(),
    }));
  } catch (err) {
    console.error('❌ Get users exception:', err);
    return [];
  }
}

/**
 * Crea un nuovo utente (admin only — non implementato in questo client)
 */
export async function createUser(email: string, role: 'admin' | 'user'): Promise<User> {
  // Note: This requires admin API access or using Supabase Admin SDK
  // For now, users can only be created via sign up
  throw new Error('User creation must be done via sign up or Supabase dashboard');
}

/**
 * Aggiorna il ruolo di un utente (solo admin) tramite better-auth admin plugin.
 */
export async function updateUserRole(userId: string, role: 'admin' | 'user'): Promise<void> {
  try {
    const response = await apiFetch('/api/auth/admin/set-role', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, role }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => response.status.toString());
      console.error('❌ Update role error:', errText);
      throw new Error(`Operazione fallita (${response.status})`);
    }

    console.log('✅ Ruolo utente aggiornato:', userId, role);
  } catch (err) {
    console.error('❌ Update role exception:', err);
    throw err;
  }
}

/**
 * Elimina un utente (solo admin) tramite better-auth admin plugin.
 */
export async function deleteUser(userId: string): Promise<void> {
  try {
    const response = await apiFetch('/api/auth/admin/remove-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => response.status.toString());
      console.error('❌ Delete user error:', errText);
      throw new Error(`Operazione fallita (${response.status})`);
    }

    console.log('✅ Utente eliminato:', userId);
  } catch (err) {
    console.error('❌ Delete user exception:', err);
    throw err;
  }
}

/**
 * Ascolta i cambiamenti di stato auth.
 * Nessun subscriber attivo — stub per compatibilità futura.
 */
export function onAuthStateChange(callback: (user: User | null) => void) {
  // Nessun subscriber attivo — stub per compatibilità futura
  return { unsubscribe: () => {} };
}

/**
 * Invia email di reset password.
 * Non supportato sul homeserver — stub per compatibilità.
 */
export async function sendPasswordResetEmail(email: string): Promise<{ success: boolean; error?: string }> {
  return { success: false, error: 'Reset password non disponibile: contattare l\'amministratore Opifiresafe' };
}

/**
 * Aggiorna la password (quando l'utente clicca il link di reset).
 * Non supportato sul homeserver — stub per compatibilità.
 */
export async function updatePassword(newPassword: string): Promise<{ success: boolean; error?: string }> {
  return { success: false, error: 'Aggiornamento password non disponibile: contattare l\'amministratore Opifiresafe' };
}
