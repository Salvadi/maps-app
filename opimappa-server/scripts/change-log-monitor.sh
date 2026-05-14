#!/bin/bash
# /opt/opimappa/scripts/change-log-monitor.sh
# Fix M4: monitoraggio dimensione e retention change_log
# Cron giornaliero: 0 7 * * * /opt/opimappa/scripts/change-log-monitor.sh

COUNT=$(docker exec opimappa_postgres psql -U opimappa -At -d opimappa -c "SELECT count(*) FROM change_log")
OLDEST_DAYS=$(docker exec opimappa_postgres psql -U opimappa -At -d opimappa -c "
  SELECT extract(day from now() - min(changed_at))::int FROM change_log
")

# Alert se:
# - Tabella > 1M righe (lentezza queries)
# - Oldest < 25 giorni (avvicinamento retention 30gg, client potrebbero perdere cursor)
if [ "$COUNT" -gt 1000000 ]; then
  echo "ALERT: change_log $COUNT rows" | mail -s "OPImaPPA change_log size" admin@opimappa.com
fi

if [ "$OLDEST_DAYS" -lt 25 ]; then
  echo "ALERT: change_log retention margin shrinking (oldest=$OLDEST_DAYS days)" | mail -s "OPImaPPA retention" admin@opimappa.com
fi
