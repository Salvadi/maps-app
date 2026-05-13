# OPImaPPA Home Server Plan v3 - Adversarial Review

**Documento recensito:** `C:\Users\salva\Downloads\homeserver-opimappa-plan-v3.md`  
**Data review:** 2026-05-12  
**Verdetto sintetico:** il piano v3 corregge molti problemi del v2, ma non e ancora cutover-ready. I rischi principali sono incompatibilita con il repo reale, realtime non durabile, storage migration incompleta e rollback dati non realmente garantito.

---

## Executive Summary

Il piano e tecnicamente promettente e la scelta path-based `opimappa.com/api/*` e molto migliore del subdomain split. Pero il documento ragiona ancora su un modello parziale dell'applicazione.

Prima di implementare, vanno chiusi questi blocchi:

1. Aggiungere `structure_entries` a schema, API, migration, realtime, test e sync.
2. Decidere come gestire `profiles`: compat layer o refactor esplicito del frontend.
3. Sostituire lo scoping JSONB errato su `accessible_users`.
4. Rendere realtime recuperabile con una `change_log` durabile, non solo `LISTEN/NOTIFY`.
5. Completare lo shim Supabase con tutti i pattern realmente usati.
6. Riscrivere cutover e rollback con una procedura dati verificabile.

---

## Finding Critici

### C1 - `structure_entries` e fuori dal piano ma dentro il prodotto reale

**Severita:** Critica  
**Impatto:** perdita o rottura dell'intero flusso "strutture"; sync e realtime incompleti.

Il piano elenca le tabelle attive senza `structure_entries`, ma il repo la usa in modo load-bearing:

- Schema: `supabase/schema.sql:834`
- Sync queue type: `src/db/database.ts:149`
- Dexie table: `src/db/database.ts:568`
- Download: `src/sync/syncDownloadHandlers.ts:918`
- Upload: `src/sync/syncUploadHandlers.ts:916`
- App UI: `src/App.tsx:581`

**Perche e grave:** se l'API e lo schema self-hosted non includono `structure_entries`, i test base su progetti/mapping/foto possono passare, ma una parte reale dell'app non sincronizza o perde FK.

**Fix richiesto:**

- Aggiungere `structure_entries` alle 12 tabelle del piano, diventando almeno 13.
- Aggiungerla a CRUD, scoping tenant, query whitelist, realtime triggers, `/api/changes`, migration, backup verification e isolation tests.
- Aggiornare anche `photos.structure_entry_id` e `floor_plan_points.structure_entry_id`.

---

### C2 - Rimozione di `profiles` incompatibile con i call site attuali

**Severita:** Critica  
**Impatto:** login, session restore, ruoli/admin e sync si rompono.

Il piano dice che `profiles` viene rimossa e fusa in `user`, ma l'app oggi usa ancora `.from('profiles')` in molti punti:

- Login profile fetch: `src/db/auth.ts:43`
- Current user/session: `src/db/auth.ts:201`
- Auth state change: `src/db/auth.ts:391`
- Role fetch durante sync: `src/sync/syncEngine.ts:674`
- Admin/user management: `src/db/auth.ts:274`, `src/db/auth.ts:331`, `src/db/auth.ts:357`

**Fix richiesto:**

Scegliere una delle due strade:

1. **Compat layer consigliato:** esporre `/api/profiles` come vista/route compatibile verso `"user"` per tenere invariati i call site.
2. **Refactor esplicito:** modificare `auth.ts`, `syncEngine.ts`, admin UI e tipi TS per usare `"user"`/better-auth.

Il piano non puo promettere "94 call site invariati" se `profiles` sparisce senza compatibilita.

---

### C3 - Scoping tenant su `accessible_users` scritto con tipo SQL sbagliato

**Severita:** Critica  
**Impatto:** query rotte o isolamento tenant inefficace.

Nel piano:

```sql
${userId}::text = ANY(accessible_users::text[])
```

Ma nel DB reale `accessible_users` e `JSONB`, non `text[]`:

- `supabase/schema.sql:68`

Le policy Supabase attuali usano correttamente containment JSONB:

```sql
accessible_users @> jsonb_build_array(auth.uid()::text)
```

**Fix richiesto:**

Usare uno di questi pattern:

```sql
projects.owner_id = $userId::uuid
OR projects.accessible_users ? $userId
```

