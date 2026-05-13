# OPImaPPA — Piano v4.1 surgical patch

**Base:** `homeserver-opimappa-plan-v4.md`
**Scope:** patch chirurgico fix critical da `docs/homeserver-opimappa-plan-v4-critical-review.md`
**Data:** 2026-05-12

Non rewrite completa. Solo sezioni modificate. Applica sopra v4 leggendo entrambi.

---

## Fix C1 — `drainSince` corretto con `lastDrainedSeq`

**Sostituisce §8 v4 "Hono SSE endpoint" blocco `drainSince`.**

```ts
// api/src/realtime/listener.ts
let lastDrainedSeq = 0;    // cursor inizializzato all'avvio (vedi C2)
let lastNotifiedSeq = 0;

async function initListener() {
  // C2: inizializza da DB, NON da 0
  const [{ max_seq }] = await db.execute(sql`SELECT COALESCE(max(seq), 0)::bigint AS max_seq FROM change_log`);
  lastDrainedSeq = max_seq;
  lastNotifiedSeq = max_seq;
  logger.info({ startSeq: max_seq }, 'listener init');
  startListener();
}

async function drainUntil(targetSeq: bigint) {
  while (lastDrainedSeq < targetSeq) {
    const rows = await db.execute(sql`
      SELECT seq, table_name, row_id, op, project_id, user_id, originator
      FROM change_log
      WHERE seq > ${lastDrainedSeq} AND seq <= ${targetSeq}
      ORDER BY seq ASC
      LIMIT 1000
    `);
    if (rows.length === 0) break;
    
    await dispatchRows(rows);
    lastDrainedSeq = BigInt(rows[rows.length - 1].seq);
  }
}

async function startListener() {
  while (true) {
    try {
      listenSql = postgres(DATABASE_URL, { max: 1, idle_timeout: 0 });
      await listenSql.listen('opimappa_changes', async (raw) => {
        const seq = BigInt(raw);
        if (seq <= lastNotifiedSeq) return;
        lastNotifiedSeq = seq;
        await drainUntil(seq);
      });
      
      // Su reconnect: drain delta accumulato durante outage
      const [{ max_seq }] = await db.execute(sql`SELECT COALESCE(max(seq), 0)::bigint AS max_seq FROM change_log`);
      if (BigInt(max_seq) > lastDrainedSeq) await drainUntil(BigInt(max_seq));
      
      broadcastSystem({ type: 'reconnected', seq: lastNotifiedSeq.toString() });
      
      await new Promise<void>((resolve) => { listenSql!.options.onclose = () => resolve(); });
    } catch (e) {
      logger.error({ err: e }, 'pg LISTEN fail');
    } finally {
      try { await listenSql?.end({ timeout: 1 }); } catch {}
      listenSql = null;
      broadcastSystem({ type: 'connection_lost' });
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

initListener();
```

**Test obbligatori:**
- Avvia API con `change_log` già contenente 100 righe → `lastDrainedSeq == 100`, no duplicati al primo notify
- Inserisci 50 righe rapidamente → `drainUntil` processa esattamente 50, non riprocessa primi 100

---

## Fix C2 — `lastNotifiedSeq` init da `max(seq)`

