#!/usr/bin/env bash
# deploy-staging.sh — eseguito dal self-hosted GitHub runner SUL homeserver.
# Builda la PWA e la pubblica in /opt/opimappa/web-staging.
#
# NB: gira come utente runner (gruppo docker), SENZA sudo. /opt è root-only e non
# attraversabile dall'utente: per scrivere usiamo il docker daemon (root) con un
# bind mount, lo stesso pattern usato per la web di produzione.
#
# Scope: SOLO frontend. Le modifiche all'API (opimappa-server/api) richiedono un
# rebuild manuale dell'immagine api-staging (vedi docs/STAGING_SETUP.md).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_DEST=/opt/opimappa/web-staging

echo "========================================"
echo "Deploy Staging (web)"
echo "Branch: $(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
echo "Commit: $(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo '?')"
echo "========================================"

echo "[*] Build frontend (CRA)..."
cd "$REPO_ROOT"
npm ci --legacy-peer-deps
npm run build

echo "[*] Pubblico la build in $WEB_DEST (docker bind, no sudo)..."
# svuota il contenuto precedente (il container gira come root → può scrivere in /opt)
docker run --rm -v "$WEB_DEST":/dest alpine sh -c "find /dest -mindepth 1 -delete"
# estrae la nuova build dentro la dir montata
tar -C build -czf - . | docker run --rm -i -v "$WEB_DEST":/dest alpine tar -C /dest -xzf -

echo "[*] Fatto → https://staging.opimappa.com"
