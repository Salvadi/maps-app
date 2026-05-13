-- C9: Write-freeze completo Supabase durante cutover
-- Eseguire via Supabase SQL Editor PRIMA di avviare reverse-delta-supabase.ts
-- Verificare con scripts/test-freeze.ts dopo applicazione

-- 1. Revoca scritture role anon
REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM anon;

-- 2. Revoca scritture role authenticated (CRITICO: mancante in freeze naive)
REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM authenticated;

-- 3. Policy RESTRICTIVE di blocco su ogni tabella business
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY[
    'projects','mapping_entries','structure_entries','photos','floor_plans',
    'floor_plan_points','standalone_maps','sals','typology_prices',
    'dropdown_options','products','profiles'
  ] LOOP
    EXECUTE format('
      CREATE POLICY "cutover_freeze_block_writes" ON %I
      AS RESTRICTIVE
      FOR INSERT, UPDATE, DELETE
      TO public
      USING (false) WITH CHECK (false);
    ', t);
  END LOOP;
END $$;

-- 4. Storage policies: blocca insert/update/delete su entrambi i bucket
CREATE POLICY "cutover_storage_freeze_photos" ON storage.objects
  AS RESTRICTIVE
  FOR INSERT, UPDATE, DELETE
  TO public
  USING (bucket_id = 'photos' AND false);

CREATE POLICY "cutover_storage_freeze_planimetrie" ON storage.objects
  AS RESTRICTIVE
  FOR INSERT, UPDATE, DELETE
  TO public
  USING (bucket_id = 'planimetrie' AND false);

-- Verificare con: SELECT policyname, tablename FROM pg_policies WHERE policyname LIKE 'cutover_%';