Coperto in C1 sopra (`initListener` legge `SELECT max(seq)` all'avvio).

---

## Fix C3 — separa `serverSeenSeq` vs `appliedSeq`

**Sostituisce §7 v4 "Response shape" + §8 v4 "Client EventStream".**

### Response API

Header HTTP rinominato:
- `X-Server-Seq` → `X-Server-Seen-Seq` (semantica: max seq corrente server, **info only**, NON usare come cursor catch-up)

### Client

```ts
class EventStream {
  // CURSOR DI APPLICAZIONE — unico campo usato per /api/changes?sinceSeq=
  private appliedSeq = 0n;
  
  // Hint server (info-only, no cursor decision)
  private serverSeenSeq = 0n;
  
  // Restore appliedSeq from Dexie
  async init() {
    const row = await db.realtimeState.get('appliedSeq');
    this.appliedSeq = row ? BigInt(row.value) : 0n;
  }
  
  start() {
    // sinceSeq SEMPRE da appliedSeq, mai da serverSeenSeq
    const url = `/api/events/stream?sinceSeq=${this.appliedSeq}`;
    // ... resto invariato
  }
  
  // Hint update separato, no persist
  updateServerSeenHint(seq: bigint) {
    if (seq > this.serverSeenSeq) this.serverSeenSeq = seq;
  }
}
```

### Fix C4 (correlato) — `applyEvent` unified path

```ts
class EventStream {
  // UNICO path applicazione evento → SSE live + catch-up + polling fallback
  private async applyEvent(ev: ChangeLogRow) {
    // 1. Notifica listener (fire-and-await side effects sync)
    for (const fn of this.listeners) {
      try { await fn(ev); } catch (e) { console.warn('listener error', e); }
    }
    
    // 2. Persist appliedSeq solo DOPO listener completati
    const seq = BigInt(ev.seq);
    if (seq > this.appliedSeq) {
      this.appliedSeq = seq;
      await db.realtimeState.put({ key: 'appliedSeq', value: ev.seq });
    }
  }
  
  // Flush dei pending coalesced
  private async flush() {
    this.flushTimer = null;
    const events = Array.from(this.pendingByKey.values()).sort((a, b) => Number(a.seq - b.seq));
    this.pendingByKey.clear();
    for (const ev of events) await this.applyEvent(ev);
  }
  
  // Catch-up usa STESSO applyEvent path
  private async catchUp() {
    if (this.appliedSeq === 0n) return;
    try {
      const res = await fetch(`/api/changes?sinceSeq=${this.appliedSeq}`, { credentials: 'include' });
      
      // H2: gestisci cursor_expired
      if (res.status === 410) {
        const { error, fullResyncRequired } = await res.json();
        if (fullResyncRequired) await this.handleCursorExpired();
        return;
      }
      
      const { data } = await res.json();
      for (const ev of data ?? []) await this.applyEvent(ev);
    } catch {}
  }
  
  // H2: cursor expired → full resync senza perdere pending writes
  private async handleCursorExpired() {
    // 1. Salva pending writes Dexie
    const pending = await db.syncQueue.where('synced').equals(0).toArray();
    // 2. clearAndSync (preserva queue)
    await clearAndSyncPreservingQueue();
    // 3. Reset appliedSeq al max corrente server
    const res = await fetch('/api/changes/head', { credentials: 'include' });
    const { currentSeq } = await res.json();
    this.appliedSeq = BigInt(currentSeq);
    await db.realtimeState.put({ key: 'appliedSeq', value: currentSeq });
  }
}
```

---

## Fix C5 — `profiles` view: INSTEAD OF DELETE + UUID enforcement

**Aggiunge a §6 v4 "Compat layer `profiles`".**

```sql
-- Force UUID id su better-auth user (CHECK constraint)
ALTER TABLE "user" ADD CONSTRAINT user_id_uuid_format
  CHECK (id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');

-- INSTEAD OF DELETE (mancante in v4)
CREATE OR REPLACE FUNCTION profiles_delete() RETURNS trigger AS $$
BEGIN
  -- Delega a better-auth admin: marca utente come inactive invece di hard delete
  -- (hard delete fa partire cleanup_accessible_users trigger)
  DELETE FROM "user" WHERE id = OLD.id::text;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_delete_trg
  INSTEAD OF DELETE ON profiles
  FOR EACH ROW EXECUTE FUNCTION profiles_delete();
```

### better-auth force UUID id

```ts
// api/src/auth/config.ts
import { randomUUID } from 'crypto';

export const auth = betterAuth({
  // ... resto config v4
  advanced: {
    // ... resto
    generateId: () => randomUUID()   // force UUID v4 string
  }
});
```

**Test:**
```ts
it('better-auth user id is UUID format', async () => {
  const u = await auth.api.signUpEmail({ email: 't@t.io', password: 'xxx', name: 'T' });
  expect(u.id).toMatch(/^[0-9a-f-]{36}$/);
});

it('profiles view full CRUD via shim', async () => {
  // create via admin/create-user
  // select via from('profiles').select()
  // update via from('profiles').update({...}).eq('id', x)
  // delete via from('profiles').delete().eq('id', x)
});
```

---

## Fix C6 — Parser PostgREST trim + dotted filter

**Sostituisce §7 v4 "Query parser" `parseSelect`.**

```ts
function parseSelect(raw: string | null, schema: TableSchema): SelectPlan {
  if (!raw || raw === '*') return { cols: '*', joins: [] };
  
  const parts = raw.split(',').map(s => s.trim());   // C6: trim obbligatorio
  const cols: string[] = [];
  const joins: JoinPlan[] = [];
  
  for (const part of parts) {
    const joinMatch = part.match(/^(\w+)!(inner|left)\((.*)\)$/);
    if (joinMatch) {
      const [, relName, joinType, subColsRaw] = joinMatch;
      const rel = schema.relationships?.[relName];
      if (!rel) throw httpError(400, `unknown relation: ${relName}`);
      const subCols = subColsRaw.split(',').map(s => s.trim());
      joins.push({ relation: rel, type: joinType as 'inner' | 'left', cols: subCols });
    } else {
      if (!schema.columns[part]) throw httpError(400, `unknown col: ${part}`);
      cols.push(part);
    }
  }
  return { cols, joins };
}

// Dotted filter: `mapping_entries.project_id=eq.<id>`
function parseFilters(params: URLSearchParams, schema: TableSchema): SQL[] {
  const filters: SQL[] = [];
  for (const [key, raw] of params) {
    if (['select', 'order', 'limit', 'count', 'head'].includes(key)) continue;
    
    const [op, ...rest] = raw.split('.');
    if (!ALLOWED_OPS.has(op)) throw httpError(400, `unknown op: ${op}`);
    
    // Dotted filter su relationship
    if (key.includes('.')) {
      const [relName, relCol] = key.split('.');
      const rel = schema.relationships?.[relName];
      if (!rel) throw httpError(400, `unknown relation in filter: ${relName}`);
      const relSchema = TABLE_SCHEMA[rel.target];
      if (!relSchema.columns[relCol]) throw httpError(400, `unknown col on ${relName}: ${relCol}`);
      filters.push(buildJoinFilter(rel, relCol, op, rest.join('.')));
      continue;
    }
    
    if (!schema.columns[key]) throw httpError(400, `unknown col: ${key}`);
    filters.push(buildFilter(key, schema.columns[key], op, rest.join('.')));
  }
  return filters;
}
```

### HEAD count exact con join — Content-Range

```ts
app.get('/api/:table', async (c) => {
  const { table } = c.req.param();
  const { select, filters, head, count } = parseQuery(table, new URL(c.req.url).searchParams);
  
  // Costruisci query Drizzle con JOIN se richiesto
  const query = buildQuery(table, select, filters);
  
  if (head && count === 'exact') {
    const totalQuery = buildCountQuery(table, select.joins, filters);
    const [{ count: total }] = await db.execute(totalQuery);
    return c.body(null, 200, {
      'Content-Range': `0-0/${total}`,
      'X-Server-Seen-Seq': lastNotifiedSeq.toString()
    });
  }
  
  const rows = await db.execute(query);
  return c.json({ data: rows, error: null }, 200, { 'X-Server-Seen-Seq': lastNotifiedSeq.toString() });
});
```

**Test esatto call site reale (mappings.ts:729):**

```ts
it('select join inner with dotted filter and count head', async () => {
  const projectId = '<uuid>';
  const res = await apiClient
    .from('photos')
    .select('id, mapping_entries!inner(id)', { count: 'exact', head: true })
    .eq('mapping_entries.project_id', projectId);
  
  expect(res.error).toBeNull();
  expect(typeof res.count).toBe('number');
  expect(res.data).toBeNull();
});
```

---

## Fix C7 — Storage URL strategy con path canonicali

**Sostituisce §10 v4 "Fase D — storage migration".**

### Strategia: path canonicali in DB, URL runtime

**Decisione:** mai persistere URL pubblici in DB. Tutte le colonne URL diventano **path canonicali** (`bucket/path`). URL signed generato a runtime dallo shim/API.

### Schema migration

```sql
-- Aggiungi colonne *_storage_path consistenti
ALTER TABLE floor_plans 
  ADD COLUMN IF NOT EXISTS image_storage_path TEXT,
  ADD COLUMN IF NOT EXISTS thumbnail_storage_path TEXT,
  ADD COLUMN IF NOT EXISTS pdf_storage_path TEXT;

ALTER TABLE standalone_maps
  ADD COLUMN IF NOT EXISTS image_storage_path TEXT,
  ADD COLUMN IF NOT EXISTS thumbnail_storage_path TEXT,
  ADD COLUMN IF NOT EXISTS pdf_storage_path TEXT;

-- photos già ha storage_path, thumbnail_storage_path
```

### Migrazione script — estrazione path robusta

```ts
// scripts/migrate-storage-urls.ts
// Pattern URL Supabase da gestire:
//   https://xxx.supabase.co/storage/v1/object/public/<bucket>/<path>
//   https://xxx.supabase.co/storage/v1/object/sign/<bucket>/<path>?token=...
//   <bucket>/<path>  (legacy: già path-like)
//   <path>           (relativo, bucket implicito)

const PATTERNS = [
  /\/storage\/v1\/object\/(?:public|sign)\/([^?]+)/,
  /^([a-z_-]+\/.+)$/i,  // bucket/path già canonico
];

function extractPath(rawUrl: string | null, defaultBucket: string): string | null {
  if (!rawUrl) return null;
  for (const re of PATTERNS) {
    const m = rawUrl.match(re);
    if (m) {
      const path = m[1];
      // Se non inizia con bucket noto, prefix bucket default
      if (!path.match(/^(photos|planimetrie)\//)) return `${defaultBucket}/${path}`;
      return path;
    }
  }
  // Fallback: assume relativo, prefix bucket
  return `${defaultBucket}/${rawUrl}`;
}

// Popolamento colonne canonical
await sql`
  UPDATE floor_plans SET
    image_storage_path     = ${sql.unsafe('coalesce(image_storage_path, ' + extractPathFn() + '(image_url, \'planimetrie\'))')},
    thumbnail_storage_path = ${sql.unsafe('coalesce(thumbnail_storage_path, ' + extractPathFn() + '(thumbnail_url, \'planimetrie\'))')},
    pdf_storage_path       = ${sql.unsafe('coalesce(pdf_storage_path, ' + extractPathFn() + '(pdf_url, \'planimetrie\'))')}
`;

// Stesso per standalone_maps, photos
```

Più pratico in TypeScript loop:

```ts
for (const row of await sql`SELECT id, image_url, thumbnail_url, pdf_url FROM floor_plans`) {
  await sql`
    UPDATE floor_plans SET
      image_storage_path = ${extractPath(row.image_url, 'planimetrie')},
      thumbnail_storage_path = ${extractPath(row.thumbnail_url, 'planimetrie')},
      pdf_storage_path = ${extractPath(row.pdf_url, 'planimetrie')}
    WHERE id = ${row.id}
  `;
}
```

### Frontend impact

Shim `getPublicUrl(path)` ritorna ora **internal proxy URL** valido dell'API:

```ts
// apiClient.storage.from(bucket).getPublicUrl(path)
getPublicUrl(path: string) {
  // Se path già contiene bucket (canonical): /api/storage/{path}
  // Se no: /api/storage/{bucket}/{path}
  const url = path.match(/^(photos|planimetrie)\//)
    ? `/api/storage/${path}`
    : `/api/storage/${bucket}/${path}`;
  return { data: { publicUrl: url } };
}

// apiClient.storage.from(bucket).createSignedUrl(path, ttl)
async createSignedUrl(path: string, ttl: number) {
  const res = await fetch('/api/storage/sign-one', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify({ bucket, path, ttl })
  });
  const { signedUrl } = await res.json();
  return { data: { signedUrl }, error: null };
}
```

**Test storage:**

```ts
it('extractPath handles Supabase public URL', () => {
  expect(extractPath('https://x.supabase.co/storage/v1/object/public/photos/abc/def.jpg', 'photos'))
    .toBe('photos/abc/def.jpg');
});

it('extractPath handles signed URL', () => {
  expect(extractPath('https://x.supabase.co/storage/v1/object/sign/planimetrie/x.pdf?token=eyJ', 'planimetrie'))
    .toBe('planimetrie/x.pdf');
});

it('extractPath handles legacy path-only', () => {
  expect(extractPath('photos/abc/def.jpg', 'photos')).toBe('photos/abc/def.jpg');
});

it('extractPath handles bare filename', () => {
  expect(extractPath('def.jpg', 'photos')).toBe('photos/def.jpg');
});
```

---

## Fix C8 — Reverse-delta ordinato per `seq`, freeze fino a delta done

**Sostituisce §16 v4 "Reverse-delta script".**

```ts
// scripts/reverse-delta-supabase.ts
import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';

const local = postgres(LOCAL_DATABASE_URL);
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const CUTOVER_TS = process.argv[2];  // ISO timestamp

// C8: prendi TUTTI gli eventi ordinati per seq, non DISTINCT per row
// Compatti dopo: per (table, row_id) prendi solo l'ultimo evento per ridurre lavoro,
// MA mantieni ordine globale per FK consistency
const allEvents = await local`
  SELECT seq, table_name, row_id, op, project_id, user_id
  FROM change_log
  WHERE changed_at > ${CUTOVER_TS}
  ORDER BY seq ASC
`;

// Compattazione: per ogni (table, row_id), trova ultimo evento. Conserva ordine relativo del primo.
const lastByKey = new Map<string, typeof allEvents[number]>();
const orderedKeys: string[] = [];
for (const ev of allEvents) {
  const key = `${ev.table_name}:${ev.row_id}`;
  if (!lastByKey.has(key)) orderedKeys.push(key);
  lastByKey.set(key, ev);
}

// Applica in ordine: parent tabelle prima (projects → mapping/structure → photos/floor_plans → floor_plan_points)
const TABLE_ORDER: Record<string, number> = {
  'projects': 1,
  'mapping_entries': 2,
  'structure_entries': 2,
  'floor_plans': 2,
  'standalone_maps': 2,
  'sals': 3,
  'typology_prices': 3,
  'photos': 4,
  'floor_plan_points': 4,
  'dropdown_options': 0,
  'products': 0,
};

orderedKeys.sort((a, b) => {
  const evA = lastByKey.get(a)!;
  const evB = lastByKey.get(b)!;
  const tA = TABLE_ORDER[evA.table_name] ?? 99;
  const tB = TABLE_ORDER[evB.table_name] ?? 99;
  if (tA !== tB) return tA - tB;
  return Number(evA.seq - evB.seq);
});

for (const key of orderedKeys) {
  const ev = lastByKey.get(key)!;
  
  if (ev.op === 'DELETE') {
    await sb.from(ev.table_name).delete().eq('id', ev.row_id);
  } else {
    const [record] = await local`SELECT * FROM ${local(ev.table_name)} WHERE id = ${ev.row_id}`;
    if (record) {
      await sb.from(ev.table_name).upsert(record);
    } else {
      // Riga non più presente: probabilmente delete arrivato in mezzo. Tratta come delete.
      await sb.from(ev.table_name).delete().eq('id', ev.row_id);
    }
  }
}

// Storage reverse sync esplicito (non commentato come v4)
await reverseStorageSync(CUTOVER_TS);

async function reverseStorageSync(cutoverTs: string) {
  for (const table of ['photos', 'floor_plans', 'standalone_maps']) {
    const rows = await local`
      SELECT DISTINCT row_id FROM change_log
      WHERE table_name = ${table} AND changed_at > ${cutoverTs}
        AND op IN ('INSERT', 'UPDATE')
    `;
    for (const { row_id } of rows) {
      // Per ogni row, copia tutti i path storage in Supabase
      // ... logica specifica per tabella (recupera storage_path/_url, scarica MinIO, upload Supabase)
    }
  }
}
```

### Procedura rollback (revisione H4 + C8)

```
T+0   Anomalia rilevata
T+1m  Decisione rollback
T+2m  Frontend: messaggio "manutenzione in corso, 15min" — disabilita scrittura
T+3m  Esegui reverse-delta-supabase.ts (Supabase STA ANCORA in freeze, scritture bloccate)
T+10m Reverse-delta done, verifica row counts e hash storage
T+11m Re-enable Supabase write (riapplica grant)
T+12m DNS swap → Vercel
T+13m Frontend rebuild REACT_APP_BACKEND=supabase, deploy Vercel
T+15m Comunica utenti reload
```

Importante: **Supabase resta in freeze TUTTO il tempo del reverse-delta**. Niente scritture mid-flight.

---

## Fix C9 — Write-freeze completo (anon + authenticated + storage)

**Sostituisce §16 v4 "Pre-cutover" + script freeze.**

```sql
-- scripts/supabase-freeze.sql
-- Esegui via Supabase SQL Editor durante cutover

-- 1. Revoca scritture role anon
REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM anon;

-- 2. Revoca scritture role authenticated (CRITICO, mancante v4)
REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM authenticated;

-- 3. Disabilita RLS policies di scrittura: sostituisci tutte con NULL using clause
-- Più pratico: aggiungi policy globale di blocco a priorità massima
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY[
    'projects','mapping_entries','structure_entries','photos','floor_plans',
    'floor_plan_points','standalone_maps','sals','typology_prices',
    'dropdown_options','products','profiles'
  ] LOOP
    EXECUTE format('
      CREATE POLICY "cutover_freeze_block_writes" ON %I
      AS RESTRICTIVE
      FOR INSERT, UPDATE, DELETE
      TO public
      USING (false) WITH CHECK (false);
    ', t);
  END LOOP;
END $$;

-- 4. Storage policies: blocca insert/update/delete su entrambi bucket
CREATE POLICY "cutover_storage_freeze_photos" ON storage.objects
  AS RESTRICTIVE
  FOR INSERT, UPDATE, DELETE
  TO public
  USING (bucket_id = 'photos' AND false);

CREATE POLICY "cutover_storage_freeze_planimetrie" ON storage.objects
  AS RESTRICTIVE
  FOR INSERT, UPDATE, DELETE
  TO public
  USING (bucket_id = 'planimetrie' AND false);
```

### Script unfreeze (rollback emergenza)

```sql
-- scripts/supabase-unfreeze.sql
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY[
    'projects','mapping_entries','structure_entries','photos','floor_plans',
    'floor_plan_points','standalone_maps','sals','typology_prices',
    'dropdown_options','products','profiles'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "cutover_freeze_block_writes" ON %I', t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "cutover_storage_freeze_photos" ON storage.objects;
DROP POLICY IF EXISTS "cutover_storage_freeze_planimetrie" ON storage.objects;

GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated;
```

### Test freeze pre-cutover

```ts
// scripts/test-freeze.ts
// Esegui dopo applicare supabase-freeze.sql in ambiente test

const sb = createClient(SUPABASE_URL, ANON_KEY);

// Login utente reale
await sb.auth.signInWithPassword({ email: 'test@x.io', password: 'xxx' });

// Tentativo INSERT (deve fallire con 42501 o policy violation)
const { error: insertErr } = await sb.from('projects').insert({ title: 'test', owner_id: 'x' });
assert(insertErr !== null, 'INSERT non bloccato dal freeze');

// Tentativo storage upload (deve fallire)
const { error: upErr } = await sb.storage.from('photos').upload('test.jpg', new Blob(['x']));
assert(upErr !== null, 'Storage upload non bloccato dal freeze');

// SELECT deve funzionare (read-only)
const { data, error: selErr } = await sb.from('projects').select('id').limit(1);
assert(selErr === null, 'SELECT bloccato da freeze (errato)');
```

Test obbligatorio in ambiente Supabase staging prima del cutover reale.

---

## Fix H1 — Rate limit middleware body clone

```ts
async function loginRateLimit(c: Context, next) {
  // Clone request prima di leggere body (Hono: c.req.raw è Request standard)
  const cloned = c.req.raw.clone();
  let body;
  try {
    body = await cloned.json();
  } catch {
    return c.json({ error: 'invalid body' }, 400);
  }
  
  const email = body.email?.toLowerCase();
  if (!email) return c.json({ error: 'email required' }, 400);
  
  const ip = c.req.header('CF-Connecting-IP') ?? 'unknown';
  const key = `login:${ip}:${email}`;
  
  const fails = await getFailCount(key);
  if (fails >= 3) await sleep(Math.min(60_000, (2 ** (fails - 3)) * 1000));
  if (fails >= 10) {
    const cfToken = c.req.header('CF-Turnstile-Token');
    if (!cfToken || !(await verifyTurnstile(cfToken))) {
      return c.json({ error: 'captcha_required' }, 429);
    }
  }
  
  await next();
  
  if (c.res.status >= 400) await incrFailCount(key);
  else await resetFailCount(key);
}
```

---

## Fix H2 — Cursor expired response

**Aggiunge a §7 v4 "API REST design".**

```ts
const CHANGE_LOG_RETENTION_DAYS = 30;

app.get('/api/changes', requireUser, async (c) => {
  const sinceSeq = BigInt(c.req.query('sinceSeq') ?? '0');
  
  // Check cursor expired
  const [{ min_seq }] = await db.execute(sql`
    SELECT COALESCE(min(seq), 0)::bigint AS min_seq FROM change_log
  `);
  
  if (sinceSeq < BigInt(min_seq) && sinceSeq > 0n) {
    return c.json({
      data: null,
      error: 'cursor_expired',
      fullResyncRequired: true,
      currentSeq: lastNotifiedSeq.toString()
    }, 410);
  }
  
  const sessionId = c.get('sessionId');
  const ctx = await getSessionCtx(sessionId);
  
  const rows = await db.execute(sql`
    SELECT seq, table_name, row_id, op, project_id, user_id, originator
    FROM change_log
    WHERE seq > ${sinceSeq}
    ORDER BY seq ASC
    LIMIT 10000
  `);
  
  const filtered = rows.filter(r => r.originator !== sessionId && canSee(ctx, r));
  
  return c.json({ data: filtered, currentSeq: lastNotifiedSeq.toString(), error: null });
});

app.get('/api/changes/head', requireUser, async (c) => {
  return c.json({ currentSeq: lastNotifiedSeq.toString() });
});
```

---

## Fix H3 — SQL completo trigger mancanti

**Sostituisce placeholder §8 v4 `floor_plans`, `sals`, `typology_prices`, `dropdown_options`, `products`.**

```sql
-- floor_plans: project_id diretto
CREATE OR REPLACE FUNCTION log_change_floor_plans() RETURNS trigger AS $$
DECLARE originator text; new_seq bigint;
BEGIN
  BEGIN originator := current_setting('opimappa.originator_session', true); EXCEPTION WHEN OTHERS THEN originator := NULL; END;
  INSERT INTO change_log (table_name, row_id, op, project_id, originator)
  VALUES ('floor_plans', COALESCE(NEW.id, OLD.id)::text, TG_OP, COALESCE(NEW.project_id, OLD.project_id), originator)
  RETURNING seq INTO new_seq;
  PERFORM pg_notify('opimappa_changes', new_seq::text);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER floor_plans_changelog AFTER INSERT OR UPDATE OR DELETE ON floor_plans FOR EACH ROW EXECUTE FUNCTION log_change_floor_plans();

-- sals: project_id diretto
CREATE OR REPLACE FUNCTION log_change_sals() RETURNS trigger AS $$
DECLARE originator text; new_seq bigint;
BEGIN
  BEGIN originator := current_setting('opimappa.originator_session', true); EXCEPTION WHEN OTHERS THEN originator := NULL; END;
  INSERT INTO change_log (table_name, row_id, op, project_id, originator)
  VALUES ('sals', COALESCE(NEW.id, OLD.id)::text, TG_OP, COALESCE(NEW.project_id, OLD.project_id), originator)
  RETURNING seq INTO new_seq;
  PERFORM pg_notify('opimappa_changes', new_seq::text);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER sals_changelog AFTER INSERT OR UPDATE OR DELETE ON sals FOR EACH ROW EXECUTE FUNCTION log_change_sals();

-- typology_prices: project_id diretto
CREATE OR REPLACE FUNCTION log_change_typology_prices() RETURNS trigger AS $$
DECLARE originator text; new_seq bigint;
BEGIN
  BEGIN originator := current_setting('opimappa.originator_session', true); EXCEPTION WHEN OTHERS THEN originator := NULL; END;
  INSERT INTO change_log (table_name, row_id, op, project_id, originator)
  VALUES ('typology_prices', COALESCE(NEW.id, OLD.id)::text, TG_OP, COALESCE(NEW.project_id, OLD.project_id), originator)
  RETURNING seq INTO new_seq;
  PERFORM pg_notify('opimappa_changes', new_seq::text);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER typology_prices_changelog AFTER INSERT OR UPDATE OR DELETE ON typology_prices FOR EACH ROW EXECUTE FUNCTION log_change_typology_prices();

-- dropdown_options, products: globali (project_id=NULL user_id=NULL → canSee ritorna true a tutti)
CREATE OR REPLACE FUNCTION log_change_global() RETURNS trigger AS $$
DECLARE originator text; new_seq bigint;
BEGIN
  BEGIN originator := current_setting('opimappa.originator_session', true); EXCEPTION WHEN OTHERS THEN originator := NULL; END;
  INSERT INTO change_log (table_name, row_id, op, originator)
  VALUES (TG_TABLE_NAME, COALESCE(NEW.id, OLD.id)::text, TG_OP, originator)
  RETURNING seq INTO new_seq;
  PERFORM pg_notify('opimappa_changes', new_seq::text);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER dropdown_options_changelog AFTER INSERT OR UPDATE OR DELETE ON dropdown_options FOR EACH ROW EXECUTE FUNCTION log_change_global();
CREATE TRIGGER products_changelog AFTER INSERT OR UPDATE OR DELETE ON products FOR EACH ROW EXECUTE FUNCTION log_change_global();
```

---

## Fix H4 — Project delete cascade test

```ts
it('delete project: child entities pruned client-side via parent event', async () => {
  // Setup: admin crea project con 3 mapping_entries, 5 photos, 2 floor_plans, 10 floor_plan_points
  const proj = await createTestProject(admin);
  await populateChildren(proj.id);
  
  // User B (subscribed to proj) ascolta SSE
  const events: ChangeLogRow[] = [];
  const stream = subscribeStream(userB, (ev) => events.push(ev));
  
  // Admin delete project (cascade FK)
  await apiClient.from('projects').delete().eq('id', proj.id);
  
  await sleep(500);
  
  // Verifica: client riceve almeno evento DELETE su projects
  // (eventi figli potrebbero non avere project_id derivabile se trigger fa SELECT su tabella già vuota)
  expect(events.find(e => e.table_name === 'projects' && e.op === 'DELETE' && e.row_id === proj.id)).toBeDefined();
  
  // Client logic: su DELETE project, pruna sottostante in Dexie senza dipendere da eventi figli
  await handleProjectDeleteLocal(proj.id);
  
  // Verifica Dexie pulito
  expect(await db.mappingEntries.where('projectId').equals(proj.id).count()).toBe(0);
  expect(await db.photos.where('projectId').equals(proj.id).count()).toBe(0);
  expect(await db.floorPlans.where('projectId').equals(proj.id).count()).toBe(0);
});
```

Implementazione `handleProjectDeleteLocal(projectId)`:

```ts
// src/realtime/projectCascade.ts
export async function handleProjectDeleteLocal(projectId: string) {
  await db.transaction('rw', [
    db.mappingEntries, db.structureEntries, db.photos,
    db.floorPlans, db.floorPlanPoints, db.sals, db.typologyPrices, db.projects
  ], async () => {
    await db.mappingEntries.where('projectId').equals(projectId).delete();
    await db.structureEntries.where('projectId').equals(projectId).delete();
    await db.photos.where('projectId').equals(projectId).delete();
    await db.floorPlans.where('projectId').equals(projectId).delete();
    await db.floorPlanPoints.where('projectId').equals(projectId).delete();
    await db.sals.where('projectId').equals(projectId).delete();
    await db.typologyPrices.where('projectId').equals(projectId).delete();
    await db.projects.delete(projectId);
  });
}

// Wire in EventStream listener
eventStream.subscribe(async (ev) => {
  if (ev.table_name === 'projects' && ev.op === 'DELETE') {
    await handleProjectDeleteLocal(ev.row_id);
  }
  // ... resto handler
});
```

---

## Fix H5 — Commento multipart S3 corretto

```ts
const PART_SIZE = 5 * 1024 * 1024;  // 5 MiB minimum per S3 multipart, max 5 GiB per part, max 10000 parts
```

Limite reale documentato:
- Min part: 5 MiB (eccetto ultima)
- Max part: 5 GiB
- Max parts: 10000
- Max object: 5 TiB

Soglia attivazione multipart: file > 50 MB (10 parti minimum sensato).

---

## Fix H6 — Presigned URL routing utenti esterni vs Tailscale

**Sostituisce §11 v4 "Direct MinIO via Tailscale".**

```ts
// api/src/storage/presign.ts
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

const TAILSCALE_CIDR = '100.64.0.0/10';

app.post('/api/storage/upload-presigned', requireUser, async (c) => {
  const { bucket, key } = await c.req.json();
  const ip = c.req.header('CF-Connecting-IP') ?? c.req.header('x-forwarded-for') ?? '';
  const fromTailscale = isInCidr(ip, TAILSCALE_CIDR);
  
  // Routing: Tailscale → MinIO direct, esterni → API proxy
  const endpoint = fromTailscale ? 'http://100.111.232.12:9000' : '/api/storage/proxy-upload';
  
  if (fromTailscale) {
    const url = await getSignedUrl(s3, new PutObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 600 });
    // Riscrivi endpoint nel signed URL per puntare a Tailscale
    const tailscaleUrl = url.replace(MINIO_INTERNAL_ENDPOINT, endpoint);
    return c.json({ url: tailscaleUrl, method: 'PUT', direct: true });
  }
  
  // Esterni: ritorna URL proxy API + chunk size limitato sotto CF 100MB body
  return c.json({
    url: endpoint,
    method: 'POST',
    direct: false,
    chunkSize: 5 * 1024 * 1024,
    maxParts: 100  // limite pratico
  });
});
```

CSP/connect-src deve includere endpoint direct MinIO Tailscale per utenti VPN:

```
Content-Security-Policy: connect-src 'self' http://100.111.232.12:9000;
```

Nota: questo CSP funziona solo se browser raggiunge IP Tailscale (utente connesso VPN). Per esterni, no allow-list extra.

---

## Fix H7 — Offline token: parametri KDF espliciti

```ts
// src/db/auth.ts
const PBKDF2_ITERATIONS = 600_000;  // OWASP 2023 raccomandazione minima
const PBKDF2_HASH = 'SHA-256';
const SALT_BYTES = 16;
const IV_BYTES = 12;
const OFFLINE_TTL_MS = 7 * 24 * 60 * 60 * 1000;  // 7 giorni (ridotto da 30, H7)

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password),
    'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: PBKDF2_HASH },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptOfflineToken(token: any, password: string): Promise<EncryptedToken> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(password, salt);
  const plaintext = new TextEncoder().encode(JSON.stringify(token));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return {
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext))
  };
}

// Rate limit locale offline attempts: 5 fail → backoff progressivo
const offlineAttempts = new Map<string, { count: number; lastFail: number }>();

async function loginOffline(email: string, password: string) {
  const attempt = offlineAttempts.get(email) ?? { count: 0, lastFail: 0 };
  if (attempt.count >= 5) {
    const cooldown = Math.min(60_000, (2 ** (attempt.count - 5)) * 1000);
    if (Date.now() - attempt.lastFail < cooldown) {
      return { error: `too many attempts, wait ${Math.ceil(cooldown / 1000)}s` };
    }
  }
  
  const row = await db.authCache.get(email);
  if (!row) return { error: 'no offline session' };
  
  try {
    const key = await deriveKey(password, base64ToBytes(row.salt));
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(row.iv) },
      key,
      base64ToBytes(row.ciphertext)
    );
    const token = JSON.parse(new TextDecoder().decode(plaintext));
    if (Date.now() > token.expiresAt) {
      await db.authCache.delete(email);
      return { error: 'offline session expired' };
    }
    offlineAttempts.delete(email);  // reset on success
    return { data: { user: token } };
  } catch {
    attempt.count++;
    attempt.lastFail = Date.now();
    offlineAttempts.set(email, attempt);
    return { error: 'invalid offline credentials' };
  }
}
```

**Test Safari iOS:** WebCrypto disponibile da iOS 11+. PWA installata: stesso scope. PBKDF2 600k iterations su mobile: ~500ms-1s. Accettabile.

**Tradeoff revoca:** offline token valido fino expiry locale anche se admin bana utente. TTL 7gg invece di 30gg riduce finestra rischio. Documentato come accettato.

---

## Fix M1 — `profiles` view colonne TEXT vs UUID

```ts
// api/src/query/schema.ts
const TABLE_SCHEMA = {
  // profiles è vista, NON validare id come uuid stretto
  profiles: {
    columns: { 
      id: 'text',           // M1: TEXT non UUID (better-auth)
      email: 'text',
      username: 'text',
      role: 'text',
      active: 'boolean',
      created_at: 'timestamptz',
      updated_at: 'timestamptz'
    },
    relationships: {}
  },
  projects: {
    columns: {
      id: 'uuid',
      owner_id: 'text',     // M2: TEXT (FK a "user")
      // ...
    },
    relationships: { /* ... */ }
  }
};
```

---

## Fix M3 — Schema diff deterministico (test-restore)

**Sostituisce §12 v4 `test-restore.sh` blocco schema diff.**

```bash
# Schema dump normalizzato deterministico
PROD_SCHEMA=$(docker exec opimappa_postgres pg_dump -U opimappa --schema-only --no-owner --no-acl --no-comments opimappa \
  | grep -vE '^(--|SET |SELECT pg_catalog)' \
  | grep -v '^$' \
  | sort)

REST_SCHEMA=$(docker exec pg_restore_test pg_dump -U postgres --schema-only --no-owner --no-acl --no-comments test_restore \
  | grep -vE '^(--|SET |SELECT pg_catalog)' \
  | grep -v '^$' \
  | sort)

if [ "$PROD_SCHEMA" != "$REST_SCHEMA" ]; then
  echo "Schema diff:"
  diff <(echo "$PROD_SCHEMA") <(echo "$REST_SCHEMA")
  exit 2
fi
```

---

## Fix M4 — `change_log` monitoring

```bash
# /opt/opimappa/scripts/change-log-monitor.sh
#!/bin/bash
COUNT=$(docker exec opimappa_postgres psql -U opimappa -At -d opimappa -c "SELECT count(*) FROM change_log")
OLDEST_DAYS=$(docker exec opimappa_postgres psql -U opimappa -At -d opimappa -c "
  SELECT extract(day from now() - min(changed_at))::int FROM change_log
")

# Alert se:
# - Tabella > 1M righe (lentezza queries)
# - Oldest < 25 giorni (avvicinamento retention 30gg, client potrebbero perdere cursor)
if [ "$COUNT" -gt 1000000 ]; then
  echo "ALERT: change_log $COUNT rows" | mail -s "OPImaPPA change_log size" admin@opimappa.com
fi

if [ "$OLDEST_DAYS" -lt 25 ]; then
  echo "ALERT: change_log retention margin shrinking (oldest=$OLDEST_DAYS days)" | mail -s "OPImaPPA retention" admin@opimappa.com
fi
```

Cron giornaliero.

---

## Fix M5 — SSE limit revisione

**Sostituisce §8 v4 `MAX_SSE_PER_SESSION = 1`.**

Decisione: limita per `(sessionId, tabId)` non per session pura. Tab multiple stessa session = OK.

```ts
const MAX_SSE_PER_SESSION = 5;   // M5: permette 5 tab/device per session
// Eviction su 6° connection: oldest

// Client-side: passa tab id univoco
app.get('/api/events/stream', requireUser, async (c) => {
  const sessionId = c.get('sessionId');
  const tabId = c.req.query('tabId') ?? crypto.randomUUID();
  const key = `${sessionId}:${tabId}`;
  
  // Limit per session totale
  const userKeys = Array.from(subscribers.keys()).filter(k => k.startsWith(sessionId + ':'));
  if (userKeys.length >= MAX_SSE_PER_SESSION) {
    const oldestKey = userKeys[0];  // primo = oldest (Map preserva insertion order)
    for (const sink of subscribers.get(oldestKey)!) sink({ system: true, type: 'evicted' });
    subscribers.delete(oldestKey);
  }
  
  // ... resto endpoint usa `key` invece di solo sessionId
});
```

Client:

```ts
const tabId = sessionStorage.getItem('tabId') ?? (() => {
  const id = crypto.randomUUID();
  sessionStorage.setItem('tabId', id);
  return id;
})();

new EventSource(`/api/events/stream?sinceSeq=${this.appliedSeq}&tabId=${tabId}`, { withCredentials: true });
```

`sessionStorage` è per-tab, perfetto per tab id unico.

---

## Summary fix da incorporare nei sprint

| Sprint | Fix |
|---|---|
| **1 (infra)** | C5 (UUID CHECK + INSTEAD OF DELETE), C9 freeze script da preparare per Sprint 7 |
| **2 (API)** | C6 (trim + dotted filter), H1 (body clone), M1/M2 (schema TEXT vs UUID), C5 (force UUID id) |
| **3 (realtime)** | C1 (drainUntil + lastDrainedSeq), C2 (init max(seq)), C3 (serverSeenSeq vs appliedSeq), C4 (applyEvent unified), H2 (cursor_expired), H3 (SQL completo), H4 (project cascade test), M3 (SSE tab id), M4 (change_log monitor) |
| **4 (migrazione)** | C7 (path canonicali + URL runtime + legacy `/sign/`), M3 (schema diff deterministico) |
| **5 (frontend)** | H5 (commento multipart), H6 (presigned routing Tailscale vs esterni), H7 (PBKDF2 params + 7gg TTL + rate limit locale), M5 (tab id sessionStorage) |
| **7 (cutover)** | C8 (reverse-delta `seq` ordered + freeze fino completo), C9 (freeze SQL completo anon+authenticated+storage), test freeze pre-cutover |

Tutti fix saranno copiati in `/opt/opimappa/REVIEW-FIXES.md` su server come tracker pre-PR.

---

**Fine v4.1 patch.**
