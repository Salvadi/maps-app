#!/usr/bin/env bash
# deploy-pwa.sh — Trasferisce il build CRA su demeter227 via tar+ssh+Docker
# Eseguire dal root del repo PWA dopo `npm run build`.
# Uso: bash opimappa-server/scripts/deploy-pwa.sh [SSH_HOST] [BUILD_DIR]
# Prerequisiti: ~/.ssh/id_ed25519, Docker su host remoto
set -euo pipefail

SSH_HOST="${1:-levi@100.111.232.12}"
BUILD_DIR="${2:-build}"

if [ ! -d "$BUILD_DIR" ]; then
  echo "ERRORE: directory build non trovata: $BUILD_DIR" >&2
  echo "Eseguire prima: npm run build" >&2
  exit 1
fi

echo "→ Trasferimento $BUILD_DIR → $SSH_HOST:/opt/opimappa/web/build/ ..."
tar -czf - "$BUILD_DIR/" | ssh -i ~/.ssh/id_ed25519 -o StrictHostKeyChecking=no "$SSH_HOST" \
  "docker run --rm -i -v /opt/opimappa/web/build:/web alpine:latest sh -c 'cd /web && tar -xzf - --strip-components=1'"

echo "✓ PWA deployata in /opt/opimappa/web/build"
echo "  Caddy serve già da /srv/web — nessun reload necessario."
