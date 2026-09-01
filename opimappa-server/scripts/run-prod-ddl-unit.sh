#!/usr/bin/env bash
# One-off idempotente: aggiunge la colonna `unit` a dropdown_options sul DB PROD homeserver.
# Necessario PRIMA di promuovere la nuova API (allow-list include `unit`).
# Uso (Windows PowerShell):
#   Get-Content -Raw opimappa-server/scripts/run-prod-ddl-unit.sh | ssh levi@100.111.232.12 'bash -s'
# Uso (bash):
#   ssh levi@100.111.232.12 'bash -s' < opimappa-server/scripts/run-prod-ddl-unit.sh
set -euo pipefail
echo "=== DDL PROD: dropdown_options.unit ==="
DBURL=$(docker exec opimappa-api printenv DATABASE_URL)
NET=$(docker inspect opimappa-api -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' | awk '{print $1}')
echo "Rete docker: $NET"
docker run --rm --network "$NET" postgres:16-alpine \
  psql "$DBURL" -v ON_ERROR_STOP=1 -c "ALTER TABLE public.dropdown_options ADD COLUMN IF NOT EXISTS unit TEXT;"
echo "Verifica presenza colonna:"
docker run --rm --network "$NET" postgres:16-alpine \
  psql "$DBURL" -tAc "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='dropdown_options' AND column_name='unit';"
echo "=== DDL completata ==="
