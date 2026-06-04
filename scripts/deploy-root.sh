#!/usr/bin/env bash
# deploy-root.sh — setup ROOT one-time dell'ambiente staging sul homeserver.
# Eseguire con sudo:  sudo bash deploy-root.sh
# I file sorgente sono staged in /home/levi/opimappa-staging-files/ (scp da Claude).
#
# Idempotente. Il docker-compose.yml di PRODUZIONE NON viene sovrascritto automaticamente:
# viene mostrato il diff; per applicarlo ri-eseguire con  APPLY_COMPOSE=1 sudo bash deploy-root.sh
set -euo pipefail

SRC=/home/levi/opimappa-staging-files
DEST=/opt/opimappa
RUNNER_USER="${RUNNER_USER:-levi}"   # utente che possiede web-staging (cambiare se il runner gira con altro utente)

echo "==> 1/6 .env.staging (chmod 600)"
install -m600 "$SRC/.env.staging" "$DEST/.env.staging"

echo "==> 2/6 docker-compose.staging.yml"
cp "$SRC/docker-compose.staging.yml" "$DEST/docker-compose.staging.yml"

echo "==> 3/6 directory web-staging (owner: $RUNNER_USER)"
mkdir -p "$DEST/web-staging"
chown "$RUNNER_USER":"$RUNNER_USER" "$DEST/web-staging"

echo "==> 4/6 Caddyfile (backup + nuovo)"
cp "$DEST/caddy/Caddyfile" "$DEST/caddy/Caddyfile.bak.$(date +%s)"
cp "$SRC/caddy/Caddyfile" "$DEST/caddy/Caddyfile"

echo "==> 5/6 docker-compose.yml di produzione"
if diff -u "$DEST/docker-compose.yml" "$SRC/docker-compose.yml.new"; then
  echo "    (nessuna differenza: compose prod già aggiornato)"
else
  if [ "${APPLY_COMPOSE:-0}" = "1" ]; then
    cp "$DEST/docker-compose.yml" "$DEST/docker-compose.yml.bak.$(date +%s)"
    cp "$SRC/docker-compose.yml.new" "$DEST/docker-compose.yml"
    echo "    ✅ compose prod aggiornato (mount web-staging + fix healthcheck/porta :80)"
  else
    echo "    ⚠️  diff mostrato sopra. Verifica che siano SOLO: +volume web-staging, healthcheck/porta :80."
    echo "    Per applicare:  APPLY_COMPOSE=1 sudo bash deploy-root.sh"
    echo "    (proseguo SENZA toccare il compose prod)"
  fi
fi

echo "==> 6/6 avvio servizi staging + bucket + caddy"
cd "$DEST"
docker compose -f docker-compose.yml -f docker-compose.staging.yml up -d minio-staging
# attende che minio-staging sia healthy prima di creare i bucket
echo "    attendo minio-staging healthy..."
for i in $(seq 1 30); do
  st=$(docker inspect -f '{{.State.Health.Status}}' opimappa-minio-staging 2>/dev/null || echo starting)
  [ "$st" = "healthy" ] && break
  sleep 2
done
# bucket hardcoded nell'API (photos, planimetrie) sul MinIO staging
# shellcheck disable=SC1091
set -a; . "$DEST/.env.staging"; set +a
docker run --rm --network opimappa_opimappa_net minio/mc sh -c \
  "mc alias set s http://minio-staging:9000 $MINIO_ROOT_USER $MINIO_ROOT_PASSWORD && mc mb -p s/photos s/planimetrie || true"

docker compose -f docker-compose.yml -f docker-compose.staging.yml up -d api-staging
# ricrea caddy SOLO se il compose prod è stato aggiornato (altrimenti il mount web-staging non esiste)
if [ "${APPLY_COMPOSE:-0}" = "1" ]; then
  docker compose up -d caddy
fi

echo
echo "==> Stato finale:"
docker ps --format '{{.Names}}\t{{.Status}}' | grep -E 'staging|caddy' || true
echo
echo "Log api-staging:"; docker logs --tail 15 opimappa-api-staging 2>&1 || true
echo
echo "Prossimi passi: Cloudflare hostname staging.opimappa.com -> caddy:80, poi runner GitHub."
