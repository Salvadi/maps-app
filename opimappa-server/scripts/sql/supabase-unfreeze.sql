-- C9: Script unfreeze Supabase (rollback emergenza o dopo cutover completato)
-- Eseguire via Supabase SQL Editor SOLO dopo reverse-delta verificato
-- oppure in caso di rollback per annullare il freeze

-- 1. Rimuovi policy RESTRICTIVE da ogni tabella business
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY[
    'projects','mapping_entries','structure_entries','photos','floor_plans',
    'floor_plan_points','standalone_maps','sals','typology_prices',
    'dropdown_options','products','profiles'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "cutover_freeze_block_writes" ON %I', t);
  END LOOP;
END $$;

-- 2. Rimuovi policy storage
DROP POLICY IF EXISTS "cutover_storage_freeze_photos" ON storage.objects;
DROP POLICY IF EXISTS "cutover_storage_freeze_planimetrie" ON storage.objects;

-- 3. Ripristina GRANT (REVOKE era su ALL TABLES al momento del freeze;
--    ri-grant su tabelle specifiche per sicurezza — aggiornare se lo schema cambia)
GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated;

-- Verificare con: SELECT policyname FROM pg_policies WHERE policyname LIKE 'cutover_%';
-- Deve tornare 0 righe.
