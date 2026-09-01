#!/usr/bin/env bash
# deploy-prod.sh — PROMOZIONE staging → homeserver prod (https://opimappa.com).
#
# Da eseguire SUL homeserver come utente `levi` (gruppo docker), via SSH:
#   ssh levi@100.111.232.12 'bash -s' < scripts/deploy-prod.sh -- --web --api
# oppure copia lo script sul server ed esegui lì.
#
# Promuove l'ARTEFATTO GIA' VERIFICATO in staging — NON ricostruisce nulla, così
# il bit servito in prod è identico a quello testato su staging.opimappa.com (no drift):
#   - web : copia /opt/opimappa/web-staging  → /opt/opimappa/web/build  + restart caddy
#   - api : tag opimappa-api:staging → :latest + ricrea container opimappa-api
#
# ⚠️ PRESUPPOSTO: l'ultima build di staging corrisponde al commit verificato e approvato.
#    Se hai pushato altro dopo il test, ri-verifica staging PRIMA di promuovere.
#
# ⛔ Questo script NON tocca master né Vercel/Supabase (prod clienti). Riguarda solo
#    l'homeserver opimappa.com.
#
# NB tecnici verificati sul server:
#   - /opt è root-only e non attraversabile da levi → ogni scrittura in /opt passa
#     per il docker daemon (root) con bind mount, MAI con sudo/scp diretto.
#   - prod opimappa-api gira via `docker run` MANUALE (no compose) con env inline.
#     Qui l'env viene RILETTO dal container in esecuzione (docker inspect) e riapplicato
#     via --env-file: nessun secret è hardcoded in questo file.
#   - prod opimappa-api NON ha healthcheck → verifica via HTTP da container effimero.
set -euo pipefail

# ---- config (allineata all'infra verificata) --------------------------------
NET=opimappa_opimappa_net
API_NAME=opimappa-api
API_ALIAS=api
IMG=opimappa-api
WEB_SRC=/opt/opimappa/web-staging
WEB_DST=/opt/opimappa/web/build
CADDY=opimappa-caddy
BACKUP_DIR=/home/levi
DATE=$(date +%Y%m%d-%H%M%S)

# ---- args -------------------------------------------------------------------
DO_WEB=0; DO_API=0; BACKUP=1
for a in "$@"; do
  case "$a" in
    --web) DO_WEB=1 ;;
    --api) DO_API=1 ;;
    --no-backup) BACKUP=0 ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Argomento sconosciuto: $a" >&2; exit 2 ;;
  esac
done
# nessun flag → promuovi entrambi
if [ "$DO_WEB" -eq 0 ] && [ "$DO_API" -eq 0 ]; then DO_WEB=1; DO_API=1; fi

echo "========================================"
echo "Promozione staging → PROD homeserver (opimappa.com)"
echo "web=$DO_WEB api=$DO_API backup=$BACKUP  [$DATE]"
echo "========================================"

# ---- API --------------------------------------------------------------------
if [ "$DO_API" -eq 1 ]; then
  echo "[API] verifico immagine opimappa-api:staging..."
  docker image inspect "$IMG:staging" >/dev/null 2>&1 || { echo "ERRORE: $IMG:staging assente (esegui prima il deploy staging API)"; exit 1; }

  if [ "$BACKUP" -eq 1 ] && docker image inspect "$IMG:latest" >/dev/null 2>&1; then
    echo "[API] backup immagine corrente → $IMG:rollback-$DATE"
    docker tag "$IMG:latest" "$IMG:rollback-$DATE"
  fi

  echo "[API] promuovo staging → latest"
  docker tag "$IMG:staging" "$IMG:latest"

  echo "[API] rileggo env dal container in esecuzione (no secret hardcoded)..."
  ENV_FILE=$(mktemp /tmp/opimappa-prod-env.XXXXXX)
  chmod 600 "$ENV_FILE"
  trap 'rm -f "$ENV_FILE"' EXIT
  docker inspect "$API_NAME" --format '{{range .Config.Env}}{{println .}}{{end}}' > "$ENV_FILE"

  echo "[API] ricreo container $API_NAME..."
  docker stop "$API_NAME" >/dev/null
  docker rm "$API_NAME" >/dev/null
  docker run -d --name "$API_NAME" \
    --network "$NET" --network-alias "$API_ALIAS" \
    --restart unless-stopped \
    --env-file "$ENV_FILE" \
    "$IMG:latest" >/dev/null
  rm -f "$ENV_FILE"; trap - EXIT

  echo "[API] attendo che risponda su rete interna..."
  ok=0
  for _ in $(seq 1 20); do
    if docker run --rm --network "$NET" curlimages/curl:latest \
         -s -o /dev/null -w '%{http_code}' --max-time 4 "http://$API_ALIAS:3000/api/me" 2>/dev/null \
         | grep -qE '^(200|401)$'; then ok=1; break; fi
    sleep 3
  done
  if [ "$ok" -eq 1 ]; then
    echo "[API] OK (HTTP raggiungibile)."
  else
    echo "[API] ⚠️ nessuna risposta attesa. Log recenti:"; docker logs --tail 30 "$API_NAME" 2>&1
    echo "[API] ROLLBACK: docker tag $IMG:rollback-$DATE $IMG:latest && rilancia questo script --api"
    exit 1
  fi
fi

# ---- WEB --------------------------------------------------------------------
if [ "$DO_WEB" -eq 1 ]; then
  echo "[WEB] verifico sorgente staging non vuota..."
  docker run --rm -v "$WEB_SRC":/src:ro alpine sh -c '[ -f /src/index.html ]' \
    || { echo "ERRORE: $WEB_SRC senza index.html (staging non ancora buildato?)"; exit 1; }

  if [ "$BACKUP" -eq 1 ]; then
    echo "[WEB] backup build corrente → $BACKUP_DIR/web-build-prev.tar.gz"
    docker run --rm -v "$WEB_DST":/src:ro -v "$BACKUP_DIR":/bak alpine \
      tar -C /src -czf /bak/web-build-prev.tar.gz . 2>/dev/null || echo "[WEB] (build precedente vuota, salto backup)"
  fi

  echo "[WEB] copio staging → prod (docker bind, no sudo)..."
  docker run --rm -v "$WEB_SRC":/src:ro -v "$WEB_DST":/dst alpine \
    sh -c 'find /dst -mindepth 1 -delete && cp -a /src/. /dst/'

  echo "[WEB] restart caddy (re-resolve bind mount)..."
  docker restart "$CADDY" >/dev/null
  echo "[WEB] OK."
fi

echo "========================================"
echo "Fatto → https://opimappa.com"
echo "Rollback web:  tar -xzf $BACKUP_DIR/web-build-prev.tar.gz dentro $WEB_DST (via container) + restart $CADDY"
echo "Rollback api:  docker tag $IMG:rollback-$DATE $IMG:latest && bash deploy-prod.sh --api"
echo "========================================"
