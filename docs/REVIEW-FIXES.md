# OPImaPPA — Review Fixes Tracker

Tracker fix da Codex adversarial review v3 + v4. Da consultare prima di ogni PR sprint.

**Base:** `homeserver-opimappa-plan-v4.md`
**Patch:** `homeserver-opimappa-plan-v4.1-surgical.md`
**Reviews:** `docs/homeserver-opimappa-plan-v3-adversarial-review.md`, `docs/homeserver-opimappa-plan-v4-critical-review.md`

---

## Sprint 1 — Infrastruttura (schema + Docker)

- [ ] **C5 (v4 review):** schema better-auth con `CHECK (id ~ uuid_regex)` su `"user"`
- [ ] **C5 (v4 review):** vista `profiles` con INSTEAD OF UPDATE/INSERT/DELETE (tutti e 3)
- [ ] **H3 (v4 review):** SQL completo per ogni trigger `log_change_*` — niente placeholder (`floor_plans`, `sals`, `typology_prices`, `dropdown_options`, `products`)
- [ ] **C4 (v3 review):** `cleanup_accessible_users` con `COALESCE(..., '[]'::jsonb)` per evitare NULL
- [ ] **C3 (v3 review):** scoping JSONB con operatori `?` e `@>`, mai cast `::text[]`
- [ ] **C9 (v4 review):** preparare `scripts/supabase-freeze.sql` con revoca su `anon` + `authenticated` + RESTRICTIVE policies + storage policies — per Sprint 7
- [ ] **M1 (v4 review):** image pin SHA256 digest in produzione, version manuale documentato

## Sprint 2 — API core (Hono + Drizzle + better-auth)

- [ ] **C6 (v4 review):** parser PostgREST `parseSelect` con `part.trim()` obbligatorio
- [ ] **C6 (v4 review):** parser supporta filtri dotted `mapping_entries.project_id=eq.X`
- [ ] **C6 (v4 review):** HEAD count exact + join produce `Content-Range` header
- [ ] **C5 (v4 review):** force `generateId: () => randomUUID()` in config better-auth
- [ ] **H1 (v4 review):** rate limit middleware clona `c.req.raw.clone()` prima di leggere body
- [ ] **H1 (v3 review):** `sessionId` derivato dalla session cookie server-side, **MAI** da header client
- [ ] **H5 (v3 review):** endpoint admin allineati a nomi better-auth esatti: `admin/create-user`, `admin/set-user-password`, `admin/list-users`, `admin/ban-user`, `admin/remove-user`
- [ ] **M1+M2 (v4 review):** schema TS: `profiles.id` TEXT (not uuid), `projects.owner_id` TEXT (FK a `"user"`), `projects.id` UUID
- [ ] **M4 (v3 review):** lockout progressivo, no permanent disable. Captcha Cloudflare Turnstile dopo 10 fail
- [ ] Test SQL injection fuzz con `fast-check`
- [ ] Test isolation tenant per ogni tabella (13 tabelle)

## Sprint 3 — Storage + Realtime

- [ ] **C1 (v4 review):** `drainUntil(targetSeq)` con `lastDrainedSeq` cursor — **MAI** ridrenare primi 1000 storici
- [ ] **C2 (v4 review):** init `lastNotifiedSeq = lastDrainedSeq = SELECT max(seq)` all'avvio listener
- [ ] **C3 (v4 review):** header `X-Server-Seen-Seq` (info-only), client salva `appliedSeq` separato e persisted
- [ ] **C4 (v4 review):** unified `applyEvent()` path per SSE live + catch-up + polling fallback. `appliedSeq` aggiornato SOLO dopo listener completati
- [ ] **H2 (v4 review):** endpoint `/api/changes` ritorna 410 `cursor_expired` + `fullResyncRequired: true` se `sinceSeq < min(change_log.seq)`
- [ ] **H4 (v4 review):** test cascade delete project + client-side `handleProjectDeleteLocal(projectId)` pruna sottostante in Dexie
- [ ] **M3 (v4 review):** monitoring `change_log` size + retention margin
- [ ] **M5 (v4 review):** SSE limit `MAX_SSE_PER_SESSION = 5` (5 tab/device), tab id da `sessionStorage`
- [ ] **H6 (v3 review):** test restore `count(*)` per ogni tabella, no `n_live_tup`
- [ ] **C6 (v3 review):** SSE `connection_lost` event + fallback polling client-side
- [ ] **H2 (v3 review):** session ctx cache eager con invalidation su mutation `accessible_users`/`role`
- [ ] **H6 (v3 review):** filter self-echo via `originator session_id` da `SET LOCAL`
- [ ] Heartbeat SSE 15s (sotto soglia CF Tunnel)

## Sprint 4 — Migrazione dati

