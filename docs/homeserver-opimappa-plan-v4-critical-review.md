# OPImaPPA Home Server Plan v4 - Critical Review

**Documento recensito:** `C:\Users\salva\Downloads\homeserver-opimappa-plan-v4.md`  
**Data review:** 2026-05-12  
**Verdetto sintetico:** v4 e molto piu matura di v3, ma non e ancora implementabile senza una v4.1. I problemi residui non sono piu "manca una macro-area"; sono incoerenze end-to-end in realtime, compat auth/profiles, parser PostgREST, storage path e rollback.

---

## Executive Summary

La v4 ha recepito bene i finding principali della v3:

- `structure_entries` e stata aggiunta.
- `change_log` durabile e stata introdotta.
- `profiles` e mantenuta come compat layer.
- Storage migration e diventata ricorsiva.
- Lo shim include count/head, join e `createSignedUrl`.
- Rollback introduce write-freeze e reverse-delta.

Pero alcune correzioni sono ancora fragili:

1. La semantica `seq` del `change_log` puo duplicare o saltare eventi.
2. `profiles` come view non copre delete e puo rompersi con id non UUID.
3. Il parser PostgREST non copre davvero il join usato dal codice reale.
4. Storage URL rewrite non gestisce signed URL e path canonici in modo sicuro.
5. Il rollback reverse-delta perde ordine e puo confliggere con nuove scritture Supabase.
6. Il freeze Supabase blocca `anon`, ma non necessariamente `authenticated`.

---

## Findings Critici

### C1 - `change_log` replay: `drainSince(seq)` ridrena gli eventi sbagliati

**Severita:** Critica  
**Impatto:** notifiche duplicate, eventi nuovi non consegnati, realtime apparentemente "vivo" ma semanticamente errato.

Nel piano:

```ts
async function drainSince(seq: bigint) {
  const rows = await db.execute(sql`
    SELECT seq, table_name, row_id, op, project_id, user_id, originator
    FROM change_log
    WHERE seq <= ${seq}
    ORDER BY seq ASC
    LIMIT 1000
  `);
}
```

Riferimento piano: `homeserver-opimappa-plan-v4.md:755`.

**Problema:** manca un limite inferiore. A ogni notify il server puo rileggere sempre i primi 1000 eventi storici, duplicando notifiche e ignorando eventi successivi al millesimo.

**Fix richiesto:**

```ts
let lastDrainedSeq = 0;

async function drainUntil(targetSeq: number) {
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
    lastDrainedSeq = rows[rows.length - 1].seq;
  }
}
```

Aggiornare `lastDrainedSeq` solo dopo dispatch riuscito.

---

### C2 - `lastNotifiedSeq` riparte da 0 dopo restart API

**Severita:** Critica  
**Impatto:** client non fanno catch-up dopo restart API e possono perdere eventi.

Nel piano:

```ts
let lastNotifiedSeq = 0;
```

Riferimento piano: `homeserver-opimappa-plan-v4.md:724`.

L'`hello` manda `currentSeq: lastNotifiedSeq`. Se l'API riparte con `lastNotifiedSeq = 0` ma il DB contiene gia `change_log.seq = 5000`, il client puo ricevere un currentSeq arretrato e non attivare catch-up.

**Fix richiesto:**

All'avvio:

```sql
SELECT COALESCE(max(seq), 0) AS max_seq FROM change_log;
```

Usare quel valore come `currentSeq` e come baseline di drain.

---

### C3 - `X-Server-Seq` su ogni response puo far saltare eventi

**Severita:** Critica  
**Impatto:** il client marca eventi come "visti" senza averli applicati a Dexie.

Il piano dice:

```md
{ data, error, count? } + header X-Server-Seq: <lastSeq> ad ogni response -> client salva come lastSeq
```

Riferimenti:

- `homeserver-opimappa-plan-v4.md:562`
- `homeserver-opimappa-plan-v4.md:1089`

**Problema:** una GET normale puo restituire il massimo `seq` server-side, ma il client non ha ancora processato quegli eventi. Se salva quel valore come `lastSeq`, il prossimo `/api/changes?sinceSeq=` salta eventi necessari.

**Fix richiesto:**

Separare:

- `serverSeenSeq`: hint informativo.
- `appliedSeq`: ultimo evento effettivamente applicato a Dexie.

Solo `appliedSeq` deve essere usato per `sinceSeq`.

---

### C4 - `catchUp()` client non persiste `lastSeq`

