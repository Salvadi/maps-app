#!/usr/bin/env bash
# deploy-pwa.sh — Copia il build CRA nel volume Caddy /opt/opimappa/web
# Eseguire dal root del repo PWA dopo `npm run build`.
# Uso: bash opimappa-server/scripts/deploy-pwa.sh [BUILD_DIR]
set -euo pipefail

BUILD_DIR="${1:-build}"
WEB_DIR="/opt/opimappa/web"

if [ ! -d "$BUILD_DIR" ]; then
  echo "ERRORE: directory build non trovata: $BUILD_DIR" >&2
  echo "Eseguire prima: npm run build" >&2
  exit 1
fi

echo "→ Copia $BUILD_DIR → $WEB_DIR ..."
mkdir -p "$WEB_DIR"
rsync -av --delete "$BUILD_DIR/" "$WEB_DIR/"
echo "✓ PWA deployata in $WEB_DIR"
echo "  Ricaricare Caddy se in esecuzione: docker exec opimappa-caddy caddy reload --config /etc/caddy/Caddyfile"
