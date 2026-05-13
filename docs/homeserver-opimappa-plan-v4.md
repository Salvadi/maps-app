# OPImaPPA — Migrazione Supabase → Home Server

**Versione:** 4.0 (post-Codex adversarial review)
**Data:** 2026-05-12
**Server target:** `demeter227` (192.168.1.2, Tailscale `100.111.232.12`)
**Dominio:** `opimappa.com`
**Branch riferimento:** `origin/master`
**Modello d'uso:** multi-user attivo, **online-first con offline-resilience garantita**

---

## Changelog v3 → v4

Fix da adversarial review Codex (`docs/homeserver-opimappa-plan-v3-adversarial-review.md`):

| ID | Tipo | Fix |
|---|---|---|
| **C1** | Schema | Aggiunta tabella `structure_entries` (load-bearing in `src/db/database.ts:373`, `schema.sql:834`). Totale **13 tabelle** sincronizzate, non 12. |
| **C2** | Auth | `profiles` mantenuta come **vista SQL compat layer** verso `"user"`. Zero refactor call site `from('profiles')`. |
| **C3** | SQL | Scoping JSONB corretto: `accessible_users ? $userId` (key existence) o `accessible_users @> jsonb_build_array($userId)`. Niente cast `::text[]`. |
| **C4** | SQL | `cleanup_accessible_users` con `COALESCE(..., '[]'::jsonb)` per evitare NULL. |
| **C5** | Realtime | Triggers **per-tabella custom**: `photos`/`floor_plan_points` joinano parent per derivare `project_id`. `standalone_maps` usa `user_id`. |
| **C6** | Realtime | **`change_log` table durabile** con `seq BIGSERIAL` + payload meta. Client persiste `lastSeq`, recovery via `/api/changes?sinceSeq=`. `pg_notify` ora trasmette solo `seq` come trigger di drain. |
| **C7** | Storage | Migrazione ricorsiva + normalizzazione URL → path. Rewrite `image_url`, `thumbnail_url`, `pdf_url`, `url` in DB. Hash sample stratificato per bucket. |
| **C8** | Shim | Aggiunti pattern reali: `select(cols, { count, head })`, join `mapping_entries!inner(id)`, `createSignedUrl` singolare. |
| **C9** | SW update | Pre-`clearAndSync()` safeguard: check pending writes, tenta flush, esporta backup JSON, conferma esplicita. |
| **H1** | Auth | `sessionId` derivato server-side dalla session cookie, mai dal client. |
| **H2** | Storage | Chunked upload (5MB chunk) per oggetti >50MB. Direct-MinIO via Tailscale per asset >100MB. |
| **H3** | Auth | Offline login: design esplicito con session token cifrato persistito in IndexedDB + expiry. |
| **H4** | Rollback | Write freeze 30min durante cutover + reverse-delta script Postgres locale → Supabase. |
| **H5** | Auth | Endpoint admin allineati a better-auth: `admin/create-user`, `admin/set-user-password`, `admin/list-users`, `admin/ban-user`. |
| **H6** | Backup | Test restore basato su `SELECT count(*)` per ogni tabella, non `n_live_tup`. |
| **H7** | CSP | `Permissions-Policy` rivista: `geolocation=(self)` mantenuta, `camera=(self)` aggiunta (foto cantieri). |
| **M1** | Docker | Pin immagini a digest SHA256 in produzione. |
| **M2** | Docker | Mount tmpfs/writable per ogni servizio dettagliati esplicitamente. |
| **M3** | Realtime | SSE limit per **sessione**, non per user (N device = N session). |
| **M4** | Auth | Lockout progressivo (backoff esponenziale), no disattivazione permanente. Captcha Cloudflare Turnstile opzionale post-5 fail. |
| **M5** | Realtime | Cursor monotono `seq` (BIGSERIAL), timestamp solo metadata. |
| **M6** | Migrazione | Script seed legge `profiles` da Supabase via API REST (`from('profiles').select()`), non da dump table. |

**Strategia conservata da v3:**
- Path-based same-origin (no subdomain split)
- Schema better-auth nativo
- Originator filter SSE per evitare self-echo
- LISTEN reconnect loop con `connection_lost` event
- Cache user ctx eager con invalidation
- Whitelist schema-driven query parser
- Heartbeat 15s
- Cookie `__Host-` prefix, SameSite=Lax, no Domain

---

## 1. Contesto

App `opimappa` (CRA TypeScript PWA, Dexie + sync engine, branch `origin/master`) migra da Supabase free saturo a home server. App **online-first con offline-resilience**: read live remoto, write-through Dexie, queue su offline, push realtime via SSE durable.

**Vincoli non negoziabili:**
- Funziona offline (PWA cantieri, copertura mobile assente)
- Multi-tenant: admin tutto, user solo progetti in `accessible_users`
- Zero RLS Postgres: enforcement applicativo + isolation test in CI
- Refactor frontend minimale: shim PostgREST drop-in per 94 call site
- **Realtime durabile**: nessun evento perso anche con SSE disconnect prolungato
- **Cutover lossless**: write freeze + dual-read durante swap

---

## 2. Server — stato reale verificato

```
OS:       Ubuntu 24.04.4 LTS, kernel 6.8.0-110-generic
CPU:      Intel i5-7500 (4C/4T, 3.4GHz)
RAM:      16 GB (1.9 GB used, 13 GB available)
Swap:     4 GB

Storage:
  /            ext4  217G  191G free   (SSD, root LVM)
  /mnt/backup  ext4  916G  870G free   (HDD 1TB)
  /mnt/data    ntfs  1.9T  Immich      (HDD 2TB, exclusive Immich)

Docker: Immich stack operativo, /var/lib/docker 5.1G usati
```

OPImaPPA tutto su SSD ext4 `/opt/opimappa/`. Backup su `/mnt/backup`.

---

## 3. Audit frontend — risultati (origin/master)

```
Lines TS/TSX:                ~29.6K
await supabase.*  calls:     94 in 15 files
.from('table'):              84
supabase.storage.*:          30+
supabase.auth.*:             17
supabase.functions.invoke:   0
supabase.channel(:           0
postgres_changes:            0
```

Online-first attivo: `src/db/onlineFirst.ts` (`isOnlineAndConfigured`, `getPendingEntityIds`, `applyPendingWrites`, `writeThroughCache`).

**Tabelle sincronizzate — 13 totali (corretto da v3):**

```
profiles*           → vista compat su "user" better-auth (C2)
projects
mapping_entries
structure_entries   ← AGGIUNTA v4 (C1)
standalone_maps
floor_plan_points
photos
floor_plans
dropdown_options
products
sals
typology_prices
conflict_history    (locale-only, no sync remoto)
```

`* profiles` non è tabella, è vista compat. Vedi §6.

---

## 4. Architettura target

```
Internet
   │ HTTPS
   ▼
Cloudflare Edge (cloudflared tunnel)
   │
   ▼
Caddy 2 (path-based ingress, same-origin)
   │
   ├── opimappa.com/                → Nginx (PWA build)
   ├── opimappa.com/api/            → Hono API
   └── opimappa.com/api/events/     → Hono SSE
            │
            ├─→ PostgreSQL 17    ← change_log table + triggers per-tabella
            └─→ MinIO (S3)
            
Tailscale interno: 100.111.232.12
   └── direct-minio:9000  (upload large file >50MB, bypass CF body limit)
```

**Decisioni:**
- **Same-origin** (C1 v3 risolto): cookie `__Host-opimappa-session` host-only
- **Direct MinIO via Tailscale** per upload >50MB (H2): client autenticati VPN-internal possono fare PUT diretto bypassando CF 100MB limit. Per utenti esterni: chunked upload (5MB chunk × N) via API
- **change_log table** (C6): durabilità eventi indipendente da SSE state

### Servizi Docker

| Servizio | Immagine | Network | Mount writable |
|---|---|---|---|
| postgres | `postgres:17.4-alpine@sha256:<digest>` | opimappa_net | `/opt/opimappa/data/postgres` |
| minio | `minio/minio:RELEASE.2025-04-08T15-41-24Z@sha256:<digest>` | opimappa_net | `/opt/opimappa/data/minio` |
| api | build locale (Node 20.18-alpine) | opimappa_net | `tmpfs:/tmp` |
| web | `nginx:1.27-alpine@sha256:<digest>` | opimappa_net | `tmpfs:/var/cache/nginx`, `tmpfs:/var/run` |
| caddy | `caddy:2.8.4-alpine@sha256:<digest>` | opimappa_net + host | `/opt/opimappa/caddy/data` |
| cloudflared | `cloudflare/cloudflared:2025.4.0@sha256:<digest>` | opimappa_net | — |

Pin digest in produzione (M1). Update manuale documentato.

`cap_drop: [ALL]` su web, caddy, cloudflared. Postgres/MinIO mantengono cap default (richiedono fsync/io_uring). `read_only: true` su web e caddy. (M2)

User non-root: `postgres` (uid 999), `minio` (uid 1000), `node` (uid 1000), `caddy` (uid 0 con cap drop limitato → opt: `caddy` user-mode).

Console MinIO `:9001` bind solo Tailscale.

### Filesystem

