-- Drop server-side sync_queue table
-- Il client usa esclusivamente Dexie (db.syncQueue) per la queue locale.
-- La tabella server era un residuo mai consumato.

DROP TABLE IF EXISTS public.sync_queue CASCADE;
