#!/usr/bin/env bash
# deploy-staging-api.sh — eseguito dal self-hosted GitHub runner SUL homeserver.
# Builda l'immagine opimappa-api:staging e ricrea il container api-staging.
#
# NB: gira come utente runner (gruppo docker).
#  - build immagine: NON richiede sudo (gruppo docker).
#  - ricreazione container: SÌ, perché legge /opt/opimappa/.env.staging (root-only)
#    e i compose in /opt. Per questo serve una entry sudoers NOPASSWD limitata
#    all'ESATTO comando compose (vedi docs/STAGING_SETUP.md):
#
#    levi ALL=(root) NOPASSWD: /usr/bin/docker compose -f /opt/opimappa/docker-compose.yml -f /opt/opimappa/docker-compose.staging.yml up -d --force-recreate api-staging
#
# Trigger: workflow .github/workflows/staging-api.yml (solo se cambia opimappa-server/api/**).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_DIR="$REPO_ROOT/opimappa-server/api"
COMPOSE_BASE=/opt/opimappa/docker-compose.yml
COMPOSE_STAGING=/opt/opimappa/docker-compose.staging.yml

echo "========================================"
echo "Deploy Staging API"
echo "Commit: $(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo '?')"
echo "========================================"

echo "[*] Test + build API (tsc + vitest)..."
cd "$API_DIR"
npm ci
npm run build
npm test

echo "[*] Build immagine opimappa-api:staging..."
docker build -t opimappa-api:staging "$API_DIR"

echo "[*] Ricreo api-staging (sudo NOPASSWD limitato all'esatto comando)..."
sudo docker compose -f "$COMPOSE_BASE" -f "$COMPOSE_STAGING" up -d --force-recreate api-staging

echo "[*] Attendo health..."
status=starting
for _ in $(seq 1 20); do
  status=$(docker inspect -f '{{.State.Health.Status}}' opimappa-api-staging 2>/dev/null || echo starting)
  [ "$status" = "healthy" ] && break
  sleep 3
done
docker inspect -f 'api-staging: {{.State.Health.Status}} ({{.Config.Image}})' opimappa-api-staging
[ "$status" = "healthy" ] || { echo "ERRORE: api-staging non healthy"; docker logs --tail 30 opimappa-api-staging 2>&1; exit 1; }
echo "[*] Fatto → https://staging.opimappa.com (API)"