**Severita:** Critica  
**Impatto:** polling fallback riscarica sempre gli stessi eventi; recovery non avanza.

Nel piano:

```ts
private async catchUp() {
  const res = await fetch(`/api/changes?sinceSeq=${this.lastSeq}`, { credentials: 'include' });
  const { data } = await res.json();
  for (const ev of data ?? []) this.listeners.forEach(fn => fn(ev));
}
```

Riferimento piano: `homeserver-opimappa-plan-v4.md:962`.

**Problema:** gli eventi catch-up non passano da `flush()` e non aggiornano `lastSeq` in IndexedDB.

**Fix richiesto:**

Creare un unico path di applicazione eventi:

```ts
private async applyEvent(ev: ChangeLogRow) {
  await Promise.all([...this.listeners].map(fn => fn(ev)));
  if (ev.seq > this.lastSeq) {
    this.lastSeq = ev.seq;
    await db.realtimeState.put({ key: 'lastSeq', value: ev.seq });
  }
}
```

Usarlo sia per SSE live sia per catch-up.

---

### C5 - Compat `profiles` incompleto: DELETE non gestito e id non UUID fragile

**Severita:** Critica  
**Impatto:** user management rotto o vista non interrogabile.

Il piano crea una view:

```sql
CREATE VIEW profiles AS
SELECT id::uuid AS id, ...
FROM "user";
```

Riferimento piano: `homeserver-opimappa-plan-v4.md:236`.

Nel repo reale ci sono call site delete su `profiles`:

- `src/db/auth.ts:357`
- `src/db/auth.ts:366`

Il piano definisce `INSTEAD OF UPDATE` e `INSTEAD OF INSERT`, ma non `INSTEAD OF DELETE`.

Inoltre `id::uuid` richiede che ogni nuovo utente better-auth abbia id UUID-string. Better-auth usa `TEXT`; se `admin/create-user` genera un id non UUID, la view `profiles` puo fallire.

**Fix richiesto:**

- Forzare `generateId` better-auth a UUID string per tutti gli utenti.
- Aggiungere `CHECK (id ~ uuid_regex)` se possibile.
- Aggiungere `INSTEAD OF DELETE ON profiles` oppure mappare lo shim `.from('profiles').delete()` a `/api/auth/admin/remove-user`.
- Test: create user -> select profiles -> update role -> delete profiles.

---

### C6 - Parser PostgREST join non copre il call site reale

**Severita:** Critica  
**Impatto:** `getPhotoCountForProject()` fallisce.

Il call site reale:

```ts
.select('id, mapping_entries!inner(id)', { count: 'exact', head: true })
.eq('mapping_entries.project_id', projectId)
```

Riferimento repo: `src/db/mappings.ts:729`.

Il parser del piano fa:

```ts
const parts = raw.split(',');
...
const joinMatch = part.match(/^(\w+)!(inner|left)\((.*)\)$/);
```

Riferimento piano: `homeserver-opimappa-plan-v4.md:528`.

**Problemi:**

- `raw.split(',')` produce `" mapping_entries!inner(id)"` con spazio iniziale; senza `trim()` il regex non matcha.
- Non e specificato supporto a filtri dotted: `mapping_entries.project_id=eq.<id>`.
- Non e specificato come produrre `Content-Range` per HEAD count con join.

**Fix richiesto:**

- `part.trim()`.
- Whitelist per dotted filters su relationship consentite.
- Test esatto sul call site `photos + mapping_entries!inner`.

---

### C7 - Storage URL rewrite non gestisce signed URL e path canonici in modo sicuro

**Severita:** Critica  
**Impatto:** asset planimetrie/foto non scaricabili dopo migrazione.

Il piano riscrive solo URL con prefix:

```ts
const SUPABASE_PUBLIC_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/`;
```

Riferimento piano: `homeserver-opimappa-plan-v4.md:1284`.

Ma nel codice reale esistono signed URL lunghi, per esempio:

- `src/utils/floorPlanUtils.ts:482` usa `createSignedUrl(pdfPath, 315360000)`.

Inoltre gli extractor attuali cercano pattern URL con `/storage/v1/object/...` o path legacy con slash bucket:

- `src/db/floorPlans.ts:96`
- `src/sync/syncDownloadHandlers.ts:173`

Se il DB viene riscritto a `planimetrie/path.pdf` senza slash iniziale o senza URL proxy, alcuni extractor possono non matchare.

**Fix richiesto:**

Scegliere una semantica unica:

- Colonne `*_storage_path` canonicali per ogni asset, anche planimetrie.
- Colonne URL generate a runtime dallo shim/API, non persistite come Supabase URL.
- Rewrite anche `/storage/v1/object/sign/...`.
- Test con:
  - foto mapping;
  - foto struttura;
  - planimetria full;
  - thumbnail;
  - PDF standalone signed legacy.

---

### C8 - Rollback reverse-delta perde ordine e puo generare conflitti

**Severita:** Critica  
**Impatto:** rollback non lossless.

Nel piano:

```ts
SELECT DISTINCT row_id, op FROM change_log
WHERE table_name = ${table} AND changed_at > ${CUTOVER_TS}
```

Riferimento piano: `homeserver-opimappa-plan-v4.md:1761`.

**Problemi:**

- `DISTINCT row_id, op` perde ordine degli eventi.
- Update seguito da delete puo essere replayato in ordine sbagliato.
- Delete seguito da recreate con stesso id non e rappresentabile correttamente.
- Il loop per tabella ignora dipendenze FK tra parent/child.
- Re-enable Supabase write avviene prima del reverse-delta, quindi utenti possono scrivere mentre il delta viene applicato.

**Fix richiesto:**

- Tenere Supabase in freeze fino a reverse-delta completato.
- Replay ordinato per `seq`, non per tabella con `DISTINCT`.
- Oppure compattare con regole esplicite: ultimo evento per row, piu ordinamento parent/child.
- Storage reverse sync deve essere implementato, non commentato.

---

### C9 - Write-freeze Supabase revoca solo `anon`, non `authenticated`

**Severita:** Critica  
**Impatto:** utenti loggati potrebbero continuare a scrivere su Supabase durante freeze.

Il piano:

```sql
REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM anon
```

Riferimento piano: `homeserver-opimappa-plan-v4.md:1732`.

Le policy Supabase reali usano anche role `authenticated`, ad esempio:

- `supabase/schema.sql:687`
- `supabase/storage-policies.sql:31`

**Fix richiesto:**

Usare una delle opzioni:

- Revoca anche a `authenticated` dove applicabile.
- Feature flag/policy di manutenzione globale in RLS.
- Bloccare storage policies oltre alle tabelle.
- Verificare con test: utente loggato non puo fare insert/update/delete durante freeze.

---

## Findings Alti

### H1 - Rate limit middleware consuma il body della request

Nel piano:

```ts
const { email } = await c.req.json();
await next();
```

Riferimento: `homeserver-opimappa-plan-v4.md:323`.

In Hono/fetch, leggere il body puo consumarlo prima del handler better-auth. Serve clone/cache body o middleware integrato nel route handler auth.

---

### H2 - Retention change_log a 30 giorni contraddice offline-resilience lunga

Il piano cancella:

```sql
DELETE FROM change_log WHERE changed_at < now() - interval '30 days';
```

Riferimento: `homeserver-opimappa-plan-v4.md:591`.

Se una PWA resta offline oltre 30 giorni, `sinceSeq` puo essere piu vecchio del minimo disponibile. Serve risposta API esplicita:

```json
{ "error": "cursor_expired", "fullResyncRequired": true }
```

Il client deve full-resync preservando pending writes.

---

### H3 - Trigger SQL ancora placeholder per tabelle importanti

Nel piano:

```sql
-- floor_plans: analogo a mapping_entries
-- sals, typology_prices: trigger analogo
-- dropdown_options, products: globali
```

Riferimenti:

- `homeserver-opimappa-plan-v4.md:675`
- `homeserver-opimappa-plan-v4.md:716`

Per implementazione serve SQL completo, non placeholder, soprattutto per delete e global tables.

---

### H4 - Cascading delete non e specificato

Se elimini un progetto, i trigger figli potrebbero eseguire dopo che parent e gia sparito e non riuscire a derivare `project_id` via join.

Serve test esplicito:

- delete project;
- change_log contiene eventi sufficienti;
- client remoto pruna project, mapping, structure, photos, floor plans, points, SAL e prices.

Possibile soluzione: su delete parent, loggare un evento `projects DELETE` e lasciare che il client pruni subtree localmente senza dipendere dagli eventi figli.

---

### H5 - Multipart upload: commento e soglia tecnicamente imprecisi

Il piano dice:

```md
ogni chunk <5MB
```

Riferimento: `homeserver-opimappa-plan-v4.md:1381`.

Per S3-compatible multipart, le parti devono essere 5 MiB - 5 GiB, eccetto l'ultima. Il codice usa esattamente `5 * 1024 * 1024`, che va bene, ma il commento e sbagliato e puo portare a implementazione sotto soglia.

Fonte: https://docs.aws.amazon.com/AmazonS3/latest/userguide/qfacts.html

---

### H6 - Presigned multipart URLs devono essere raggiungibili dal browser

Se MinIO resta solo su Docker network/Tailscale, gli utenti esterni non possono usare presigned PUT diretti. Se invece passano da Cloudflare, torna il vincolo body size per request, anche se mitigato da chunk.

Il piano deve distinguere:

- utenti Tailscale: direct MinIO URL interno;
- utenti esterni: URL Cloudflare/API o proxy chunk;
- CSP/connect-src per endpoint storage.

---

### H7 - Offline token cifrato con password: design buono ma incompleto

Manca dettaglio critico su:

- salt per PBKDF2/Argon2id client-side;
- parametri KDF;
- WebCrypto availability su Safari iOS PWA;
- rate-limit locale per tentativi offline;
- revoca server-side: un token offline resta valido fino a 30 giorni anche se admin banna utente.

Serve accettare esplicitamente questo tradeoff o ridurre TTL.

---

## Findings Medi

### M1 - `profiles` view + colonne TEXT puo creare drift TypeScript

Il frontend TypeScript oggi tipizza `profiles.id` come string UUID, ma DB business passerebbe a `TEXT`. Va bene lato TS, ma i parser `uuid` nella whitelist API non devono validare come UUID se si decide TEXT ovunque.

### M2 - `owner_id` TEXT e `project_id` UUID misti aumentano cast impliciti

Il piano uniforma user ids a TEXT, ma lascia `project_id UUID`. Va bene, ma ogni helper deve essere esplicito: user id TEXT, entity id UUID dove previsto. Non usare genericamente tipo `uuid` per tutti gli id.

### M3 - Test restore schema diff via `grep -v` puo essere rumoroso

Meglio usare `pg_dump --schema-only --no-owner --no-acl` e normalizzare estensioni/owner/search_path in modo deterministico.

### M4 - `change_log` retention va monitorata non solo cancellata

Serve alert se:

- `min(seq)` si avvicina ai client attivi piu vecchi;
- `change_log` cresce troppo;
- cleanup fallisce.

### M5 - `MAX_SSE_PER_SESSION = 1` puo impattare tab multiple stesse session

Molte tab nello stesso browser condividono cookie/sessione. Aprire due tab puo evictare continuamente. Serve test reale con PWA + tab desktop.

---

## Checklist v4.1 Prima Dell'Implementazione

- [ ] Correggere `drainSince` con `lastDrainedSeq` e range `seq > lastDrainedSeq`.
- [ ] Inizializzare `currentSeq` da `SELECT max(seq)`.
- [ ] Separare `serverSeenSeq` e `appliedSeq` nel client.
- [ ] Fare avanzare `lastSeq` anche in catch-up, solo dopo applicazione evento.
- [ ] Aggiungere `INSTEAD OF DELETE` per `profiles` o mapping shim verso `admin/remove-user`.
- [ ] Forzare better-auth user id a UUID string.
- [ ] Aggiungere `trim()` e dotted filter support al parser PostgREST.
- [ ] Testare esattamente `select('id, mapping_entries!inner(id)', { count:'exact', head:true }).eq('mapping_entries.project_id', id)`.
- [ ] Riscrivere storage URL strategy: path canonicali + URL runtime.
- [ ] Gestire legacy signed URL `/object/sign/`.
- [ ] Implementare reverse-delta ordinato per `seq`.
- [ ] Mantenere Supabase write-freeze fino a reverse-delta completato.
- [ ] Congelare anche role `authenticated` e storage policies.
- [ ] Definire comportamento `cursor_expired` quando `sinceSeq < min(change_log.seq)`.
- [ ] Scrivere SQL completo per tutti i trigger, senza placeholder.
- [ ] Test delete project cascade e local prune.
- [ ] Chiarire endpoint upload per utenti esterni vs Tailscale.

---

## Fonti Esterne Verificate

- AWS S3 multipart upload limits: https://docs.aws.amazon.com/AmazonS3/latest/userguide/qfacts.html
- Cloudflare request body limits: https://developers.cloudflare.com/workers/platform/limits/
- Better Auth admin plugin endpoints: https://better-auth.com/docs/plugins/admin