```
/opt/opimappa/                            (SSD ext4, opimappa:opimappa)
├── docker-compose.yml
├── docker-compose.staging.yml             (M3 prev → isolated stack)
├── .env                                   chmod 600
├── data/
│   ├── postgres/                          UID 999
│   └── minio/                             UID 1000
├── api/
│   ├── src/
│   ├── package.json
│   ├── drizzle.config.ts
│   └── Dockerfile
├── web/build/                             output `npm run build`
├── caddy/Caddyfile
└── scripts/
    ├── seed-auth-users.ts                 ← C3 v3
    ├── migrate-supabase-pg.sh
    ├── migrate-supabase-storage.ts        ← ricorsivo + URL rewrite (C7)
    ├── reverse-delta-supabase.ts          ← rollback (H4)
    ├── backup-postgres.sh
    ├── backup-minio.sh
    ├── backup-restic.sh
    └── test-restore.sh                    ← count(*) (H6)

/mnt/backup/opimappa/                      (HDD 1TB ext4)
├── pg-dumps/
├── minio-mirror/
└── restic-repo/

/mnt/data/                                 (NTFS — Immich)
```

---

## 5. Stack tecnologico API

| Componente | Tecnologia |
|---|---|
| Runtime | Node.js 20 LTS |
| Framework | Hono v4 |
| ORM | Drizzle ORM (introspect + diff manuale) |
| Auth | better-auth v1 (Hono adapter, admin plugin) |
| Validation | zod |
| Postgres driver | `postgres` (porsager) — LISTEN + queries |
| S3 client | `@aws-sdk/client-s3` v3 + `@aws-sdk/s3-request-presigner` |
| Multipart | native S3 multipart upload |
| MIME detect | `file-type` (H7 v3) |
| Realtime | SSE `hono/streaming` + change_log polling + LISTEN trigger |
| Logs | `pino` JSON |
| Test | `vitest` + `supertest` + `fast-check` (fuzz) |

---

## 6. Auth model

### Schema better-auth nativo + compat layer profiles

better-auth genera tabelle `user`, `session`, `account`, `verification`. Mantieni schema esatto per evitare drift.

**Compat layer `profiles` (C2):** vista SQL retrocompatibile, zero refactor frontend:

```sql
-- I 94 call site continuano a usare from('profiles')
CREATE VIEW profiles AS
SELECT
  id::uuid AS id,                       -- cast text→uuid per FK compat
  email,
  name AS username,
  role,
  active,
  "createdAt" AS created_at,
  "updatedAt" AS updated_at
FROM "user";

-- Vista aggiornabile via INSTEAD OF triggers (admin operations)
CREATE OR REPLACE FUNCTION profiles_update() RETURNS trigger AS $$
BEGIN
  UPDATE "user" SET
    email = COALESCE(NEW.email, email),
    name = COALESCE(NEW.username, name),
    role = COALESCE(NEW.role, role),
    active = COALESCE(NEW.active, active),
    "updatedAt" = now()
  WHERE id = OLD.id::text;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_update_trg
  INSTEAD OF UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION profiles_update();

-- INSERT su profiles bloccato: deve passare da /api/auth/admin/create-user
CREATE OR REPLACE FUNCTION profiles_insert_block() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Use /api/auth/admin/create-user instead';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_insert_trg
  INSTEAD OF INSERT ON profiles
  FOR EACH ROW EXECUTE FUNCTION profiles_insert_block();
```

**FK existing `owner_id REFERENCES profiles(id)`** rimangono valide perché PostgreSQL accetta FK verso vista solo se rule update. **Caveat:** FK verso view non supportate nativamente PG. Soluzione: cambiare FK target a `"user"(id)`:

```sql
ALTER TABLE projects DROP CONSTRAINT projects_owner_id_fkey;
ALTER TABLE projects ALTER COLUMN owner_id TYPE text USING owner_id::text;
ALTER TABLE projects ADD CONSTRAINT projects_owner_id_fkey
  FOREIGN KEY (owner_id) REFERENCES "user"(id) ON DELETE CASCADE;
-- idem per created_by, modified_by su mapping_entries, structure_entries, ecc.
```

`owner_id` diventa `TEXT` (UUID stringa). Postgres accetta JOIN tra `uuid` e `text` con cast, ma uniformiamo a `text` ovunque per evitare confusione.

### better-auth config

```ts
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins";

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    autoSignIn: false,
    password: { hash: { algorithm: "argon2id", timeCost: 3, memoryCost: 65536 } }
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: true, maxAge: 5 * 60 }
  },
  advanced: {
    cookiePrefix: "__Host-opimappa",
    useSecureCookies: true,
    cookieAttributes: { sameSite: "lax", path: "/" }
  },
  rateLimit: { enabled: true, window: 60, max: 100 },
  plugins: [admin()]
});
```

### Rate limit (M4) — progressivo, no permanent lockout

Custom middleware su `/api/auth/sign-in/email`:

```ts
async function loginRateLimit(c, next) {
  const { email } = await c.req.json();
  const ip = c.req.header('CF-Connecting-IP') ?? 'unknown';
  const key = `login:${ip}:${email.toLowerCase()}`;
  
  const fails = await getFailCount(key);
  if (fails >= 3) {
    const delay = Math.min(60, 2 ** (fails - 3));  // 1s, 2s, 4s, 8s, ... max 60s
    await sleep(delay * 1000);
  }
  if (fails >= 10) {
    // Captcha verification required (Cloudflare Turnstile)
    const cfToken = c.req.header('CF-Turnstile-Token');
    if (!cfToken || !(await verifyTurnstile(cfToken))) {
      return c.json({ error: 'captcha_required' }, 429);
    }
  }
  
  await next();
  
  // Post-handler: incremento se fail, reset se success
  if (c.res.status >= 400) await incrFailCount(key);
  else await resetFailCount(key);
}
```

Lockout permanente solo manuale da admin (no auto-DoS-vector).

Audit log `auth_audit_log(user_id, event, ip, ua, success, ts)`.

### Endpoint admin (H5)

Better-auth admin plugin espone:

```
POST /api/auth/admin/create-user
POST /api/auth/admin/set-user-password
POST /api/auth/admin/list-users
POST /api/auth/admin/ban-user
POST /api/auth/admin/unban-user
POST /api/auth/admin/remove-user
```

Shim frontend mappa chiamate esistenti a questi endpoint.

### Offline login (H3)

```ts
// src/db/auth.ts modifiche
async function loginOnline(email: string, password: string) {
  const res = await apiClient.auth.signInWithPassword({ email, password });
  if (res.error) return res;
  
  // Persist crypto-encrypted offline token in Dexie
  const passwordKey = await deriveKey(password);  // PBKDF2 from password
  const offlineToken = {
    userId: res.data.user.id,
    role: res.data.user.role,
    email: res.data.user.email,
    expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,  // 30 days
    issuedAt: Date.now()
  };
  const encrypted = await aesGcmEncrypt(JSON.stringify(offlineToken), passwordKey);
  await db.authCache.put({ id: 'offline-token', email, encrypted });
  return res;
}

async function loginOffline(email: string, password: string) {
  const row = await db.authCache.get('offline-token');
  if (!row || row.email !== email) return { error: 'no offline session' };
  try {
    const passwordKey = await deriveKey(password);
    const decrypted = await aesGcmDecrypt(row.encrypted, passwordKey);
    const token = JSON.parse(decrypted);
    if (Date.now() > token.expiresAt) {
      await db.authCache.delete('offline-token');
      return { error: 'offline session expired' };
    }
    return { data: { user: token } };
  } catch {
    return { error: 'invalid offline credentials' };
  }
}
```

UX:
- Online: login normale via API → offline token persistito
- Offline: utente inserisce credenziali → decryption con password → access locale 30gg max
- Logout esplicito → cancella offline token
- Browser data clear → re-login richiede online

Aggiungi tabella Dexie `authCache` in schema versione successiva.

### Isolation enforcement (no RLS)

Middleware:

```ts
async function requireUser(c, next) {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: 'unauthorized' }, 401);
  c.set('user', session.user);
  c.set('sessionId', session.session.id);  // H1: server-derived
  await next();
}

async function requireAdmin(c, next) {
  if (c.get('user').role !== 'admin') return c.json({ error: 'forbidden' }, 403);
  await next();
}

// Scoping helper (C3 fix — JSONB operators)
function scopeProjectFilter(userId: string, role: string) {
  if (role === 'admin') return sql`true`;
  return sql`(owner_id = ${userId} OR accessible_users ? ${userId})`;
}
```

Cleanup `accessible_users[]` (C4 fix — COALESCE):

```sql
CREATE OR REPLACE FUNCTION cleanup_accessible_users() RETURNS trigger AS $$
BEGIN
  UPDATE projects
  SET accessible_users = COALESCE((
    SELECT jsonb_agg(elem)
    FROM jsonb_array_elements_text(accessible_users) elem
    WHERE elem <> OLD.id
  ), '[]'::jsonb)
  WHERE accessible_users ? OLD.id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER user_delete_cleanup
  BEFORE DELETE ON "user"
  FOR EACH ROW EXECUTE FUNCTION cleanup_accessible_users();
```

---

## 7. API REST design

