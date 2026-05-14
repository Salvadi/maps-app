#!/bin/bash
# test-restore.sh
#
# Fix M3: Verifica deterministica dello schema dopo un ciclo backup/restore.
# Confronta lo schema normalizzato del container di produzione con quello
# del container di restore di test.
#
# Uso:
#   bash scripts/test-restore.sh
#
# Variabili d'ambiente (con default):
#   PROD_CONTAINER   — nome container Docker di produzione  (default: opimappa_postgres)
#   PROD_DB          — nome database di produzione          (default: opimappa)
#   PROD_USER        — utente PostgreSQL di produzione      (default: opimappa)
#   RESTORE_CONTAINER — nome container di restore test      (default: pg_restore_test)
#   RESTORE_DB       — nome database di restore             (default: test_restore)
#
PROD_CONTAINER="${PROD_CONTAINER:-opimappa_postgres}"
PROD_DB="${PROD_DB:-opimappa}"
PROD_USER="${PROD_USER:-opimappa}"
RESTORE_CONTAINER="${RESTORE_CONTAINER:-pg_restore_test}"
RESTORE_DB="${RESTORE_DB:-test_restore}"
RESTORE_USER="${RESTORE_USER:-postgres}"

echo "=== Test backup/restore: verifica schema deterministico ==="
echo "  Produzione:  container=$PROD_CONTAINER db=$PROD_DB user=$PROD_USER"
echo "  Restore:     container=$RESTORE_CONTAINER db=$RESTORE_DB user=$RESTORE_USER"
echo ""

# Verifica che i container siano raggiungibili prima di procedere
if ! docker exec "$PROD_CONTAINER" true 2>/dev/null; then
  echo "ERRORE: container prod '$PROD_CONTAINER' non raggiungibile" >&2
  exit 1
fi
if ! docker exec "$RESTORE_CONTAINER" true 2>/dev/null; then
  echo "ERRORE: container restore '$RESTORE_CONTAINER' non raggiungibile" >&2
  exit 1
fi

# set -e attivo solo da qui: i pg_dump falliti devono interrompere lo script
set -e

# Dump schema normalizzato — rimuove commenti, SET, SELECT catalog e righe vuote,
# poi ordina per confronto deterministico indipendente dall'ordine di dump.
PROD_SCHEMA=$(docker exec "$PROD_CONTAINER" \
  pg_dump -U "$PROD_USER" --schema-only --no-owner --no-acl --no-comments "$PROD_DB" \
  | grep -vE '^(--|SET |SELECT pg_catalog)' \
  | grep -v '^$' \
  | sort)

REST_SCHEMA=$(docker exec "$RESTORE_CONTAINER" \
  pg_dump -U "$RESTORE_USER" --schema-only --no-owner --no-acl --no-comments "$RESTORE_DB" \
  | grep -vE '^(--|SET |SELECT pg_catalog)' \
  | grep -v '^$' \
  | sort)

if [ "$PROD_SCHEMA" != "$REST_SCHEMA" ]; then
  echo "ERRORE: Schema diff rilevato tra produzione e restore:"
  diff <(echo "$PROD_SCHEMA") <(echo "$REST_SCHEMA") || true
  exit 2
fi

echo "Schema match OK — nessuna differenza rilevata."
exit 0
