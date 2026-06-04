#!/usr/bin/env bash
# deploy-root.sh — setup ROOT one-time dell'ambiente staging sul homeserver.
# Eseguire con sudo:  sudo bash deploy-root.sh
# Sorgenti staged in /home/levi/opimappa-staging-files/ (scp da Claude).
#
# NON tocca il docker-compose.yml di PRODUZIONE: lo staging è un override
# (docker-compose.staging.yml) che si fonde col compose base esistente.
# Idempotente.
set -euo pipefail

SRC=/home/levi/opimappa-staging-files
DEST=/opt/opimappa
RUNNER_USER="${RUNNER_USER:-levi}"   # owner di web-staging (cambiare se il runner gira con altro utente)

echo "==> 1/6 .env.staging (chmod 600)"
install -m600 "$SRC/.env.staging" "$DEST/.env.staging"

echo "==> 2/6 docker-compose.staging.yml (override)"
cp "$SRC/docker-compose.staging.yml" "$DEST/docker-compose.staging.yml"

echo "==> 3/6 directory web-staging (owner: $RUNNER_USER)"
mkdir -p "$DEST/web-staging"
chown "$RUNNER_USER":"$RUNNER_USER" "$DEST/web-staging"

echo "==> 4/6 Caddyfile (backup + nuovo; logging su stdout, compatibile read_only)"
cp "$DEST/caddy/Caddyfile" "$DEST/caddy/Caddyfile.bak.$(date +%s)"
cp "$SRC/caddy/Caddyfile" "$DEST/caddy/Caddyfile"

cd "$DEST"
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.staging.yml)

echo "==> 5/6 avvio minio-staging + bucket + api-staging"
"${COMPOSE[@]}" up -d minio-staging
echo "    attendo minio-staging healthy..."
for _ in $(seq 1 30); do
  st=$(docker inspect -f '{{.State.Health.Status}}' opimappa-minio-staging 2>/dev/null || echo starting)
  [ "$st" = "healthy" ] && break
  sleep 2
done
# bucket hardcoded nell'API (photos, planimetrie). NB: l'entrypoint di minio/mc è già 'mc',
# quindi serve --entrypoint sh per eseguire più comandi mc in sequenza.
set -a; . "$DEST/.env.staging"; set +a
docker run --rm --entrypoint sh --network opimappa_opimappa_net minio/mc -c \
  "mc alias set s http://minio-staging:9000 $MINIO_ROOT_USER $MINIO_ROOT_PASSWORD && mc mb -p s/photos s/planimetrie || true"

"${COMPOSE[@]}" up -d api-staging

echo "==> 6/6 ricreo caddy (mount web-staging + nuovo Caddyfile + healthcheck :80)"
echo "    NB: breve restart di caddy → ~1-2s di downtime su prod."
"${COMPOSE[@]}" up -d caddy

echo
echo "==> Stato finale:"
docker ps --format '{{.Names}}\t{{.Status}}' | grep -E 'staging|caddy' || true
echo
echo "Log api-staging:"; docker logs --tail 15 opimappa-api-staging 2>&1 || true
echo
echo "Verifica caddy parta col nuovo Caddyfile:"; docker logs --tail 10 opimappa-caddy 2>&1 || true
echo
echo "Prossimi passi: Cloudflare hostname staging.opimappa.com -> caddy:80."
