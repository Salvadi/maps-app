#!/usr/bin/env bash
set -euo pipefail

# Variabili configurabili
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_DEST="/opt/opimappa/web-staging"
COMPOSE_DIR="opimappa-server"

echo "========================================"
echo "Deploy Staging Environment"
echo "Branch: $(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD)"
echo "Commit: $(git -C "$REPO_ROOT" rev-parse --short HEAD)"
echo "========================================"

# Step 2: Build frontend
echo "[*] Build del frontend (CRA)..."
cd "$REPO_ROOT"
npm ci --legacy-peer-deps
npm run build

# Step 3: Deploy web
echo "[*] Deploy file statici in $WEB_DEST ..."
# Nota: il runner deve avere permessi sudo per scrivere in /opt/opimappa/web-staging
# (configurare NOPASSWD in sudoers o impostare ownership della directory all'utente runner)
sudo mkdir -p "$WEB_DEST"
# Pulizia idempotente del contenuto precedente (inclusi dotfile)
sudo find "$WEB_DEST" -mindepth 1 -delete 2>/dev/null || true
sudo cp -r "${REPO_ROOT}/build/"* "$WEB_DEST/"

# Step 4: Build e restart API
echo "[*] Build e riavvio servizi API staging..."
cd "${REPO_ROOT}/${COMPOSE_DIR}"
docker compose -f docker-compose.yml -f docker-compose.staging.yml build api-staging
docker compose -f docker-compose.yml -f docker-compose.staging.yml up -d api-staging minio-staging

# Step 5: Reload reverse proxy
echo "[*] Restart container Caddy (reverse proxy)..."
# Necessario il restart completo perché il container è in read_only mode e exec non è affidabile
docker restart opimappa-caddy

# Step 6: Verifica finale
echo "========================================"
echo "Deploy completato con successo!"
echo "URL: https://staging.opimappa.com"
echo "========================================"
echo "Log recenti di opimappa-api-staging:"
docker logs --tail 20 opimappa-api-staging