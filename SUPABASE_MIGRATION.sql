-- ========================================
-- NESSUNA MIGRAZIONE NECESSARIA
-- ========================================
--
-- Il campo sync_enabled NON viene più sincronizzato con Supabase.
-- È una preferenza locale per ogni dispositivo e rimane solo in IndexedDB.
--
-- Ogni utente può scegliere su ogni dispositivo quali progetti
-- sincronizzare completamente, senza influenzare gli altri utenti.
--
-- ========================================

-- Se hai già eseguito la migrazione precedente che aggiungeva sync_enabled,
-- puoi rimuovere la colonna (opzionale):

-- ALTER TABLE projects DROP COLUMN IF EXISTS sync_enabled;
-- DROP INDEX IF EXISTS idx_projects_sync_enabled;

-- Ma non è necessario: il campo sarà semplicemente ignorato dall'app.
