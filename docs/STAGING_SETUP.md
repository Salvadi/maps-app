# Staging environment (homeserver) — sostituto delle preview Vercel

Flusso: branch → push → GitHub Actions (self-hosted runner sul homeserver) → build + deploy
su `https://staging.opimappa.com`. Test da qualsiasi dispositivo (anche smartphone). Poi merge su master → deploy prod.

Architettura: stesso modello **same-origin** della prod (Caddy serve la PWA e proxy `/api/*`),
ma host `staging.opimappa.com`, container `api-staging`, `minio-staging` e database `opimappa_staging` dedicati.
Dati prod **intoccati**.

```
push branch ──▶ Actions (runner sul homeserver)
                   │ npm run build (log visibili in tab Actions, anche da telefono)
                   │ docker build api-staging
                   ▼
   Caddy ──host opimappa.com──────▶ api:3000          + /srv/web
         └─host staging.opimappa.com▶ api-staging:3000 + /srv/web-staging
                                          │
                          postgres(opimappa_staging) · minio-staging
```

## File aggiunti/modificati nel repo

| File | Ruolo |
|------|-------|
| `opimappa-server/docker-compose.staging.yml` | override: `api-staging` (image `opimappa-api:latest`) + `minio-staging`; estende `caddy` col mount `/srv/web-staging`. Da usare SEMPRE con `-f docker-compose.yml -f docker-compose.staging.yml` |
| `opimappa-server/caddy/Caddyfile` | riscritto host-based: prod + staging via snippet, fallback `:80`, log su stdout |
| `opimappa-server/.env.staging.example` | template env staging (secret separati) |
| `scripts/deploy-root.sh` | setup ROOT one-time (env, Caddyfile, bucket, su servizi staging, ricrea caddy) |
| `scripts/deploy-staging.sh` | (runner) build web + redeploy api-staging |
| `.github/workflows/staging.yml` | trigger push `feature/**` + `workflow_dispatch` |

> ⚠️ **Porta Caddy = :80** (verificato: container risponde su :80, non :8080). Il compose base
> aveva healthcheck/mapping su 8080 → caddy "unhealthy"; l'override corregge l'healthcheck a :80.
> Il compose di **produzione NON viene modificato**: lo staging è un override che si fonde col base.

---

## Setup manuale (una volta sola, sul homeserver `levi@100.111.232.12`)

### 1. Cloudflare — hostname pubblico staging
Dashboard Cloudflare → Zero Trust → Networks → Tunnels → tunnel OPImaPPA → **Public Hostname** → Add:
- Subdomain: `staging`, Domain: `opimappa.com`
- Service: `HTTP` → `caddy:80`

Crea anche il record DNS (Cloudflare lo fa in automatico col tunnel).

### 2,4,5. Setup server ✅ FATTO (via `deploy-root.sh`, 2026-06-04)
`scripts/deploy-root.sh` (staged in `/home/levi/opimappa-staging-files/`) esegue in un colpo:
env staging in `/opt/opimappa/.env.staging`, copia override compose + Caddyfile, crea
`web-staging` (owner runner), avvia `minio-staging` + crea bucket `photos`/`planimetrie`,
avvia `api-staging`, ricrea `caddy`. Idempotente. Eseguito con:
```bash
sudo bash /home/levi/opimappa-staging-files/deploy-root.sh
```
Esito verificato: prod `opimappa.com`→200, `staging.opimappa.com`→routing ok (404 finché
`web-staging` è vuoto), caddy+api-staging **healthy**.

### 3. Database staging ✅ FATTO (via SSH 2026-06-04)
> ⚠️ Drizzle (`schema.ts`) gestisce SOLO le 4 tabelle auth BetterAuth. Le 18 tabelle reali
> (projects, mappings, floor_plans, ...) NON sono in drizzle → `drizzle-kit push` da solo è
> insufficiente. Metodo corretto: **clonare lo schema prod** (struttura, no dati).
```bash
docker exec opimappa-postgres psql -U opimappa -d opimappa -c "CREATE DATABASE opimappa_staging;"
# clona struttura completa prod → staging (18 tabelle + extension + indici + RLS)
docker exec opimappa-postgres sh -c \
  "pg_dump -U opimappa --schema-only --no-owner opimappa | psql -U opimappa -d opimappa_staging"
```
Utente di login (signup disabilitato in `auth/config.ts`): clona la tua riga utente da prod,
così accedi a staging con le stesse credenziali:
```bash
docker exec opimappa-postgres sh -c \
  "pg_dump -U opimappa --data-only -t '\"user\"' -t account opimappa | psql -U opimappa -d opimappa_staging"
```

### 4. Primo deploy della build web (staging vuoto finché non c'è)
`web-staging` è owned dall'utente runner → si scrive senza sudo. Manuale:
```bash
npm run build                                  # in locale (repo root)
scp -r build/* levi@100.111.232.12:/opt/opimappa/web-staging/
```
Oppure automatico al primo push su `feature/**` (vedi runner sotto).

### 6. Self-hosted runner GitHub
Repo GitHub → Settings → Actions → Runners → New self-hosted runner (Linux x64).
Esegui i comandi mostrati sul homeserver, poi installalo come servizio:
```bash
./config.sh --url https://github.com/<owner>/<repo> --token <TOKEN> --labels self-hosted,linux
sudo ./svc.sh install <runner-user>
sudo ./svc.sh start
```
Requisiti runner:
- accesso a `docker` (utente nel gruppo `docker`)
- `sudo` per i passi che scrivono in `/opt` (o ownership della dir come al punto 2)
- `node`/`npm` disponibili (oppure lascia fare a `actions/setup-node` nel workflow)

---

## Uso quotidiano

```
git checkout -b feature/x        # lavora
git push origin feature/x        # → Actions builda e deploya staging
```
- Build log + errori: tab **Actions** del repo (anche da smartphone).
- Errori runtime API: `docker logs -f opimappa-api-staging`.
- Deploy manuale on-demand: tab Actions → workflow "Deploy Staging" → **Run workflow**.
- Test: apri `https://staging.opimappa.com`.
- OK? → merge su `master` → deploy prod (flusso esistente).

## Dati realistici (opzionale)
Per testare su una copia dei dati prod senza rischio:
```bash
docker exec opimappa-postgres pg_dump -U opimappa opimappa \
  | docker exec -i opimappa-postgres psql -U opimappa -d opimappa_staging
```

## Sicurezza
- `BETTER_AUTH_SECRET` staging **diverso** da prod (sessioni non interscambiabili).
- Cookie `__Host-opimappa` è host-only → `staging.` e prod non condividono sessione.
- MinIO/DB staging isolati: nessuna scrittura su dati prod.
- CSP invariata (`connect-src 'self'`): staging resta same-origin, nessuna origin esterna aggiunta.