oppure:

```sql
projects.accessible_users @> jsonb_build_array($userId::text)
```

In Drizzle/Hono, centralizzare questa logica in un helper testato e usarla ovunque.

---

### C4 - `cleanup_accessible_users()` puo produrre `NULL`

**Severita:** Critica  
**Impatto:** violazione del `NOT NULL DEFAULT '[]'::jsonb` o stato dati incoerente.

Nel piano:

```sql
SELECT jsonb_agg(elem)
FROM jsonb_array_elements_text(accessible_users) elem
WHERE elem <> OLD.id
```

Se l'ultimo utente viene rimosso, `jsonb_agg` ritorna `NULL`.

**Fix richiesto:**

```sql
SET accessible_users = COALESCE((
  SELECT jsonb_agg(elem)
  FROM jsonb_array_elements_text(accessible_users) elem
  WHERE elem <> OLD.id
), '[]'::jsonb)
```

Aggiungere test su progetto con un solo utente in `accessible_users`.

---

### C5 - Realtime non calcola correttamente lo scope per tabelle figlie

**Severita:** Critica  
**Impatto:** eventi non consegnati o consegnati a utenti sbagliati.

Il trigger del piano prova a leggere `NEW.project_id` e `NEW.owner_id`. Ma nel DB reale:

- `photos` ha `mapping_entry_id` e opzionalmente `structure_entry_id`, non `project_id`.
- `floor_plan_points` ha `floor_plan_id` e parent mapping/structure, non `project_id`.
- `standalone_maps` usa `user_id`, non `owner_id`.

Riferimenti:

- `supabase/schema.sql:126`
- `supabase/schema.sql:173`
- `supabase/schema.sql:285`
- `supabase/schema.sql:909`
- `supabase/schema.sql:994`

**Fix richiesto:**

Creare trigger specifici per tabella, oppure arricchire gli eventi nell'API con join:

- `photos` -> join su `mapping_entries` o `structure_entries` -> `project_id`
- `floor_plan_points` -> join su `floor_plans.project_id`
- `standalone_maps` -> `user_id` come owner effettivo
- `structure_entries` -> `project_id`

Poi testare SSE isolation su ogni tabella, non solo `projects`.

---

### C6 - Gap recovery non e garantita senza change log durabile

**Severita:** Critica  
**Impatto:** client offline o SSE disconnesso perde DELETE/update ravvicinati.

`LISTEN/NOTIFY` non e durabile. Se il listener e giu, l'evento e perso. `/api/changes?since=:ts` puo recuperare solo righe ancora esistenti e con timestamp interrogabile. Non puo recuperare DELETE persi senza tombstone.

Inoltre molte tabelle sincronizzate non hanno `last_modified`; alcune hanno solo `updated_at`.

**Fix richiesto:**

Introdurre una tabella durabile:

```sql
CREATE TABLE change_log (
  seq BIGSERIAL PRIMARY KEY,
  table_name text NOT NULL,
  row_id text NOT NULL,
  op text NOT NULL CHECK (op IN ('INSERT', 'UPDATE', 'DELETE')),
  project_id uuid,
  user_id text,
  changed_at timestamptz NOT NULL DEFAULT now(),
  payload_meta jsonb NOT NULL DEFAULT '{}'::jsonb
);
```

Il client deve salvare `lastSeq`, non solo `lastEventTs`. SSE invia `seq`; `/api/changes?sinceSeq=` recupera da `change_log`.

---

### C7 - Storage migration non e ricorsiva e non normalizza gli URL

**Severita:** Critica  
**Impatto:** asset mancanti, URL vecchi Supabase persistenti, download planimetrie/foto rotto.

Il codice attuale salva path annidati:

- Foto: `${mappingEntryId}/${photoId}.jpg` in `src/sync/syncUploadHandlers.ts:283`
- Thumbnail foto: `src/sync/syncUploadHandlers.ts:301`
- Planimetrie/standalone: URL in `image_url`, `thumbnail_url`, `pdf_url`

Il piano parla di storage migration, ma non esplicita:

- traversal ricorsivo dei bucket Supabase;
- rewrite di URL Supabase verso path/proxy MinIO;
- popolamento o mantenimento di `storage_path`;
- compatibilita con `createSignedUrl` e `getPublicUrl`.

**Fix richiesto:**

