import { db, User } from './database';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { syncFromSupabase } from '../sync/syncEngine';

/**
 * Supabase Authentication with offline-first fallback
 *
 * This module provides authentication using Supabase Auth.
 * Offline login only works for re-authentication of users who have
 * previously logged in online (cached session in IndexedDB).
 */

/**
 * Initialize users table (no-op, kept for backward compatibility)
 */
export async function initializeMockUsers(): Promise<void> {
  // No-op: users are now only created via Supabase Auth and cached locally on first login.
  // This function is kept to avoid breaking callers.
}

/**
 * Login with email and password
 * Uses Supabase Auth if configured, falls back to mock auth otherwise
 */
export async function login(email: string, password: string): Promise<User | null> {
  if (isSupabaseConfigured()) {
    try {
      // Supabase authentication
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) {
        console.error('❌ Login error:', error.message);
        return null;
      }

      if (!data.user) {
        return null;
      }

      // Fetch user profile from profiles table
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', data.user.id)
        .single();

      if (profileError) {
        console.error('❌ Profile fetch error:', profileError);
        console.error('❌ Profile fetch error details:', {
          message: profileError.message,
          details: profileError.details,
          hint: profileError.hint,
          code: profileError.code
        });

        // Check if profile doesn't exist
        if (profileError.code === 'PGRST116') {
          console.error('❌ Profile does not exist for user:', data.user.email);
          console.error('💡 The trigger might not have run. Check Supabase Dashboard → Authentication → Users');
          console.error('💡 Manually create the profile or check if the handle_new_user trigger is set up correctly');
        }

        return null;
      }

      if (!profile) {
        console.error('❌ Profile is null for user:', data.user.email);
        return null;
      }

      // Convert Supabase profile to User type
      const user: User = {
        id: profile.id,
        email: profile.email,
        username: profile.username || profile.email.split('@')[0],
        role: profile.role,
        createdAt: new Date(profile.created_at).getTime()
      };

      // Store user in IndexedDB for offline access
      await db.users.put(user);
      await db.metadata.put({ key: 'currentUser', value: user });

      console.log('✅ User logged in (Supabase):', user.email);

      // Sync data from Supabase to local database
      try {
        console.log('⬇️  Starting initial sync from Supabase...');
        const syncResult = await syncFromSupabase();
        console.log(`✅ Initial sync complete: ${syncResult.projectsCount} projects, ${syncResult.entriesCount} entries, ${syncResult.photosCount} photo metadata`);
      } catch (syncErr) {
        console.error('⚠️  Initial sync failed, but login successful:', syncErr);
        // Don't fail the login if sync fails - user can still work offline
      }

      return user;
    } catch (err) {
      console.error('❌ Login exception:', err);
      // Fall back to offline mode if Supabase is unreachable
      return loginOffline(email, password);
    }
  } else {
    // Offline-only mode: only re-authenticate previously cached users
    return loginOffline(email, password);
  }
}

/**
 * Offline login fallback
 * Only allows re-authentication for users who have previously logged in online.
 * This prevents unauthorized access via mock users during Supabase outages.
 */
async function loginOffline(email: string, _password: string): Promise<User | null> {
  console.log('📦 Using offline login');

  // La sessione offline è valida SOLO se Supabase ha una sessione attiva
  // con l'email corrispondente. Senza verifica sessione, chiunque conosca
  // un'email potrebbe autenticarsi su dispositivo condiviso/compromesso.
  if (supabase) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user?.email?.toLowerCase() === email.toLowerCase()) {
        // Sessione valida: recupera i metadati utente dalla cache locale
        const cachedMeta = await db.metadata.get('currentUser');
        const cachedUser = cachedMeta?.value as User | null;
        if (cachedUser && cachedUser.email.toLowerCase() === email.toLowerCase()) {
          console.log('✅ User re-authenticated (offline, valid session):', cachedUser.email);
          return cachedUser;
        }
      }
    } catch (err) {
      console.warn('⚠️ Could not check session for offline login:', err);
    }
  }

  console.warn('⚠️ Offline login failed: no valid cached session for', email);
  return null;
}

/**
 * Sign up a new user (Supabase only)
 */
