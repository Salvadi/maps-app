// LEGACY: solo rollback/migrazione, non runtime
/**
 * migrate-supabase-to-homeserver.ts
 *
 * Migrazione one-shot: Supabase → homeserver OPImaPPA.
 *
 * Cosa fa:
 *   1. Legge auth.users da Supabase Admin API → inserisce in better-auth
 *      user + account con STESSA UUID (FK preservate) e password scrypt temporanea.
 *   2. Legge ogni tabella applicativa via PostgREST (con paginazione).
 *   3. Inserisce nel homeserver Postgres (UPSERT, skip conflitti).
 *   4. Salta colonne non presenti nel target (schema-v4 vs schema Supabase).
 *
 * ENV richiesti:
 *   SUPABASE_URL              https://tpqgojucydzobrhpdmks.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY  (Dashboard → Settings → API → service_role)
 *   TARGET_DB_URL              postgres://opimappa:<pw>@<host>:5432/opimappa
 *   TEMP_PASSWORD              password temporanea per tutti gli utenti migrati
 *                              (default: OpiTemp2026! — cambiare subito dopo login)
 *
 * Uso (dal root opimappa-server):
 *   SUPABASE_URL=https://... \
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
 *   TARGET_DB_URL=postgres://... \
 *   TEMP_PASSWORD="NuovaPassword!" \
 *   npx tsx scripts/migrate-supabase-to-homeserver.ts
 */

import { randomBytes, scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import postgres from 'postgres';

const scryptAsync = promisify(scrypt);

// ─── Config ─────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/$/, '');
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TARGET_DB_URL = process.env.TARGET_DB_URL;
const TEMP_PASSWORD = process.env.TEMP_PASSWORD ?? 'OpiTemp2026!';

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !TARGET_DB_URL) {
  console.error('ERRORE: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY e TARGET_DB_URL sono obbligatori.');
  process.exit(1);
}

// Tabelle applicative da migrare, in ordine (rispetta FK)
const APP_TABLES = [
  'projects',
  'mapping_entries',
  'structure_entries',
  'typology_prices',
  'floor_plans',
  'floor_plan_points',
  'photos',
  'standalone_maps',
  'sals',
  'dropdown_options',
  'products',
] as const;

// ─── Password scrypt (formato identico a better-auth) ────────────────────────

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const key = await scryptAsync(password.normalize('NFKC'), salt, 64, {
    N: 16384, r: 16, p: 1,
    maxmem: 128 * 16384 * 16 * 2,
  }) as Buffer;
  return `${salt}:${key.toString('hex')}`;
}

// ─── Supabase helpers ────────────────────────────────────────────────────────

function sbHeaders() {
  return {
    'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
    'apikey': SERVICE_ROLE_KEY!,
    'Content-Type': 'application/json',
  };
}

async function fetchUsers(): Promise<SupabaseUser[]> {
  const all: SupabaseUser[] = [];
  let page = 1;
  const perPage = 1000;
  while (true) {
    const url = `${SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=${perPage}`;
    const res = await fetch(url, { headers: sbHeaders() });
    if (!res.ok) throw new Error(`Admin API users: ${res.status} ${await res.text()}`);
    const body = await res.json() as { users: SupabaseUser[] };
    const batch = body.users ?? [];
    all.push(...batch);
    if (batch.length < perPage) break;
    page++;
  }
  return all;
}

interface SupabaseUser {
  id: string;
  email: string;
  created_at: string;
  updated_at: string;
  raw_user_meta_data?: { full_name?: string; name?: string; display_name?: string };
  role?: string;
  banned_until?: string | null;
}