- [ ] **C7 (v4 review):** path canonicali in DB (`*_storage_path`), URL signed runtime via API
- [ ] **C7 (v4 review):** rewrite robusto: pubblico `/storage/v1/object/public/` + signed `/storage/v1/object/sign/` + legacy path-only + bare filename
- [ ] **C7 (v3 review):** storage migration ricorsiva traverse + verify hash sample stratificato per bucket
- [ ] **C3 (v3 review):** seed `user` da Supabase admin API (`auth.admin.listUsers`) preservando UUID
- [ ] **H7 (v3 review):** MIME fallback con `file-type` se metadata Supabase mancante
- [ ] **M6 (v3 review):** profiles letta da Supabase via REST API, no dump tabella temporanea
- [ ] **M3 (v4 review):** schema diff `test-restore.sh` deterministico (sort + grep -v normalizzato)

## Sprint 5 — Frontend shim

- [ ] **C8 (v3 review):** shim espone `select(cols, { count, head })`, join `mapping_entries!inner(id)`, `createSignedUrl` singolare
- [ ] **C9 (v3 review):** pre-`clearAndSync()` safeguard: check `syncQueue.where('synced').equals(0).count()`, tenta flush, esporta backup JSON, conferma esplicita
- [ ] **H3 (v4 review):** offline login con PBKDF2 600k iter SHA-256, salt 16 bytes random, IV 12 bytes, AES-GCM-256
- [ ] **H3 (v4 review):** TTL offline token 7gg (non 30gg)
- [ ] **H3 (v4 review):** rate limit locale tentativi offline (5 fail → backoff progressivo)
- [ ] **H5 (v4 review):** commento codice multipart S3 corretto: "5 MiB min part (eccetto ultima), 5 GiB max, 10000 parts max"
- [ ] **H6 (v4 review):** routing presigned URL: Tailscale users → direct MinIO `http://100.111.232.12:9000`, esterni → API proxy chunked
- [ ] **M5 (v4 review):** SSE client passa `tabId` da `sessionStorage` univoco per tab
- [ ] **M8 (v3 review):** `onAuthStateChange` shim mapping eventi: `SIGNED_IN`, `SIGNED_OUT`, `TOKEN_REFRESHED`, `USER_UPDATED`
- [ ] **M4 (v3 review):** SW bump version + `skipWaiting()` + safeguard flow
- [ ] Aggiungere helper `fetchRemoteFirst<T>()` in `src/db/onlineFirst.ts` per refactor read path
- [ ] Feature flag `REACT_APP_BACKEND=hono|supabase` per rollback rapido

## Sprint 6 — Beta staging

- [ ] **M3 (v3 review):** stack staging `docker-compose.staging.yml` con DB/MinIO isolati, sub-domain `staging.opimappa.com`
- [ ] Load test 50 client SSE × 100 mutation/min × 30min
- [ ] Test cross-tenant manuale con 2 utenti reali

## Sprint 7 — Cutover (write-freeze)

- [ ] **C8 (v4 review):** `reverse-delta-supabase.ts` ordina per `ORDER BY seq ASC`, **MAI** `DISTINCT row_id, op`
- [ ] **C8 (v4 review):** compattazione per `(table, row_id)` mantenendo ordine relativo + sort per `TABLE_ORDER` (parent prima)
- [ ] **C8 (v4 review):** storage reverse sync implementato esplicitamente (foto, planimetrie)
- [ ] **C8 (v4 review):** Supabase RESTA in write-freeze fino a reverse-delta completato. Re-enable write SOLO dopo verifica
- [ ] **C9 (v4 review):** freeze SQL revoca su `anon` + `authenticated` + RESTRICTIVE policy WITH CHECK false su tutte 12 tabelle public + storage.objects policies
- [ ] **C9 (v4 review):** test freeze pre-cutover su Supabase staging (login utente + INSERT/UPDATE/DELETE/upload deve fallire, SELECT deve passare)
- [ ] **H4 (v3 review):** dual-write opzionale durante Sprint 6 staging
- [ ] DNS TTL ridotto a 60s 24h prima cutover
- [ ] Annuncio utenti T-30min write-freeze

## Sprint 8 — Post-cutover

- [ ] **M6 (v3 review):** `apcupsd` event hook → email/Pushover su `onbatt`, `commfailure`
- [ ] **L4 (v3 review):** considera WAL archiving + PITR post-stabilità
- [ ] Restic R2 EU + cron + alert email su failure
- [ ] Test restore mensile automatico `count(*)` per tabella + schema diff deterministico
- [ ] Refactor incrementale read path → `fetchRemoteFirst<T>()`
- [ ] T+14gg stabili → cancella progetto Supabase

---

## Note operative

- Ogni PR sprint deve dichiarare quali fix tracker chiude (link `REVIEW-FIXES.md#FIX-ID`)
- Codex critic review per ogni PR obbligatorio (CLAUDE.md/AGENTS.md workflow)
- Test isolation tenant baseline in CI bloccante merge

---

**Ultimo aggiornamento:** 2026-05-12
