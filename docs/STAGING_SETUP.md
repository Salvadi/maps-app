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
| `opimappa-server/docker-compose.staging.yml` | servizi `api-staging` + `minio-staging` (rete esterna condivisa) |
| `opimappa-server/caddy/Caddyfile` | riscritto host-based: prod + staging via snippet, fallback `:80` |
| `opimappa-server/docker-compose.yml` | aggiunto mount `/srv/web-staging` al container caddy |
| `opimappa-server/.env.staging.example` | template env staging (secret separati) |
| `scripts/deploy-staging.sh` | build web + rebuild api-staging + restart caddy |
| `.github/workflows/staging.yml` | trigger push (≠ master) + `workflow_dispatch` |

> ⚠️ **Porta Caddy = :80** (verificato sul server: container risponde su :80, non :8080).
> Il compose aveva healthcheck/mapping su 8080 → caddy "unhealthy"; corretto a :80 in questo commit.
> Ricreare caddy applica sia il fix healthcheck sia il mount `/srv/web-staging`.

---

## Setup manuale (una volta sola, sul homeserver `levi@100.111.232.12`)

### 1. Cloudflare — hostname pubblico staging
Dashboard Cloudflare → Zero Trust → Networks → Tunnels → tunnel OPImaPPA → **Public Hostname** → Add:
- Subdomain: `staging`, Domain: `opimappa.com`
- Service: `HTTP` → `caddy:80`

Crea anche il record DNS (Cloudflare lo fa in automatico col tunnel).

### 2. Directory + env sul server
```bash
sudo mkdir -p /opt/opimappa/web-staging /opt/opimappa/data/minio-staging
# permetti al runner di scrivere la build senza sudo (sostituisci <runner-user>)
sudo chown -R <runner-user> /opt/opimappa/web-staging

# crea l'env staging dal template del repo e compila i CAMBIA_*
sudo cp opimappa-server/.env.staging.example /opt/opimappa/.env.staging
sudo nano /opt/opimappa/.env.staging
#  - DATABASE_URL → .../opimappa_staging
#  - BETTER_AUTH_SECRET → openssl rand -base64 48  (DIVERSO da prod)
#  - MINIO_ROOT_USER/PASSWORD → nuove credenziali
```

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

### 4. Prima accensione MinIO staging + bucket
```bash
cd opimappa-server
docker compose -f docker-compose.yml -f docker-compose.staging.yml up -d minio-staging
# crea i due bucket hardcoded nell'API (photos, planimetrie) sul MinIO staging
docker run --rm --network opimappa_opimappa_net minio/mc sh -c "\
  mc alias set s http://minio-staging:9000 <MINIO_ROOT_USER> <MINIO_ROOT_PASSWORD> && \
  mc mb -p s/photos s/planimetrie"
```

### 5. Applica Caddyfile + mount aggiornati (tocca la prod: breve restart)
```bash
# copia il Caddyfile aggiornato dove Caddy lo monta
sudo cp opimappa-server/caddy/Caddyfile /opt/opimappa/caddy/Caddyfile
cd opimappa-server
# ricrea caddy per montare /srv/web-staging e ricaricare la config
docker compose up -d caddy
docker logs --tail 30 opimappa-caddy   # verifica nessun errore di parse
```

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