// PostgREST fetch con paginazione
async function fetchTable(table: string): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = [];
  const pageSize = 1000;
  let offset = 0;
  while (true) {
    const url = `${SUPABASE_URL}/rest/v1/${table}?select=*&order=id&limit=${pageSize}&offset=${offset}`;
    const res = await fetch(url, {
      headers: { ...sbHeaders(), 'Prefer': 'count=none' },
    });
    if (!res.ok) {
      const txt = await res.text();
      // Se tabella non esiste su Supabase, skip silenzioso
      if (res.status === 404 || txt.includes('relation') || txt.includes('does not exist')) {
        console.log(`  [skip] ${table} non trovata su Supabase`);
        return [];
      }
      throw new Error(`PostgREST ${table}: ${res.status} ${txt}`);
    }
    const batch = await res.json() as Record<string, unknown>[];
    all.push(...batch);
    if (batch.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}

// ─── Target DB helpers ───────────────────────────────────────────────────────

// Colonne effettive di una tabella sul target
async function getTargetColumns(sql: postgres.Sql, table: string): Promise<Set<string>> {
  const rows = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table}
  `;
  return new Set(rows.map((r) => r.column_name as string));
}

// Upsert batch: inserisce, ignora conflitti su PK
async function upsertRows(
  sql: postgres.Sql,
  table: string,
  rows: Record<string, unknown>[],
  targetCols: Set<string>,
): Promise<number> {
  if (rows.length === 0) return 0;

  // Filtra solo le colonne presenti nel target
  const filtered = rows.map((row) =>
    Object.fromEntries(Object.entries(row).filter(([k]) => targetCols.has(k)))
  );
  // Rimuovi righe completamente vuote
  const valid = filtered.filter((r) => Object.keys(r).length > 0);
  if (valid.length === 0) return 0;

  let inserted = 0;
  const BATCH = 200;
  for (let i = 0; i < valid.length; i += BATCH) {
    const chunk = valid.slice(i, i + BATCH);
    // ON CONFLICT DO NOTHING: idempotente
    await sql`INSERT INTO ${sql(table)} ${sql(chunk)} ON CONFLICT DO NOTHING`;
    inserted += chunk.length;
  }
  return inserted;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== OPImaPPA: Migrazione Supabase → homeserver ===\n');

  const sql = postgres(TARGET_DB_URL!);

  // 1. Hash password temporanea
  console.log(`Hashing password temporanea...`);
  const tempHash = await hashPassword(TEMP_PASSWORD);
  console.log(`  OK (scrypt)\n`);

  // 2. Migrazione utenti
  console.log('Recupero utenti da Supabase Admin API...');
  const sbUsers = await fetchUsers();
  console.log(`  Trovati ${sbUsers.length} utenti\n`);

  let userInserted = 0;
  let accountInserted = 0;

  for (const u of sbUsers) {
    const name =
      u.raw_user_meta_data?.full_name ??
      u.raw_user_meta_data?.name ??
      u.raw_user_meta_data?.display_name ??
      u.email.split('@')[0];

    const isBanned = u.banned_until && new Date(u.banned_until) > new Date();

    // Insert user (stessa UUID Supabase)
    const userRes = await sql`
      INSERT INTO "user" (id, email, name, "emailVerified", "createdAt", "updatedAt", role, active)
      VALUES (
        ${u.id},
        ${u.email},
        ${name},
        true,
        ${u.created_at},
        ${u.updated_at},
        ${u.role === 'service_role' ? 'admin' : 'user'},
        ${!isBanned}
      )
      ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        name = EXCLUDED.name,
        "updatedAt" = EXCLUDED."updatedAt"
      RETURNING id
    `;
    if (userRes.length > 0) userInserted++;

    // Insert account (credential provider)
    const accountRes = await sql`
      INSERT INTO account (id, "userId", "accountId", "providerId", password, "createdAt", "updatedAt")
      VALUES (
        ${`acc_${u.id}`},
        ${u.id},
        ${u.id},
        'credential',
        ${tempHash},
        ${u.created_at},
        ${u.updated_at}
      )
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    `;
    if (accountRes.length > 0) accountInserted++;
  }

  console.log(`Utenti inseriti/aggiornati: ${userInserted}`);
  console.log(`Account credential inseriti: ${accountInserted}\n`);

  // 3. Migrazione tabelle applicative
  console.log('Migrazione tabelle applicative...\n');
  for (const table of APP_TABLES) {
    process.stdout.write(`  ${table}...`);
    try {
      const targetCols = await getTargetColumns(sql, table);
      if (targetCols.size === 0) {
        console.log(' [skip] tabella non esiste nel target');
        continue;
      }
      const rows = await fetchTable(table);
      const inserted = await upsertRows(sql, table, rows, targetCols);
      console.log(` ${inserted}/${rows.length} righe`);
    } catch (err) {
      console.log(` ERRORE: ${(err as Error).message}`);
    }
  }

  await sql.end();

  console.log('\n=== Migrazione completata ===');
  console.log(`\nPASSWORD TEMPORANEA: "${TEMP_PASSWORD}"`);
  console.log('Tutti gli utenti migrati usano questa password.');
  console.log('Cambiare subito dopo il primo login.');
  console.log('\nProssimo step: npx tsx scripts/migrate-storage-urls.ts');
}

main().catch((err) => {
  console.error('\nERRORE FATALE:', err);
  process.exit(1);
});