### Pattern

```
GET    /api/{table}?select=*&col=eq.value&col2=in.(a,b)&order=col.desc&limit=N
GET    /api/{table}?select=id,joined!inner(id)&joined.col=eq.x   ← C8: PostgREST join
GET    /api/{table}?select=id&col=eq.x  (HEAD method per count exact head)
POST   /api/{table}            Body: row | row[]
PATCH  /api/{table}?col=eq.x   Body: partial
DELETE /api/{table}?col=eq.x

GET    /api/storage/:bucket/*                       stream
POST   /api/storage/sign                            { bucket, paths[], ttl } → urls
POST   /api/storage/sign-one                        { bucket, path, ttl } → url (C8)
POST   /api/storage/upload-presigned                { bucket, key } → { url, fields } (multipart init)
POST   /api/storage/upload-complete                 { bucket, key, parts[] } (multipart finalize)
POST   /api/storage/:bucket/*                       multipart small
DELETE /api/storage/:bucket/*

POST   /api/auth/sign-in/email
POST   /api/auth/sign-out
GET    /api/auth/get-session
POST   /api/auth/admin/create-user                  admin
POST   /api/auth/admin/set-user-password            admin
POST   /api/auth/admin/list-users                   admin
POST   /api/auth/admin/ban-user                     admin

GET    /api/events/stream                           SSE (cookie auth)
GET    /api/changes?sinceSeq=:seq&tables=projects,mapping_entries   gap recovery (C6)
```

### Query parser whitelist (H3 v3, hardened v4)

```ts
const TABLE_SCHEMA = {
  projects: {
    columns: { id: 'uuid', owner_id: 'text', title: 'text', last_modified: 'bigint', archived: 'boolean', /* ... */ },
    relationships: { mapping_entries: { type: 'hasMany', fk: 'project_id' } }
  },
  mapping_entries: {
    columns: { id: 'uuid', project_id: 'uuid', /* ... */ },
    relationships: { photos: { type: 'hasMany', fk: 'mapping_entry_id' }, project: { type: 'belongsTo', fk: 'project_id', target: 'projects' } }
  },
  // ... 13 tabelle
};

const ALLOWED_OPS = new Set(['eq', 'in', 'gte', 'lte', 'gt', 'lt']);

function parseQuery(table: string, params: URLSearchParams) {
  const schema = TABLE_SCHEMA[table];
  if (!schema) throw httpError(404, 'unknown table');
  
  const select = parseSelect(params.get('select'), schema);  // C8: parse PostgREST select
  const filters = parseFilters(params, schema);
  const order = parseOrder(params.get('order'), schema);
  const limit = parseLimit(params.get('limit'));
  const head = params.get('head') === 'true' || isHeadRequest;
  const count = params.get('count');  // 'exact' | 'planned' | 'estimated'
  
  return { select, filters, order, limit, head, count };
}

function parseSelect(raw: string | null, schema): SelectPlan {
  // Supporta: '*', 'id,name', 'id,joined!inner(id)', 'id,mapping_entries!inner(id)'
  // C8: join PostgREST
  if (!raw || raw === '*') return { cols: '*', joins: [] };
  const parts = raw.split(',');
  const cols: string[] = [];
  const joins: JoinPlan[] = [];
  for (const part of parts) {
    const joinMatch = part.match(/^(\w+)!(inner|left)\((.*)\)$/);
    if (joinMatch) {
      const [, relName, joinType, subCols] = joinMatch;
      const rel = schema.relationships[relName];
      if (!rel) throw httpError(400, `unknown relation: ${relName}`);
      joins.push({ relation: rel, type: joinType, cols: subCols.split(',') });
    } else {
      if (!schema.columns[part]) throw httpError(400, `unknown col: ${part}`);
      cols.push(part);
    }
  }
  return { cols, joins };
}
```

Fuzz test obbligatorio:

```ts
test.prop([fc.string(), fc.string()])('arbitrary input never causes 500', async (col, val) => {
  const res = await api.as(user).get(`/api/projects?${col}=${val}`);
  expect(res.status).toBeLessThan(500);
});
```

### Response shape

`{ data, error, count? }` + header `X-Server-Seq: <lastSeq>` ad ogni response → client salva come `lastSeq` per gap recovery.

---

## 8. Realtime — design v4 (durable change_log)

### change_log table (C6)

```sql
CREATE TABLE change_log (
  seq          BIGSERIAL PRIMARY KEY,
  table_name   TEXT NOT NULL,
  row_id       TEXT NOT NULL,
  op           TEXT NOT NULL CHECK (op IN ('INSERT', 'UPDATE', 'DELETE')),
  project_id   UUID,                          -- popolato anche per tabelle figlie
  user_id      TEXT,                          -- proprietario per scoping standalone_maps
  originator   TEXT,                          -- session_id che ha generato evento
  changed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX change_log_seq_idx ON change_log(seq);
CREATE INDEX change_log_table_seq_idx ON change_log(table_name, seq);
CREATE INDEX change_log_project_idx ON change_log(project_id) WHERE project_id IS NOT NULL;
CREATE INDEX change_log_user_idx ON change_log(user_id) WHERE user_id IS NOT NULL;

-- Retention: 30 giorni (delete vecchi via cron)
CREATE INDEX change_log_changed_at_idx ON change_log(changed_at);
```

Cron `DELETE FROM change_log WHERE changed_at < now() - interval '30 days'` notturno.

### Triggers per-tabella custom (C5)

```sql
-- projects: project_id = id, owner_id = owner_id
CREATE OR REPLACE FUNCTION log_change_projects() RETURNS trigger AS $$
DECLARE
  originator text;
  new_seq bigint;
BEGIN
  BEGIN originator := current_setting('opimappa.originator_session', true); EXCEPTION WHEN OTHERS THEN originator := NULL; END;
  INSERT INTO change_log (table_name, row_id, op, project_id, user_id, originator)
  VALUES ('projects', COALESCE(NEW.id, OLD.id)::text, TG_OP, COALESCE(NEW.id, OLD.id), COALESCE(NEW.owner_id, OLD.owner_id), originator)
  RETURNING seq INTO new_seq;
  PERFORM pg_notify('opimappa_changes', new_seq::text);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER projects_changelog AFTER INSERT OR UPDATE OR DELETE ON projects FOR EACH ROW EXECUTE FUNCTION log_change_projects();

-- mapping_entries: project_id diretto
CREATE OR REPLACE FUNCTION log_change_mapping_entries() RETURNS trigger AS $$
DECLARE
  originator text;
  new_seq bigint;
BEGIN
  BEGIN originator := current_setting('opimappa.originator_session', true); EXCEPTION WHEN OTHERS THEN originator := NULL; END;
  INSERT INTO change_log (table_name, row_id, op, project_id, originator)
  VALUES ('mapping_entries', COALESCE(NEW.id, OLD.id)::text, TG_OP, COALESCE(NEW.project_id, OLD.project_id), originator)
  RETURNING seq INTO new_seq;
  PERFORM pg_notify('opimappa_changes', new_seq::text);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER mapping_entries_changelog AFTER INSERT OR UPDATE OR DELETE ON mapping_entries FOR EACH ROW EXECUTE FUNCTION log_change_mapping_entries();

-- structure_entries: project_id diretto (C1)
CREATE OR REPLACE FUNCTION log_change_structure_entries() RETURNS trigger AS $$
DECLARE
  originator text;
  new_seq bigint;
  proj uuid;
BEGIN
  BEGIN originator := current_setting('opimappa.originator_session', true); EXCEPTION WHEN OTHERS THEN originator := NULL; END;
  proj := COALESCE(NEW.project_id, OLD.project_id);
  INSERT INTO change_log (table_name, row_id, op, project_id, originator)
  VALUES ('structure_entries', COALESCE(NEW.id, OLD.id)::text, TG_OP, proj, originator)
  RETURNING seq INTO new_seq;
  PERFORM pg_notify('opimappa_changes', new_seq::text);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER structure_entries_changelog AFTER INSERT OR UPDATE OR DELETE ON structure_entries FOR EACH ROW EXECUTE FUNCTION log_change_structure_entries();

-- photos: project_id via JOIN su mapping_entries o structure_entries (C5)
CREATE OR REPLACE FUNCTION log_change_photos() RETURNS trigger AS $$
DECLARE
  originator text;
  new_seq bigint;
  proj uuid;
  me_id uuid;
  se_id uuid;
BEGIN
  BEGIN originator := current_setting('opimappa.originator_session', true); EXCEPTION WHEN OTHERS THEN originator := NULL; END;
  me_id := COALESCE(NEW.mapping_entry_id, OLD.mapping_entry_id);
  -- structure_entry_id se presente (verifica colonna in schema reale)
  BEGIN se_id := COALESCE(NEW.structure_entry_id, OLD.structure_entry_id); EXCEPTION WHEN OTHERS THEN se_id := NULL; END;
  
  IF me_id IS NOT NULL THEN
    SELECT project_id INTO proj FROM mapping_entries WHERE id = me_id;
  ELSIF se_id IS NOT NULL THEN
    SELECT project_id INTO proj FROM structure_entries WHERE id = se_id;
  END IF;
  
  INSERT INTO change_log (table_name, row_id, op, project_id, originator)
  VALUES ('photos', COALESCE(NEW.id, OLD.id)::text, TG_OP, proj, originator)
  RETURNING seq INTO new_seq;
  PERFORM pg_notify('opimappa_changes', new_seq::text);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER photos_changelog AFTER INSERT OR UPDATE OR DELETE ON photos FOR EACH ROW EXECUTE FUNCTION log_change_photos();

-- floor_plans: project_id diretto
CREATE OR REPLACE FUNCTION log_change_floor_plans() RETURNS trigger AS $$
-- analogo a mapping_entries
$$ LANGUAGE plpgsql;
CREATE TRIGGER floor_plans_changelog AFTER INSERT OR UPDATE OR DELETE ON floor_plans FOR EACH ROW EXECUTE FUNCTION log_change_floor_plans();

-- floor_plan_points: project_id via JOIN su floor_plans (C5)
CREATE OR REPLACE FUNCTION log_change_floor_plan_points() RETURNS trigger AS $$
DECLARE
  originator text;
  new_seq bigint;
  proj uuid;
  fp_id uuid;
BEGIN
  BEGIN originator := current_setting('opimappa.originator_session', true); EXCEPTION WHEN OTHERS THEN originator := NULL; END;
  fp_id := COALESCE(NEW.floor_plan_id, OLD.floor_plan_id);
  SELECT project_id INTO proj FROM floor_plans WHERE id = fp_id;
  INSERT INTO change_log (table_name, row_id, op, project_id, originator)
  VALUES ('floor_plan_points', COALESCE(NEW.id, OLD.id)::text, TG_OP, proj, originator)
  RETURNING seq INTO new_seq;
  PERFORM pg_notify('opimappa_changes', new_seq::text);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER floor_plan_points_changelog AFTER INSERT OR UPDATE OR DELETE ON floor_plan_points FOR EACH ROW EXECUTE FUNCTION log_change_floor_plan_points();

-- standalone_maps: user_id (no project) (C5)
CREATE OR REPLACE FUNCTION log_change_standalone_maps() RETURNS trigger AS $$
DECLARE
  originator text; new_seq bigint;
BEGIN
  BEGIN originator := current_setting('opimappa.originator_session', true); EXCEPTION WHEN OTHERS THEN originator := NULL; END;
  INSERT INTO change_log (table_name, row_id, op, user_id, originator)
  VALUES ('standalone_maps', COALESCE(NEW.id, OLD.id)::text, TG_OP, COALESCE(NEW.user_id, OLD.user_id), originator)
  RETURNING seq INTO new_seq;
  PERFORM pg_notify('opimappa_changes', new_seq::text);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER standalone_maps_changelog AFTER INSERT OR UPDATE OR DELETE ON standalone_maps FOR EACH ROW EXECUTE FUNCTION log_change_standalone_maps();

-- sals, typology_prices: project_id diretto, trigger analogo a mapping_entries
-- dropdown_options, products: tabelle globali, log con project_id=NULL user_id=NULL (visibili a tutti)
```