export async function signUp(email: string, password: string, username: string): Promise<User | null> {
  if (!isSupabaseConfigured()) {
    console.error('❌ Sign up requires Supabase configuration');
    throw new Error('Sign up requires Supabase configuration');
  }

  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}`,
        data: {
          username,
          role: 'user' // Default role
        }
      }
    });

    if (error) {
      console.error('❌ Sign up error:', error.message);
      throw new Error(error.message);
    }

    if (!data.user) {
      throw new Error('Failed to create user account');
    }

    console.log('✅ User signed up:', data.user.email);
    console.log('📧 Confirmation email sent. Please check your inbox.');

    // Return a temporary user object (profile will be created after email confirmation)
    const tempUser: User = {
      id: data.user.id,
      email: data.user.email!,
      username: username,
      role: 'user',
      createdAt: Date.now()
    };

    return tempUser;
  } catch (err) {
    console.error('❌ Sign up exception:', err);
    throw err;
  }
}

/**
 * Get current logged-in user
 * Checks Supabase session first, then falls back to IndexedDB
 */
export async function getCurrentUser(): Promise<User | null> {
  if (isSupabaseConfigured()) {
    try {
      // Check Supabase session
      const { data: { session } } = await supabase.auth.getSession();

      if (session?.user) {
        // Fetch profile
        const { data: profile, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', session.user.id)
          .single();

        if (!error && profile) {
          const user: User = {
            id: profile.id,
            email: profile.email,
            username: profile.username || profile.email.split('@')[0],
            role: profile.role,
            createdAt: new Date(profile.created_at).getTime()
          };

          // Update IndexedDB cache
          await db.metadata.put({ key: 'currentUser', value: user });
          return user;
        }
      }
    } catch (err) {
      console.warn('⚠️  Supabase session check failed, using offline cache:', err);
    }
  }

  // Fall back to IndexedDB (offline mode)
  const metadata = await db.metadata.get('currentUser');
  return metadata?.value || null;
}

/**
 * Check if user is admin
 */
export async function isAdmin(): Promise<boolean> {
  const user = await getCurrentUser();
  return user?.role === 'admin';
}

/**
 * Logout current user
 * Signs out from Supabase and clears local session
 */
export async function logout(): Promise<void> {
  if (isSupabaseConfigured()) {
    try {
      await supabase.auth.signOut();
      console.log('✅ User logged out (Supabase)');
    } catch (err) {
      console.error('❌ Logout error:', err);
    }
  }

  // Clear IndexedDB session
  await db.metadata.put({ key: 'currentUser', value: null });
  console.log('✅ User logged out (local)');
}

/**
 * Get all users (admin only)
 */
export async function getAllUsers(): Promise<User[]> {
  console.log('📥 Fetching all users from Supabase...');

  if (!isSupabaseConfigured()) {
    console.warn('⚠️  Supabase not configured, falling back to local users');
    return await db.users.toArray();
  }

  try {
    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('❌ Fetch users error:', error);
      console.error('❌ Error details:', {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code
      });

      // Return empty array on error (don't fallback to IndexedDB)
      // IndexedDB only has the current user, not all users
      return [];
    }

    if (!profiles || profiles.length === 0) {
      console.warn('⚠️  No profiles found in database');
      return [];
    }

    console.log(`✅ Fetched ${profiles.length} users from Supabase`);

    return profiles.map((p: any) => ({
      id: p.id,
      email: p.email,
      username: p.username || p.email.split('@')[0],
      role: p.role,
      createdAt: new Date(p.created_at).getTime()
    }));
  } catch (err) {
    console.error('❌ Get users exception:', err);

    // Return empty array on exception (don't fallback to IndexedDB)
    return [];
  }
}

/**
 * Create a new user (admin only - Supabase only)
 */
export async function createUser(email: string, role: 'admin' | 'user'): Promise<User> {
  if (!isSupabaseConfigured()) {
    throw new Error('User creation requires Supabase configuration');
  }

  // Note: This requires admin API access or using Supabase Admin SDK
  // For now, users can only be created via sign up
  throw new Error('User creation must be done via sign up or Supabase dashboard');
}

/**
 * Update user role (admin only)
 */
export async function updateUserRole(userId: string, role: 'admin' | 'user'): Promise<void> {
  if (!isSupabaseConfigured()) {
    throw new Error('User role update requires Supabase configuration');
  }

  try {
    const { error } = await supabase
      .from('profiles')
      .update({ role })
      .eq('id', userId);

    if (error) {
      console.error('❌ Update role error:', error.message);
      throw error;
    }

    console.log('✅ User role updated:', userId, role);
  } catch (err) {
    console.error('❌ Update role exception:', err);
    throw err;
  }
}

/**
 * Delete user (admin only)
 */
export async function deleteUser(userId: string): Promise<void> {
  if (!isSupabaseConfigured()) {
    throw new Error('User deletion requires Supabase configuration');
  }

  // Note: Deleting auth users requires Supabase Admin SDK
  // This would only delete the profile, not the auth user
  try {
    const { error } = await supabase
      .from('profiles')
      .delete()
      .eq('id', userId);

    if (error) {
      console.error('❌ Delete user error:', error.message);
      throw error;
    }

    console.log('✅ User deleted:', userId);
  } catch (err) {
    console.error('❌ Delete user exception:', err);
    throw err;
  }
}

/**
 * Listen to auth state changes
 * Useful for keeping the app in sync with Supabase auth state
 */
export function onAuthStateChange(callback: (user: User | null) => void) {
  if (!isSupabaseConfigured()) {
    return { unsubscribe: () => {} };
  }

  const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event: any, session: any) => {
    console.log('🔄 Auth state changed:', event);

    if (session?.user) {
      // Fetch profile
      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .single();

      if (profile) {
        const user: User = {
          id: profile.id,
          email: profile.email,
          username: profile.username || profile.email.split('@')[0],
          role: profile.role,
          createdAt: new Date(profile.created_at).getTime()
        };

        await db.metadata.put({ key: 'currentUser', value: user });
        callback(user);
        return;
      }
    }

    // No session or profile not found
    await db.metadata.put({ key: 'currentUser', value: null });
    callback(null);
  });

  return subscription;
}

/**
 * Send password reset email
 */
export async function sendPasswordResetEmail(email: string): Promise<{ success: boolean; error?: string }> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: 'Password reset requires Supabase configuration' };
  }

  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`
    });

    if (error) {
      console.error('❌ Password reset error:', error.message);
      return { success: false, error: error.message };
    }

    console.log('✅ Password reset email sent to:', email);
    return { success: true };
  } catch (err) {
    console.error('❌ Password reset exception:', err);
    return { success: false, error: 'Failed to send password reset email' };
  }
}

/**
 * Update password (when user clicks reset link)
 */
export async function updatePassword(newPassword: string): Promise<{ success: boolean; error?: string }> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: 'Password update requires Supabase configuration' };
  }

  try {
    const { error } = await supabase.auth.updateUser({
      password: newPassword
    });

    if (error) {
      console.error('❌ Password update error:', error.message);
      return { success: false, error: error.message };
    }

    console.log('✅ Password updated successfully');
    return { success: true };
  } catch (err) {
    console.error('❌ Password update exception:', err);
    return { success: false, error: 'Failed to update password' };
  }
}