- Migrare ricorsivamente ogni bucket.
- Dopo upload MinIO, verificare count totale e hash per campione stratificato per bucket/prefix.
- Normalizzare DB salvando path canonicali, non URL pubblici Supabase.
- Aggiornare `image_url`, `thumbnail_url`, `pdf_url`, `url`, `thumbnail_url` o introdurre colonne path analoghe anche per planimetrie.

---

### C8 - Shim Supabase incompleto rispetto ai pattern reali

**Severita:** Critica  
**Impatto:** promesse "call site invariati" non mantenute.

Il piano non include tutti i pattern usati:

- `.select('id', { count: 'exact', head: true })`
- `.select('id, mapping_entries!inner(id)', { count: 'exact', head: true })`
- `.createSignedUrl(path, ttl)` singolare
- select join PostgREST `mapping_entries!inner`

Riferimenti:

- `src/db/mappings.ts:729`
- `src/db/floorPlans.ts:872`
- `src/utils/floorPlanUtils.ts:482`

**Fix richiesto:**

Lo shim deve supportare almeno:

- `select(columns, options?)`
- `{ count: 'exact', head: true }`
- join select usato da `getPhotoCountForProject`
- `storage.from(bucket).createSignedUrl(path, ttl)`
- `createSignedUrls(paths, ttl)`
- `getPublicUrl(path)` con URL compatibile o path proxy.

---

### C9 - `clearAndSync()` automatico post-cutover puo cancellare modifiche offline

**Severita:** Critica  
**Impatto:** perdita dati client-side.

Il piano propone forced SW update + `clearAndSync()` automatico. Ma oggi `clearAndSync()` cancella anche `syncQueue`:

- `src/sync/syncEngine.ts:774`
- `src/sync/syncEngine.ts:787`

Se un utente ha modifiche offline non ancora flushate durante il cutover, la procedura puo eliminarle.

**Fix richiesto:**

Prima del reset:

- bloccare se `syncQueue.where('synced').equals(0).count() > 0`;
- tentare upload preventivo;
- esportare un backup JSON locale;
- chiedere conferma esplicita solo se l'utente accetta perdita/ripristino manuale.

---

## Finding Alti

### H1 - `X-Session-Id` non deve essere fidato dal client

**Impatto:** un client malevolo puo forzare originator arbitrario e sopprimere self-echo altrui.

Il piano dice che il frontend aggiunge `X-Session-Id` e l'API lo usa per `SET LOCAL`. Meglio derivare `sessionId` dalla sessione cookie lato server, oppure usare un `clientMutationId` opaco validato.

---

### H2 - Direct-to-MinIO via secondo tunnel non aggira il limite Cloudflare

**Impatto:** upload >100 MB falliscono comunque su Free/Pro.

Cloudflare documenta limite request body per piano: Free/Pro 100 MB, Business 200 MB, Enterprise 500 MB default. Un secondo tunnel e ancora traffico proxied da Cloudflare.

**Fix richiesto:**

- Multipart/chunk upload con chunk < limite Cloudflare.
- Oppure Tailscale/local-only per upload molto grandi.
- Oppure piano Cloudflare adeguato.

Fonte: https://developers.cloudflare.com/workers/platform/limits/

---

### H3 - Cookie-only auth indebolisce l'offline login attuale

**Impatto:** l'app potrebbe non riaprire in cantiere senza rete se la sessione deve essere verificata via cookie/server.

Oggi `loginOffline()` controlla una sessione Supabase persistita e poi usa cache IndexedDB:

- `src/db/auth.ts:116`

Con cookie httpOnly, il frontend non puo leggere il token. Serve una decisione UX/security esplicita:

- offline session locale con scadenza;
- PIN locale o WebAuthn;
- oppure nessun login offline dopo logout/browser reset.

---

### H4 - Rollback non e realmente lossless

**Impatto:** tornare a Supabase dopo scritture sul nuovo backend richiede migrare indietro delta dati e storage.

Il piano dice RTO < 10 minuti e data loss max 1 giorno, con recupero da PWA cache. Questo non e operativo. Serve uno dei seguenti:

- freeze write window durante cutover;
- dual-write temporaneo;
- reverse-delta script home server -> Supabase;
- procedura manuale con export locale per ogni device coinvolto.

---

### H5 - Better-auth admin endpoints non coincidono esattamente con nomi piano