### Hono SSE endpoint

```ts
// api/src/realtime/listener.ts
let listenSql: postgres.Sql | null = null;
const subscribers = new Map<string, Set<Sink>>();  // sessionId → sinks
let lastNotifiedSeq = 0;

async function startListener() {
  while (true) {
    try {
      listenSql = postgres(DATABASE_URL, { max: 1, idle_timeout: 0 });
      await listenSql.listen('opimappa_changes', async (raw) => {
        const seq = parseInt(raw, 10);
        if (seq <= lastNotifiedSeq) return;
        lastNotifiedSeq = seq;
        await drainSince(seq);
      });
      logger.info('pg LISTEN connected');
      broadcastSystem({ type: 'reconnected', seq: lastNotifiedSeq });
      
      await new Promise<void>((resolve) => {
        listenSql!.options.onclose = () => resolve();
      });
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

async function drainSince(seq: bigint) {
  const rows = await db.execute(sql`
    SELECT seq, table_name, row_id, op, project_id, user_id, originator
    FROM change_log
    WHERE seq <= ${seq}
    ORDER BY seq ASC
    LIMIT 1000
  `);
  
  for (const [sessionId, sinks] of subscribers) {
    const ctx = await getSessionCtx(sessionId);
    if (!ctx) continue;
    for (const row of rows) {
      if (row.originator === sessionId) continue;  // self-echo skip
      if (!canSee(ctx, row)) continue;
      for (const sink of sinks) sink(row);
    }
  }
}

startListener();
```

```ts
const MAX_SSE_PER_SESSION = 1;  // M3: 1 SSE per session, N device → N session

app.get('/api/events/stream', requireUser, async (c) => {
  const sessionId = c.get('sessionId');
  const user = c.get('user');
  const sinceSeq = parseInt(c.req.query('sinceSeq') ?? '0', 10);
  
  // M3: kill existing SSE per same session (page reload, ecc.)
  const existing = subscribers.get(sessionId);
  if (existing) {
    for (const sink of existing) sink({ system: true, type: 'evicted' });
    subscribers.delete(sessionId);
  }
  
  return streamSSE(c, async (stream) => {
    const sink: Sink = (ev) => {
      const event = ev.system ? ev.type : 'change';
      try { stream.writeSSE({ event, data: JSON.stringify(ev) }); } catch {}
    };
    
    if (!subscribers.has(sessionId)) subscribers.set(sessionId, new Set());
    subscribers.get(sessionId)!.add(sink);
    
    await stream.writeSSE({ event: 'hello', data: JSON.stringify({ currentSeq: lastNotifiedSeq, sessionId }) });
    
    // Catch-up dal sinceSeq fornito dal client → drena change_log
    if (sinceSeq > 0 && sinceSeq < lastNotifiedSeq) {
      const ctx = await getSessionCtx(sessionId);
      const rows = await db.execute(sql`
        SELECT seq, table_name, row_id, op, project_id, user_id, originator
        FROM change_log WHERE seq > ${sinceSeq} ORDER BY seq ASC LIMIT 10000
      `);
      for (const row of rows) {
        if (row.originator !== sessionId && canSee(ctx, row)) sink(row);
      }
    }
    
    stream.onAbort(() => {
      subscribers.get(sessionId)?.delete(sink);
      if (subscribers.get(sessionId)?.size === 0) subscribers.delete(sessionId);
    });
    
    while (!stream.aborted) {
      await stream.sleep(15_000);
      try { await stream.writeSSE({ event: 'ping', data: '' }); } catch { break; }
    }
  });
});
```

### Session context cache (H2 v3 update)

```ts
const sessionCtxCache = new Map<string, { userId: string; role: string; accessibleProjects: Set<string>; ts: number }>();
const CTX_TTL = 30_000;

async function getSessionCtx(sessionId: string) {
  const cached = sessionCtxCache.get(sessionId);
  if (cached && Date.now() - cached.ts < CTX_TTL) return cached;
  
  const [session] = await db.select().from(sessionTable).where(eq(sessionTable.id, sessionId));
  if (!session) return null;
  const [user] = await db.select().from(userTable).where(eq(userTable.id, session.userId));
  if (!user) return null;
  
  const projects = await db.select({ id: projects.id })
    .from(projects)
    .where(or(
      eq(projects.owner_id, user.id),
      sql`accessible_users ? ${user.id}`
    ));
  
  const ctx = {
    userId: user.id,
    role: user.role,
    accessibleProjects: new Set(projects.map(p => p.id)),
    ts: Date.now()
  };
  sessionCtxCache.set(sessionId, ctx);
  return ctx;
}

export function invalidateSessionsForUser(userId: string) {
  for (const [sid, ctx] of sessionCtxCache) {
    if (ctx.userId === userId) sessionCtxCache.delete(sid);
  }
}
```

### canSee per change_log row

```ts
function canSee(ctx: SessionCtx, row: ChangeLogRow): boolean {
  if (ctx.role === 'admin') return true;
  switch (row.table_name) {
    case 'projects':
      return ctx.accessibleProjects.has(row.row_id);
    case 'mapping_entries':
    case 'structure_entries':
    case 'photos':
    case 'floor_plans':
    case 'floor_plan_points':
    case 'sals':
    case 'typology_prices':
      return row.project_id !== null && ctx.accessibleProjects.has(row.project_id);
    case 'standalone_maps':
      return row.user_id === ctx.userId;
    case 'dropdown_options':
    case 'products':
      return true;
    default:
      return false;
  }
}
```

### Client EventStream v4

