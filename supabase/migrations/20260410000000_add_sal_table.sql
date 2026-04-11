-- ============================================
-- Aggiunge tabella SAL (Stato Avanzamento Lavori)
-- ============================================

CREATE TABLE IF NOT EXISTS public.sals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  name TEXT,
  date BIGINT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  synced BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (project_id, number)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sals_project ON public.sals(project_id);

-- Enable RLS
ALTER TABLE public.sals ENABLE ROW LEVEL SECURITY;

-- Users can view SALs for accessible projects
CREATE POLICY "Users can view sals for accessible projects"
  ON public.sals
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE id = sals.project_id
      AND (
        owner_id = auth.uid()
        OR accessible_users @> jsonb_build_array(auth.uid()::text)
      )
    )
  );

-- Admins can view all SALs
CREATE POLICY "Admins can view all sals"
  ON public.sals
  FOR SELECT
  USING (public.is_admin());

-- Users can create SALs for accessible projects
CREATE POLICY "Users can create sals"
  ON public.sals
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE id = sals.project_id
      AND (
        owner_id = auth.uid()
        OR accessible_users @> jsonb_build_array(auth.uid()::text)
      )
    )
  );

-- Users can update SALs for accessible projects
CREATE POLICY "Users can update sals"
  ON public.sals
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE id = sals.project_id
      AND (
        owner_id = auth.uid()
        OR accessible_users @> jsonb_build_array(auth.uid()::text)
      )
    )
  );

-- Users can delete SALs for accessible projects
CREATE POLICY "Users can delete sals"
  ON public.sals
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE id = sals.project_id
      AND (
        owner_id = auth.uid()
        OR accessible_users @> jsonb_build_array(auth.uid()::text)
      )
    )
  );

-- Admins can manage all SALs
CREATE POLICY "Admins can manage all sals"
  ON public.sals
  FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());
