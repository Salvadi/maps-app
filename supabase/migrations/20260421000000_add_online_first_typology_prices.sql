-- ============================================
-- Online-first extensions
-- - photo thumbnail metadata columns
-- - typology_prices table with project-scoped RLS
-- ============================================

ALTER TABLE public.photos
  ADD COLUMN IF NOT EXISTS thumbnail_storage_path TEXT,
  ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;

CREATE TABLE IF NOT EXISTS public.typology_prices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  attraversamento TEXT NOT NULL,
  tipologico_id TEXT,
  price_per_unit NUMERIC(12, 2) NOT NULL DEFAULT 0,
  unit TEXT NOT NULL CHECK (unit IN ('piece', 'sqm')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_typology_prices_project
  ON public.typology_prices(project_id);

CREATE INDEX IF NOT EXISTS idx_typology_prices_project_attraversamento
  ON public.typology_prices(project_id, attraversamento);

CREATE UNIQUE INDEX IF NOT EXISTS idx_typology_prices_unique_generic
  ON public.typology_prices(project_id, attraversamento)
  WHERE tipologico_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_typology_prices_unique_specific
  ON public.typology_prices(project_id, attraversamento, tipologico_id)
  WHERE tipologico_id IS NOT NULL;

ALTER TABLE public.typology_prices ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE POLICY "Users can view typology prices for accessible projects"
  ON public.typology_prices
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE id = typology_prices.project_id
      AND (
        owner_id = auth.uid()
        OR accessible_users @> jsonb_build_array(auth.uid()::text)
      )
    )
  );

CREATE POLICY "Admins can view all typology prices"
  ON public.typology_prices
  FOR SELECT
  USING (public.is_admin());

CREATE POLICY "Users can create typology prices"
  ON public.typology_prices
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE id = typology_prices.project_id
      AND (
        owner_id = auth.uid()
        OR accessible_users @> jsonb_build_array(auth.uid()::text)
      )
    )
  );

CREATE POLICY "Users can update typology prices"
  ON public.typology_prices
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE id = typology_prices.project_id
      AND (
        owner_id = auth.uid()
        OR accessible_users @> jsonb_build_array(auth.uid()::text)
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE id = typology_prices.project_id
      AND (
        owner_id = auth.uid()
        OR accessible_users @> jsonb_build_array(auth.uid()::text)
      )
    )
  );

CREATE POLICY "Users can delete typology prices"
  ON public.typology_prices
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE id = typology_prices.project_id
      AND (
        owner_id = auth.uid()
        OR accessible_users @> jsonb_build_array(auth.uid()::text)
      )
    )
  );

CREATE POLICY "Admins can manage all typology prices"
  ON public.typology_prices
  FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'update_typology_prices_updated_at'
  ) THEN
    CREATE TRIGGER update_typology_prices_updated_at
      BEFORE UPDATE ON public.typology_prices
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;