```ts
class EventStream {
  private es: EventSource | null = null;
  private listeners = new Set<Listener>();
  private lastSeq = 0;
  private sessionId: string | null = null;
  private pendingByKey = new Map<string, ChangeLogRow>();
  private flushTimer: any = null;
  
  constructor() {
    // Restore lastSeq from IndexedDB
    db.realtimeState.get('lastSeq').then(row => { if (row) this.lastSeq = row.value; });
  }
  
  start() {
    if (this.es || !navigator.onLine) return;
    const url = `/api/events/stream?sinceSeq=${this.lastSeq}`;
    this.es = new EventSource(url, { withCredentials: true });
    
    this.es.addEventListener('hello', (e: any) => {
      const { currentSeq, sessionId } = JSON.parse(e.data);
      this.sessionId = sessionId;
    });
    
    this.es.addEventListener('change', (e: any) => {
      const ev: ChangeLogRow = JSON.parse(e.data);
      const key = `${ev.table_name}:${ev.row_id}`;
      const prev = this.pendingByKey.get(key);
      if (!prev || ev.seq > prev.seq) this.pendingByKey.set(key, ev);
      this.scheduleFlush();
    });
    
    this.es.addEventListener('connection_lost', () => this.startPollingFallback());
    this.es.addEventListener('reconnected', (e: any) => {
      this.stopPollingFallback();
      const { seq } = JSON.parse(e.data);
      this.catchUp();
    });
    this.es.addEventListener('evicted', () => this.stop());
    this.es.addEventListener('ping', () => {});
    
    this.es.onerror = () => {
      this.stop();
      setTimeout(() => this.start(), 2000);  // EventSource fa reconnect ma forziamo
    };
  }
  
  private scheduleFlush() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => this.flush(), 200);
  }
  
  private async flush() {
    this.flushTimer = null;
    const events = Array.from(this.pendingByKey.values()).sort((a, b) => Number(a.seq - b.seq));
    this.pendingByKey.clear();
    for (const ev of events) {
      if (ev.seq > this.lastSeq) {
        this.lastSeq = ev.seq;
        await db.realtimeState.put({ key: 'lastSeq', value: ev.seq });
      }
      this.listeners.forEach(fn => fn(ev));
    }
  }
  
  private async catchUp() {
    if (this.lastSeq === 0) return;
    try {
      const res = await fetch(`/api/changes?sinceSeq=${this.lastSeq}`, { credentials: 'include' });
      const { data } = await res.json();
      for (const ev of data ?? []) this.listeners.forEach(fn => fn(ev));
    } catch {}
  }
  
  private pollingTimer: any = null;
  private startPollingFallback() {
    if (this.pollingTimer) return;
    this.pollingTimer = setInterval(() => this.catchUp(), 10_000);
  }
  private stopPollingFallback() {
    if (this.pollingTimer) { clearInterval(this.pollingTimer); this.pollingTimer = null; }
  }
  
  stop() {
    this.es?.close(); this.es = null;
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    this.stopPollingFallback();
  }
  
  subscribe(fn: Listener) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
}
```

### Originator session via SET LOCAL (H1 fix v4)

API setta `sessionId` derivato dalla session cookie, mai dal client:

```ts
app.use('*', async (c, next) => {
  const sessionId = c.get('sessionId');  // server-derived
  if (sessionId && ['POST', 'PATCH', 'DELETE'].includes(c.req.method)) {
    // Wrap query execution in tx con SET LOCAL
    c.set('txWrap', async (fn) => db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL opimappa.originator_session = ${sessionId}`);
      return fn(tx);
    }));
  }
  await next();
});
```

---

## 9. Frontend shim — apiClient v4

### Surface completa

Pattern reali da audit (`mappings.ts:729`, `floorPlans.ts:872`, `floorPlanUtils.ts:482`):

```ts
interface ApiClient {
  from(table: string): QueryBuilder;
  storage: { from(bucket: string): StorageBucket };
  auth: AuthClient;
}

interface QueryBuilder {
  // Select con opzioni (C8)
  select(cols?: string, opts?: { count?: 'exact' | 'planned' | 'estimated'; head?: boolean }): QueryBuilder;
  insert(rows): QueryBuilder;
  update(patch): QueryBuilder;
  upsert(rows, opts?: { onConflict?: string }): QueryBuilder;
  delete(): QueryBuilder;
  
  // Filtri
  eq(col, val): QueryBuilder;
  in(col, vals): QueryBuilder;
  gte(col, val): QueryBuilder;
  lte(col, val): QueryBuilder;
  
  // Ordering
  order(col, opts?: { ascending?: boolean }): QueryBuilder;
  limit(n): QueryBuilder;
  single(): QueryBuilder;
  
  // Promise-like
  then(resolve, reject): Promise<{ data, error, count? }>;
}

interface StorageBucket {
  upload(path, blob, opts?): Promise<{ data, error }>;
  download(path): Promise<{ data: Blob, error }>;
  createSignedUrl(path: string, ttl: number): Promise<{ data: { signedUrl }, error }>;     // C8: singolare
  createSignedUrls(paths: string[], ttl: number): Promise<{ data: { signedUrl, path }[], error }>;
  getPublicUrl(path): { data: { publicUrl } };
  remove(paths: string[]): Promise<{ error }>;
}
```

### Implementazione select con join PostgREST (C8)

```ts
class QueryBuilderImpl {
  private selectExpr = '*';
  private selectOpts: { count?: string; head?: boolean } = {};
  
  select(cols = '*', opts = {}) {
    this.selectExpr = cols;
    this.selectOpts = opts;
    return this;
  }
  
  private buildUrl(): string {
    const params = new URLSearchParams();
    params.set('select', this.selectExpr);
    for (const [col, op, val] of this.filters) params.append(col, `${op}.${val}`);
    if (this.orderExpr) params.set('order', this.orderExpr);
    if (this.limitN) params.set('limit', String(this.limitN));
    if (this.selectOpts.count) params.set('count', this.selectOpts.count);
    return `/api/${this.table}?${params}`;
  }
  
  async then(resolve, reject) {
    const url = this.buildUrl();
    const method = this.selectOpts.head ? 'HEAD' : 'GET';
    try {
      const res = await fetch(url, {
        method,
        credentials: 'include',
        headers: { 'X-Session-Id': eventStream.getSessionId() ?? '' }  // info, server ignora
      });
      
      // Salva lastSeq da header per gap recovery
      const seqHeader = res.headers.get('X-Server-Seq');
      if (seqHeader) eventStream.updateSeqHint(parseInt(seqHeader, 10));
      
      if (this.selectOpts.head) {
        const count = parseInt(res.headers.get('Content-Range')?.split('/')[1] ?? '0', 10);
        return resolve({ data: null, count, error: null });
      }
      
      const json = await res.json();
      return resolve({ data: json.data, count: json.count, error: json.error });
    } catch (err) {
      return resolve({ data: null, error: { message: String(err) } });
    }
  }
}
```

### Switcher

```ts
// src/lib/supabase.ts
const backend = process.env.REACT_APP_BACKEND || 'supabase';

export const supabase: any =
  backend === 'hono'
    ? createApiClient(process.env.REACT_APP_API_URL || '/api')
    : createSupabaseClient(SUPABASE_URL, SUPABASE_KEY, { /* ... */ });
```

### onAuthStateChange shim (M8 v3)

Single call site `src/db/auth.ts:391`. Eventi emessi dallo shim:
- `SIGNED_IN` → dopo `signInWithPassword` successo
- `SIGNED_OUT` → dopo `signOut`
- `TOKEN_REFRESHED` → fetch periodico `/api/auth/get-session` ogni 5min (cookie refresh silente better-auth)
- `USER_UPDATED` → emit via `EventStream` `user:changed` evento

### Online-first fetchRemoteFirst helper

```ts
// src/db/onlineFirst.ts (aggiungere)
export async function fetchRemoteFirst<T extends { id: string }>(
  entityType: SyncQueueItem['entityType'],
  table: any,
  remoteFetch: () => Promise<T[]>,
  filter: (item: SyncQueueItem) => boolean,
  mergeLocalFields?: (remote: T, existing: T | undefined) => T,
  stripForPersistence?: (remote: T) => T
): Promise<T[]> {
  if (!isOnlineAndConfigured()) return await table.toArray();
  try {
    const remote = await remoteFetch();
    const pendingIds = await getPendingEntityIds(entityType, filter);
    const merged = await applyPendingWrites(remote, entityType, filter);
    return await writeThroughCache(merged, pendingIds, table, mergeLocalFields, stripForPersistence);
  } catch (e) {
    if (isAuthError(e)) throw e;
    return await table.toArray();
  }
}
```

Refactor incrementale read path Sprint 8+ → tutti gli accessi usano `fetchRemoteFirst`.

---

## 10. Migrazione dati — pipeline v4

### Fase A — schema

1. `pg_dump --schema-only --no-owner --no-acl` da Supabase
2. Edit:
   - Rimuovi `auth.*`, RLS, policies
   - Aggiungi schema better-auth (via `@better-auth/cli generate`)
   - Crea vista `profiles` compat (§6)
   - Cambia FK `owner_id`/`created_by`/`modified_by` da `profiles(id)` → `"user"(id)`, tipo `UUID` → `TEXT`
   - Aggiungi tabella `change_log` + triggers per-tabella custom (§8)
   - Trigger `cleanup_accessible_users` con COALESCE
   - Tabella `auth_audit_log`
   - Indici: `last_modified DESC`, `project_id`, GIN su `accessible_users` (`CREATE INDEX ON projects USING GIN (accessible_users)`)
3. Applica schema su Postgres locale

### Fase B — seed users (C3 v3, M6 v4)

```ts
// scripts/seed-auth-users.ts
import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const sql = postgres(LOCAL_DATABASE_URL);

const { data: { users } } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });

