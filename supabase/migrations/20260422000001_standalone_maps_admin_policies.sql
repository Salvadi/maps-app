-- Aggiunge policy admin a standalone_maps (tabella già esistente)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'standalone_maps' AND policyname = 'Admins can view all standalone maps'
  ) THEN
    CREATE POLICY "Admins can view all standalone maps"
      ON public.standalone_maps FOR SELECT
      USING (public.is_admin());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'standalone_maps' AND policyname = 'Admins can insert all standalone maps'
  ) THEN
    CREATE POLICY "Admins can insert all standalone maps"
      ON public.standalone_maps FOR INSERT
      WITH CHECK (public.is_admin());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'standalone_maps' AND policyname = 'Admins can update all standalone maps'
  ) THEN
    CREATE POLICY "Admins can update all standalone maps"
      ON public.standalone_maps FOR UPDATE
      USING (public.is_admin());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'standalone_maps' AND policyname = 'Admins can delete all standalone maps'
  ) THEN
    CREATE POLICY "Admins can delete all standalone maps"
      ON public.standalone_maps FOR DELETE
      USING (public.is_admin());
  END IF;
END $$;