**Impatto:** rischio integrazione/route drift.

Better Auth admin plugin espone endpoint e API come `admin/create-user`, `admin/set-user-password`, `admin/remove-user`, `admin/ban-user`, ecc. Il piano usa `/api/auth/admin/set-password`, che puo essere wrapper custom ma va esplicitato.

Fonte: https://better-auth.com/docs/plugins/admin

---

### H6 - Test restore basato su `pg_stat_user_tables.n_live_tup` e poco affidabile

**Impatto:** falsi positivi/negativi nei restore test.

`n_live_tup` e statistico, non conteggio esatto. Usare `SELECT count(*)` per tabella, generato dinamicamente, e confrontare schema normalizzato ignorando owner/ACL/volatile metadata.

---

### H7 - CSP e Permissions Policy del piano rischiano regressioni

**Impatto:** asset/API/storage bloccati o feature browser disabilitate.

Il `vercel.json` attuale consente Supabase in `connect-src` e `img-src`. Il piano path-based semplifica, ma se resta `storage.opimappa.com` va aggiunto a `connect-src`/`img-src`. Inoltre il piano mette:

```http
Permissions-Policy: camera=(), microphone=(), geolocation=(self)
```

Se in futuro si usa camera capture o geolocation per foto, questa policy blocca. Oggi non ho trovato uso diretto di `getUserMedia`, ma va deciso consapevolmente.

---

## Finding Medi

### M1 - `minio/minio:latest` e `cloudflare/cloudflared:latest` sono poco riproducibili

Pin a versioni/digest almeno per produzione. Aggiornamenti manuali, changelog e rollback immagine.

### M2 - `cap_drop: [ALL]` e `read_only: true` non sono applicabili ovunque senza eccezioni

Postgres, MinIO, Caddy e cloudflared richiedono write path specifici. Il piano deve elencare mount `tmpfs`, writable dirs e user id per servizio.

### M3 - SSE max 2 connessioni per utente puo rompere mobile/browser reali

Tra PWA, tab desktop, background refresh e reconnect race, 2 e stretto. Meglio limitare per device/sessione e misurare.

### M4 - Account lockout permanente dopo 10 failed/email puo essere DoS

Un attaccante puo bloccare utenti conoscendo email. Preferire backoff progressivo, captcha/turnstile opzionale, alert admin, ma non disattivazione permanente automatica.

### M5 - `last_modified` millisecondi puo collidere

Per ordinamento eventi e conflict resolution, usare `updated_at` server-side + `change_log.seq` monotono. Il timestamp resta metadata, non cursor.

### M6 - `profiles_supabase_dump` nello script seed non esiste nel piano

Lo script confronta con `profiles_supabase_dump`, ma la pipeline dice di skippare `profiles`. O si crea tabella temporanea, o si confronta con `profiles` letto da Supabase API.

---

## Checklist Di Correzione Prima Di Implementare

- [ ] Aggiornare elenco tabelle: includere `structure_entries`.
- [ ] Disegnare matrice scoping per ogni tabella: read, insert, update, delete.
- [ ] Sostituire ogni `ANY(accessible_users::text[])` con operatori JSONB corretti.
- [ ] Decidere compat layer `profiles` o refactor frontend.
- [ ] Aggiungere `change_log` durabile e cursor `seq`.
- [ ] Fare trigger realtime specifici per `photos`, `floor_plan_points`, `standalone_maps`, `structure_entries`.
- [ ] Completare shim: count/head, join select, `createSignedUrl`.
- [ ] Rendere storage migration ricorsiva e normalizzare URL/path.
- [ ] Bloccare `clearAndSync()` automatico se esistono pending writes.
- [ ] Riscrivere rollback con reverse-delta o write freeze.
- [ ] Aggiungere tests isolation per tutte le tabelle tenant-scoped.
- [ ] Aggiungere test storage per path annidati e URL legacy.
- [ ] Verificare upload >100 MB con chunking o via canale non Cloudflare.

---

## Fonti Esterne Verificate

- Cloudflare request body limits: https://developers.cloudflare.com/workers/platform/limits/
- Cloudflare Tunnel streaming/SSE buffering: https://developers.cloudflare.com/tunnel/troubleshooting/
- Better Auth admin plugin: https://better-auth.com/docs/plugins/admin
- Better Auth database/schema generation: https://better-auth.com/docs/concepts/database