// M6: legge profiles da Supabase via API, no dump tabella
const { data: profiles } = await sb.from('profiles').select('*');
const profileById = new Map(profiles!.map(p => [p.id, p]));

for (const u of users) {
  const p = profileById.get(u.id);
  if (!p) {
    console.warn(`User ${u.id} senza profile, fallback name=email`);
  }
  await sql`
    INSERT INTO "user" (id, email, name, "emailVerified", role, active, "createdAt", "updatedAt")
    VALUES (${u.id}, ${u.email}, ${p?.username ?? u.email}, true, ${p?.role ?? 'user'}, true, ${u.created_at}, ${u.updated_at ?? u.created_at})
    ON CONFLICT (id) DO NOTHING
  `;
  await sql`
    INSERT INTO "account" (id, "userId", "accountId", "providerId", password)
    VALUES (gen_random_uuid()::text, ${u.id}, ${u.email}, 'credential', NULL)
    ON CONFLICT DO NOTHING
  `;
}

// Verifica cardinality
const [{ count: userCount }] = await sql`SELECT count(*)::int AS count FROM "user"`;
if (userCount !== users.length) throw new Error(`Mismatch: ${userCount} vs ${users.length}`);
```

Post-seed: admin lancia `/api/auth/admin/set-user-password` per ogni utente. Password comunicata fuori-banda.

### Fase C — dati business

```bash
# pg_dump completo eccetto profiles (già migrata)
pg_dump --data-only --no-owner --no-acl \
  --exclude-table=public.profiles \
  --exclude-table=auth.* \
  -h $SUPABASE_HOST -U postgres -d postgres > data.sql

psql -h localhost -U opimappa -d opimappa -f data.sql
```

### Fase D — storage migration ricorsiva + URL rewrite (C7)

```ts
// scripts/migrate-supabase-storage.ts
import { createClient } from '@supabase/supabase-js';
import { S3Client, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { fileTypeFromBuffer } from 'file-type';
import postgres from 'postgres';
import crypto from 'crypto';

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const s3 = new S3Client({ endpoint: MINIO_ENDPOINT, region: 'us-east-1', credentials: { accessKeyId, secretAccessKey }, forcePathStyle: true });
const sql = postgres(LOCAL_DATABASE_URL);

// Ricorsivo: lista bucket → per ogni prefix lista oggetti → download → upload MinIO
async function migrateBucket(bucket: string) {
  const visited = new Set<string>();
  const queue: string[] = [''];  // start at root
  
  while (queue.length) {
    const prefix = queue.shift()!;
    let offset = 0;
    while (true) {
      const { data: items } = await sb.storage.from(bucket).list(prefix, { limit: 1000, offset });
      if (!items?.length) break;
      
      for (const item of items) {
        if (item.id === null) {
          // folder
          const newPrefix = prefix ? `${prefix}/${item.name}` : item.name;
          if (!visited.has(newPrefix)) { visited.add(newPrefix); queue.push(newPrefix); }
        } else {
          const fullPath = prefix ? `${prefix}/${item.name}` : item.name;
          await migrateObject(bucket, fullPath, item.metadata);
        }
      }
      offset += items.length;
      if (items.length < 1000) break;
    }
  }
}

async function migrateObject(bucket: string, path: string, meta: any) {
  const { data: blob } = await sb.storage.from(bucket).download(path);
  if (!blob) return;
  const buf = Buffer.from(await blob.arrayBuffer());
  const mime = meta?.mimetype ?? (await fileTypeFromBuffer(buf))?.mime ?? 'application/octet-stream';
  
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: path,
    Body: buf,
    ContentType: mime
  }));
  
  // Log hash per verifica
  const hash = crypto.createHash('sha256').update(buf).digest('hex');
  await sql`INSERT INTO _storage_migration_log (bucket, path, sha256, size, ts) VALUES (${bucket}, ${path}, ${hash}, ${buf.length}, now())`;
}

// URL rewrite in DB: tutto ciò che era public URL Supabase → path canonico
async function rewriteUrls() {
  const SUPABASE_PUBLIC_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/`;
  
  // photos.url, photos.thumbnail_url
  await sql`
    UPDATE photos SET
      url = CASE WHEN url LIKE ${SUPABASE_PUBLIC_PREFIX + '%'} THEN substring(url FROM ${SUPABASE_PUBLIC_PREFIX.length + 1}) ELSE url END,
      thumbnail_url = CASE WHEN thumbnail_url LIKE ${SUPABASE_PUBLIC_PREFIX + '%'} THEN substring(thumbnail_url FROM ${SUPABASE_PUBLIC_PREFIX.length + 1}) ELSE thumbnail_url END
  `;
  
  // floor_plans.image_url, .thumbnail_url, .pdf_url
  await sql`
    UPDATE floor_plans SET
      image_url = CASE WHEN image_url LIKE ${SUPABASE_PUBLIC_PREFIX + '%'} THEN substring(image_url FROM ${SUPABASE_PUBLIC_PREFIX.length + 1}) ELSE image_url END,
      thumbnail_url = CASE WHEN thumbnail_url LIKE ${SUPABASE_PUBLIC_PREFIX + '%'} THEN substring(thumbnail_url FROM ${SUPABASE_PUBLIC_PREFIX.length + 1}) ELSE thumbnail_url END,
      pdf_url = CASE WHEN pdf_url LIKE ${SUPABASE_PUBLIC_PREFIX + '%'} THEN substring(pdf_url FROM ${SUPABASE_PUBLIC_PREFIX.length + 1}) ELSE pdf_url END
  `;
  
  // standalone_maps.image_url, .thumbnail_url, .pdf_url
  await sql`UPDATE standalone_maps SET image_url = ..., thumbnail_url = ..., pdf_url = ...`;
}

// Verifica hash sample stratificato
async function verifySample() {
  for (const bucket of ['photos', 'planimetrie']) {
    const rows = await sql`
      SELECT bucket, path, sha256 FROM _storage_migration_log
      WHERE bucket = ${bucket}
      ORDER BY random() LIMIT 50
    `;
    for (const row of rows) {
      const obj = await s3.send(new GetObjectCommand({ Bucket: row.bucket, Key: row.path }));
      const buf = Buffer.concat(await streamToBuffer(obj.Body));
      const actualHash = crypto.createHash('sha256').update(buf).digest('hex');
      if (actualHash !== row.sha256) throw new Error(`Hash mismatch: ${row.bucket}/${row.path}`);
    }
    console.log(`✓ ${bucket}: 50 sample verified`);
  }
}

await migrateBucket('photos');
await migrateBucket('planimetrie');
await rewriteUrls();
await verifySample();
```

### Fase E — verifica end-to-end

- Row count per tabella vs Supabase: `SELECT count(*) FROM <each>` (H6)
- Hash SHA256 di 50 oggetti random per bucket
- 20 progetti random fetched via nuovo API confrontati con dump Supabase

---

## 11. Networking — Cloudflare Tunnel + Caddy

### Cloudflare setup

1. Acquista `opimappa.com` su Cloudflare Registrar
2. Cloudflare Turnstile site key/secret per captcha login (M4)
3. Tunnel principale `opimappa-prod` → `opimappa.com` + `staging.opimappa.com`
4. Direct MinIO via Tailscale per upload >50MB (H2): client autenticati VPN-internal

### Upload chunked >50MB (H2)

```ts
// src/utils/uploadLarge.ts
async function uploadLarge(file: File, bucket: string, key: string) {
  if (file.size <= 5 * 1024 * 1024) return apiClient.storage.from(bucket).upload(key, file);
  
  // S3 multipart init
  const init = await fetch('/api/storage/upload-presigned', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify({ bucket, key, partCount: Math.ceil(file.size / (5 * 1024 * 1024)) })
  });
  const { uploadId, urls } = await init.json();
  
  // Upload parts in parallel (max 3 concurrent)
  const partSize = 5 * 1024 * 1024;
  const parts: { ETag: string; PartNumber: number }[] = [];
  for (let i = 0; i < urls.length; i++) {
    const slice = file.slice(i * partSize, (i + 1) * partSize);
    const res = await fetch(urls[i], { method: 'PUT', body: slice });
    parts.push({ ETag: res.headers.get('ETag')!, PartNumber: i + 1 });
  }
  
  // Finalize
  await fetch('/api/storage/upload-complete', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify({ bucket, key, uploadId, parts })
  });
}
```

API side: usa S3 multipart presigned URLs, ogni chunk <5MB (sotto CF 100MB body limit).

### Caddyfile (path-based, SSE-aware)

```
{
  email admin@opimappa.com
  auto_https off
}

:80 {
  encode gzip zstd
  
  handle /api/events/stream {
    reverse_proxy api:3000 {
      flush_interval -1
      transport http { read_timeout 0; write_timeout 0 }
    }
  }
  
  handle /api/* {
    reverse_proxy api:3000 {
      header_up X-Real-IP {remote_host}
    }
  }
  
  handle {
    root * /srv/web
    try_files {path} /index.html
    file_server
    
    @assets path /static/*
    header @assets Cache-Control "public, max-age=31536000, immutable"
    
    @html path /index.html
    header @html Cache-Control "no-cache, must-revalidate"
    
    @sw path /service-worker.js
    header @sw Cache-Control "no-cache, must-revalidate"
  }
  
  header {
    Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
    X-Content-Type-Options "nosniff"
    X-Frame-Options "DENY"
    Referrer-Policy "strict-origin-when-cross-origin"
    Permissions-Policy "geolocation=(self), camera=(self), microphone=()"   # H7
    -Server
  }
}
```

CSP allineato a `vercel.json` esistente, rimossi origin Supabase.

---

## 12. Backup strategy

### Cron

```cron
0 2 * * * opimappa /opt/opimappa/scripts/backup-postgres.sh
0 3 * * 0 opimappa /opt/opimappa/scripts/backup-minio.sh
0 4 * * * opimappa /opt/opimappa/scripts/backup-restic.sh
0 5 1 * * opimappa /opt/opimappa/scripts/test-restore.sh
0 1 * * * opimappa /opt/opimappa/scripts/changelog-cleanup.sh
```

### test-restore.sh — count(*) (H6)

```bash
#!/bin/bash
set -euo pipefail
LATEST=$(ls -t /mnt/backup/opimappa/pg-dumps/*.dump | head -1)

docker run -d --name pg_restore_test -e POSTGRES_PASSWORD=test postgres:17-alpine
sleep 5
docker exec pg_restore_test createdb -U postgres test_restore
docker cp "$LATEST" pg_restore_test:/dump.dump
docker exec pg_restore_test pg_restore -U postgres -d test_restore /dump.dump

# Schema diff
docker exec pg_restore_test pg_dump -U postgres -s test_restore | grep -v '^--' | grep -v '^$' > /tmp/restore.schema
docker exec opimappa_postgres pg_dump -U opimappa -s opimappa | grep -v '^--' | grep -v '^$' > /tmp/prod.schema
diff /tmp/restore.schema /tmp/prod.schema || { echo "Schema diff FAIL"; exit 2; }

# Row counts exact per ogni tabella public (H6: count(*) non n_live_tup)
TABLES=$(docker exec opimappa_postgres psql -U opimappa -At -d opimappa -c "
  SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename
")

for t in $TABLES; do
  PROD=$(docker exec opimappa_postgres psql -U opimappa -At -d opimappa -c "SELECT count(*) FROM \"$t\"")
  REST=$(docker exec pg_restore_test psql -U postgres -At -d test_restore -c "SELECT count(*) FROM \"$t\"")
  if [ "$PROD" != "$REST" ]; then
    echo "Row count diff on $t: prod=$PROD restore=$REST"
    exit 3
  fi
done

docker rm -f pg_restore_test
echo "Restore test OK"
```

### changelog-cleanup.sh

```bash
#!/bin/bash
docker exec opimappa_postgres psql -U opimappa -d opimappa -c "
  DELETE FROM change_log WHERE changed_at < now() - interval '30 days';
"
```

### Restic → R2 EU Frankfurt

```bash
export RESTIC_REPOSITORY=s3:https://<account>.eu.r2.cloudflarestorage.com/opimappa-backups
export RESTIC_PASSWORD_FILE=/opt/opimappa/.restic-pass
export AWS_ACCESS_KEY_ID=$R2_KEY AWS_SECRET_ACCESS_KEY=$R2_SECRET

restic backup \
  /mnt/backup/opimappa/pg-dumps \
  /mnt/backup/opimappa/minio-mirror \
  /opt/opimappa/docker-compose.yml \
  /opt/opimappa/.env \
  /opt/opimappa/api/src \
  /opt/opimappa/caddy/Caddyfile

restic forget --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune
restic check --read-data-subset=5%
```

---

## 13. Test isolation tenant — CI

```ts
describe('tenant isolation', () => {
  it('user B cannot read user A projects via REST', async () => { /* ... */ });
  it('user B cannot subscribe to user A events via SSE', async () => { /* ... */ });
  it('user B with accessibleUsers grant sees A project + child entities', async () => { /* ... */ });
  it('admin sees everything', async () => { /* ... */ });
  it('originator filter: self-mutation does NOT emit SSE echo to self', async () => { /* ... */ });
  it('SSE evicts existing connection from same session on reopen', async () => { /* ... */ });
  it('SSE catch-up via sinceSeq returns missed events', async () => { /* ... */ });
  it('SQL injection via query param: rejected 400', async () => { /* ... */ });
  it('structure_entries isolated like mapping_entries', async () => { /* ... */ });
  it('photos via JOIN derive project_id from mapping_entry OR structure_entry', async () => { /* ... */ });
  it('floor_plan_points via JOIN derive project_id from floor_plan', async () => { /* ... */ });
  it('standalone_maps scoped by user_id, not project', async () => { /* ... */ });
  it('cleanup_accessible_users handles last-user case (no NULL)', async () => { /* ... */ });
  it('profiles view: SELECT works, INSERT blocks with error', async () => { /* ... */ });
  it('accessible_users JSONB ?: containment correct, not text[] cast', async () => { /* ... */ });
});

// Fuzz
describe('query parser fuzz', () => {
  test.prop([fc.string(), fc.string()])('arbitrary input never causes 500', /* ... */);
});
```

---

## 14. Sicurezza — hardening

- [ ] UFW deny + allow 22 da Tailscale `100.64.0.0/10`
- [ ] SSH password disabled, fail2ban
- [ ] unattended-upgrades
- [ ] Postgres bind solo `opimappa_net`
- [ ] MinIO console solo Tailscale
- [ ] `.env` chmod 600
- [ ] Restic passphrase in Bitwarden
- [ ] CF Turnstile per login captcha post-5-fail (M4)
- [ ] Rate limit `(IP, email)` backoff progressivo, no permanent lockout (M4)
- [ ] Postgres auth `scram-sha-256`
- [ ] MinIO API key dedicata, policy minima
- [ ] `cap_drop: [ALL]` su web, caddy, cloudflared; postgres/minio cap default
- [ ] `read_only: true` web e caddy; tmpfs `/tmp`, `/var/cache/nginx`, `/var/run`
- [ ] Image digest pin in produzione (M1)
- [ ] Service Worker safeguard (C9 — vedi §15.4)
- [ ] CSP allineato a `vercel.json` post-cleanup Supabase origins
- [ ] Audit log Postgres su login fallito, escalation tentata, cross-tenant tentato
- [ ] Postgres `log_statement = 'ddl'` per audit DDL

---

## 15. Roadmap operativa

### Sprint 0 — preparazione (1-2 giorni)

```
[ ] 0.1  Backup completo Supabase corrente
[ ] 0.2  Registra opimappa.com su CF Registrar + Turnstile site key
[ ] 0.3  ssh-copy-id su demeter227
[ ] 0.4  Crea utente opimappa (no shell), docker group
[ ] 0.5  mkdir /opt/opimappa/{data,api,web,caddy,scripts}
[ ] 0.6  UFW + fail2ban + SSH password disable
[ ] 0.7  unattended-upgrades enable
[ ] 0.8  apcupsd + hook email su onbatt/commfailure
```

### Sprint 1 — infrastruttura (2-3 giorni)

```
[ ] 1.1  docker-compose.yml + .env template (digest pin)
[ ] 1.2  Up Postgres + MinIO standalone, smoke test
[ ] 1.3  MinIO bucket photos, planimetrie + API key dedicata
[ ] 1.4  Adatta supabase/schema.sql v4:
         - rimuovi auth.*/RLS
         - schema better-auth
         - cambio FK profiles → "user" (TEXT)
         - vista profiles compat
         - structure_entries verificata in schema
         - change_log table + triggers per-tabella (10 triggers, C5)
         - cleanup_accessible_users con COALESCE (C4)
         - indici GIN su accessible_users
[ ] 1.5  Applica schema
[ ] 1.6  Setup Caddy + Cloudflared
[ ] 1.7  Verifica opimappa.com risponde Caddy
[ ] 1.8  Stack staging in /opt/opimappa-staging/ isolato (M3)
```

### Sprint 2 — API core (6-8 giorni)

```
[ ] 2.1  Scaffold Hono + Drizzle + better-auth
[ ] 2.2  drizzle-kit introspect + diff manuale vs schema (M7 v3)
[ ] 2.3  Configura better-auth con admin plugin
[ ] 2.4  Middleware requireUser/requireAdmin + sessionId server-derived (H1 v4)
[ ] 2.5  Query parser whitelist + join PostgREST (C8) + fuzz test
[ ] 2.6  Generic CRUD handler con scopeProjectFilter (JSONB ? operator, C3)
[ ] 2.7  Route 13 tabelle (incluso structure_entries, profiles view)
[ ] 2.8  Admin endpoints better-auth nomi esatti (H5)
[ ] 2.9  Test isolation baseline tutte tabelle (§13)
[ ] 2.10 Rate limit backoff progressivo + Turnstile (M4)
[ ] 2.11 auth_audit_log middleware
```

### Sprint 3 — Storage + Realtime (4-5 giorni)

```
[ ] 3.1  Storage routes presigned URLs
[ ] 3.2  Multipart chunked upload >50MB (H2)
[ ] 3.3  change_log table + 10 triggers per-tabella (C5, C6)
[ ] 3.4  LISTEN reconnect loop + drainSince(seq)
[ ] 3.5  SSE /events/stream con sinceSeq catch-up, originator filter, max 1/session (M3)
[ ] 3.6  /api/changes?sinceSeq= gap recovery REST
[ ] 3.7  Test SSE e2e: 2 client, mutation A → B riceve, A no echo
[ ] 3.8  Test isolation SSE per ogni tabella (C5)
[ ] 3.9  Test sinceSeq dopo disconnect 5min: nessun evento perso
[ ] 3.10 Test connection_lost: kill pg, verifica fallback polling client
```

### Sprint 4 — Migrazione dati (2-3 giorni)

```
[ ] 4.1  pg_dump schema Supabase
[ ] 4.2  Adattamento schema v4
[ ] 4.3  Seed users via Supabase admin API (UUID preservati, M6)
[ ] 4.4  pg_dump --data-only --exclude-table=profiles
[ ] 4.5  Restore data locale
[ ] 4.6  Admin set-password per ogni utente, comunica fuori-banda
[ ] 4.7  Storage migration ricorsiva + URL rewrite + hash verify (C7, H7 v3)
[ ] 4.8  Verifica end-to-end: count(*), hash sample stratificato
```

### Sprint 5 — Frontend shim (6-8 giorni)

```
[ ] 5.1  src/lib/apiClient.ts query builder + count/head + join (C8)
[ ] 5.2  src/lib/apiClient.ts storage con createSignedUrl singolare (C8)
[ ] 5.3  Switcher in src/lib/supabase.ts via REACT_APP_BACKEND
[ ] 5.4  src/realtime/eventStream.ts con sinceSeq persistence Dexie
[ ] 5.5  Aggiungi tabella Dexie realtimeState (lastSeq) + authCache (offline login)
[ ] 5.6  Offline login con encrypted token (H3 v4)
[ ] 5.7  onAuthStateChange shim mapping eventi (M8 v3)
[ ] 5.8  Refactor src/db/onlineFirst.ts: fetchRemoteFirst helper
[ ] 5.9  Service Worker safeguard pre-clearAndSync (C9)
[ ] 5.10 Bump SW version + skipWaiting + safeguard flow
[ ] 5.11 Build con REACT_APP_BACKEND=hono REACT_APP_API_URL=/api
[ ] 5.12 Smoke test desktop: login, list, detail, modifica, foto, PostgREST count/head
[ ] 5.13 Smoke test offline: modifica, riconnetti, flush + SSE catch-up sinceSeq
[ ] 5.14 Smoke test Safari iOS PWA
```

### Sprint 6 — Staging + beta (1 settimana)

```
[ ] 6.1  Deploy build su staging stack
[ ] 6.2  CF Tunnel ingress staging.opimappa.com
[ ] 6.3  Invita 2-3 tester
[ ] 6.4  Monitoring: log, slow query, MinIO bytes, SSE active, change_log size
[ ] 6.5  Issue tracker bug + fix
[ ] 6.6  Load test: 50 SSE × 100 mutation/min × 30min
[ ] 6.7  Test cross-tenant manuale: 2 utenti reali con scope diversi
```

### Sprint 7 — Cutover (1 giorno, write-freeze) (H4)

```
[ ] 7.1  T-24h: TTL DNS opimappa.com → 60s
[ ] 7.2  T-30min: annuncio utenti write-freeze imminente
[ ] 7.3  T-0:    Supabase write-freeze (revoca write su anon key)
[ ] 7.4  Final delta sync Supabase → locale (modifiche ultimi N min)
[ ] 7.5  DNS swap → tunnel prod
[ ] 7.6  SW bump + skipWaiting + clearAndSync safeguarded
[ ] 7.7  Comunica utenti reload
[ ] 7.8  Monitor 2h
[ ] 7.9  Su anomalia: rollback (vedi §16)
```

### Sprint 8 — Post-cutover (2 settimane)

```
[ ] 8.1  Restic R2 EU + cron + alert
[ ] 8.2  test-restore.sh count(*) mensile
[ ] 8.3  UPS auto-shutdown verifica
[ ] 8.4  Healthcheck endpoint + cron monitor → Pushover
[ ] 8.5  Runbook scritto: restore, rollback, credenziali
[ ] 8.6  Refactor incrementale read path → fetchRemoteFirst
[ ] 8.7  T+14gg stabili → cancella Supabase
[ ] 8.8  Valuta WAL archiving / PITR (L4 v3)
```

### Tempi totali rivisti

| Sprint | Giorni |
|---|---|
| 0. Preparazione | 1-2 |
| 1. Infrastruttura | 2-3 |
| 2. API core | 6-8 |
| 3. Storage + Realtime | 4-5 |
| 4. Migrazione dati | 2-3 |
| 5. Frontend shim | 6-8 |
| 6. Beta staging | 5-7 |
| 7. Cutover | 1 |
| 8. Post-cutover | 5 (parallelo) |
| **Totale** | **27-37 giorni effettivi = 7-9 settimane part-time** |

---

## 16. Rollback plan (H4 — reverse-delta)

**Trigger:** error rate > 5% per 15min, o richiesta esplicita.

**Strategia: write-freeze + reverse-delta**

### Pre-cutover (Sprint 7.1-7.4)

- DNS TTL abbassato 24h prima
- Annuncio utenti T-30min: nessuna scrittura per ~10min durante swap
- Supabase write-freeze: revoca grant scrittura su `anon` role (`REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM anon`)
- Frontend: durante freeze, modifiche restano in `syncQueue` Dexie (offline-first), nessuna perdita

### Post-cutover error

```
T+0    Anomalia rilevata
T+1m   Decisione rollback
T+2m   DNS swap inverso → Vercel + Supabase
T+3m   Re-enable Supabase write (riapplica grant)
T+5m   Frontend rebuild REACT_APP_BACKEND=supabase, deploy Vercel
T+10m  Comunica utenti reload
T+...  Reverse-delta script: home server → Supabase (vedi sotto)
```

### Reverse-delta script

```ts
// scripts/reverse-delta-supabase.ts
// Esegui DOPO rollback DNS, transfer modifiche fatte sul nuovo backend
import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';

const local = postgres(LOCAL_DATABASE_URL);
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Tutti i record modificati POST-cutover (changed_at > cutoverTimestamp)
const CUTOVER_TS = process.argv[2];  // ISO timestamp

for (const table of ['projects', 'mapping_entries', 'structure_entries', 'photos', 'floor_plans', 'floor_plan_points', 'standalone_maps', 'sals', 'typology_prices']) {
  const rows = await local`
    SELECT DISTINCT row_id, op FROM change_log
    WHERE table_name = ${table} AND changed_at > ${CUTOVER_TS}
  `;
  
  for (const { row_id, op } of rows) {
    if (op === 'DELETE') {
      await sb.from(table).delete().eq('id', row_id);
    } else {
      const [record] = await local`SELECT * FROM ${sql.identifier([table])} WHERE id = ${row_id}`;
      if (record) {
        await sb.from(table).upsert(record);
      }
    }
  }
  console.log(`Transferred ${rows.length} changes for ${table}`);
}

// Storage: enumera change_log per photos/floor_plans/standalone_maps, copia MinIO → Supabase
```

Tempo esecuzione stimato: dipende da numero modifiche post-cutover. Ipotesi: ~100 modifiche/giorno × 1 giorno = ~5 minuti script run.

**Dati persi possibili:** modifiche frontend offline durante minuti rollback (cache PWA). Mitigazione: feature flag forzato `REACT_APP_BACKEND=supabase` su client trigger nuovo sync queue flush verso Supabase, NON verso nuovo backend.

---

## 17. Decisioni confermate

1. ✅ Dominio: `opimappa.com`
2. ✅ Branch: `origin/master`
3. ✅ Multi-user, no public signup, admin crea account
4. ✅ Online-first + offline-resilience garantita
5. ✅ No email transazionali (admin set-password manuale)
6. ✅ UPS + alerting `apcupsd`
7. ✅ ORM Drizzle, Auth better-auth nativo + plugin admin
8. ✅ Realtime SSE + change_log durabile + cursor `seq`
9. ✅ Frontend: shim path-based same-origin
10. ✅ Storage: MinIO + presigned + multipart chunked + Tailscale direct
11. ✅ Backup: HDD locale + R2 EU + test restore count(*) mensile
12. ✅ Migrazione UUID-preserving + storage ricorsivo + URL rewrite
13. ✅ Strategy: write-freeze cutover + reverse-delta rollback
14. ✅ `profiles` mantenuta come vista compat (no refactor frontend)
15. ✅ 13 tabelle sincronizzate (incluso `structure_entries`)

---

## 18. Punti aperti

- WAL archiving / PITR: decisione post-cutover stabile
- Vercel hot-standby: mantieni 60gg post-cutover
- Watchtower auto-update: scartato
- Email transazionali: aggiungere solo se signup pubblico
- Refactor completo read path → fetchRemoteFirst: lavoro continuo Sprint 8+
- Considera `pgbouncer` davanti a Postgres se SSE listeners + API connection pool conflitto
- Considera `pgvector` futuro per search semantica progetti (non in scope migrazione)

---

**Fine piano v4.**
