-- =============================================================================
-- MIGRATION: Strutture (structure_entries + FK alternative + RLS + pricing category)
-- Target: questo branch "Strutture"
-- Eseguire in Supabase SQL Editor (idempotente dove possibile)
-- =============================================================================

-- 1) Nuova tabella structure_entries
CREATE TABLE IF NOT EXISTS public.structure_entries (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id    UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  floor         TEXT NOT NULL,
  room          TEXT,
  intervention  TEXT,
  structures    JSONB NOT NULL DEFAULT '[]'::jsonb,
  photos        JSONB NOT NULL DEFAULT '[]'::jsonb,
  timestamp     BIGINT NOT NULL,
  last_modified BIGINT NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1,
  created_by    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  modified_by   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  to_complete   BOOLEAN DEFAULT false,
  synced        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_structure_entries_project    ON public.structure_entries(project_id);
CREATE INDEX IF NOT EXISTS idx_structure_entries_floor      ON public.structure_entries(floor);
CREATE INDEX IF NOT EXISTS idx_structure_entries_created_by ON public.structure_entries(created_by);
CREATE INDEX IF NOT EXISTS idx_structure_entries_timestamp  ON public.structure_entries(timestamp DESC);

DROP TRIGGER IF EXISTS update_structure_entries_updated_at ON public.structure_entries;
CREATE TRIGGER update_structure_entries_updated_at
  BEFORE UPDATE ON public.structure_entries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.structure_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view structure entries"       ON public.structure_entries;
DROP POLICY IF EXISTS "Admins view all structure entries"  ON public.structure_entries;
DROP POLICY IF EXISTS "Users create structure entries"     ON public.structure_entries;
DROP POLICY IF EXISTS "Users update structure entries"     ON public.structure_entries;
DROP POLICY IF EXISTS "Users delete own structure entries" ON public.structure_entries;

CREATE POLICY "Users view structure entries" ON public.structure_entries FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = structure_entries.project_id
      AND (p.owner_id = auth.uid() OR p.accessible_users @> jsonb_build_array(auth.uid()::text))
  )
);

CREATE POLICY "Admins view all structure entries" ON public.structure_entries FOR SELECT
  USING (public.is_admin());

CREATE POLICY "Users create structure entries" ON public.structure_entries FOR INSERT
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = structure_entries.project_id
        AND (p.owner_id = auth.uid() OR p.accessible_users @> jsonb_build_array(auth.uid()::text))
    )
  );

CREATE POLICY "Users update structure entries" ON public.structure_entries FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = structure_entries.project_id
      AND (p.owner_id = auth.uid() OR p.accessible_users @> jsonb_build_array(auth.uid()::text))
  )
);

CREATE POLICY "Users delete own structure entries" ON public.structure_entries FOR DELETE
  USING (created_by = auth.uid());

-- 2) photos: parent alternativo mapping_entry_id | structure_entry_id
ALTER TABLE public.photos
  ALTER COLUMN mapping_entry_id DROP NOT NULL;

ALTER TABLE public.photos
  ADD COLUMN IF NOT EXISTS structure_entry_id UUID REFERENCES public.structure_entries(id) ON DELETE CASCADE;

ALTER TABLE public.photos
  DROP CONSTRAINT IF EXISTS photos_exactly_one_parent;
ALTER TABLE public.photos
  ADD CONSTRAINT photos_exactly_one_parent CHECK (
    (mapping_entry_id IS NOT NULL AND structure_entry_id IS NULL) OR
    (mapping_entry_id IS NULL AND structure_entry_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_photos_structure_entry ON public.photos(structure_entry_id);

-- Aggiornamento policies photos per coprire anche structure_entry_id
DROP POLICY IF EXISTS "Users view photos"   ON public.photos;
DROP POLICY IF EXISTS "Users create photos" ON public.photos;
DROP POLICY IF EXISTS "Users update photos" ON public.photos;
DROP POLICY IF EXISTS "Users delete photos" ON public.photos;

CREATE POLICY "Users view photos" ON public.photos FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.mapping_entries me
    JOIN public.projects p ON p.id = me.project_id
    WHERE me.id = photos.mapping_entry_id
      AND (p.owner_id = auth.uid() OR p.accessible_users @> jsonb_build_array(auth.uid()::text))
  )
  OR EXISTS (
    SELECT 1 FROM public.structure_entries se
    JOIN public.projects p ON p.id = se.project_id
    WHERE se.id = photos.structure_entry_id
      AND (p.owner_id = auth.uid() OR p.accessible_users @> jsonb_build_array(auth.uid()::text))
  )
);

CREATE POLICY "Users create photos" ON public.photos FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.mapping_entries me
    JOIN public.projects p ON p.id = me.project_id
    WHERE me.id = photos.mapping_entry_id
      AND (p.owner_id = auth.uid() OR p.accessible_users @> jsonb_build_array(auth.uid()::text))
  )
  OR EXISTS (
    SELECT 1 FROM public.structure_entries se
    JOIN public.projects p ON p.id = se.project_id
    WHERE se.id = photos.structure_entry_id
      AND (p.owner_id = auth.uid() OR p.accessible_users @> jsonb_build_array(auth.uid()::text))
  )
);

CREATE POLICY "Users update photos" ON public.photos FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM public.mapping_entries me
    JOIN public.projects p ON p.id = me.project_id
    WHERE me.id = photos.mapping_entry_id
      AND (p.owner_id = auth.uid() OR p.accessible_users @> jsonb_build_array(auth.uid()::text))
  )
  OR EXISTS (
    SELECT 1 FROM public.structure_entries se
    JOIN public.projects p ON p.id = se.project_id
    WHERE se.id = photos.structure_entry_id
      AND (p.owner_id = auth.uid() OR p.accessible_users @> jsonb_build_array(auth.uid()::text))
  )
);

CREATE POLICY "Users delete photos" ON public.photos FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM public.mapping_entries me
    JOIN public.projects p ON p.id = me.project_id
    WHERE me.id = photos.mapping_entry_id
      AND (p.owner_id = auth.uid() OR p.accessible_users @> jsonb_build_array(auth.uid()::text))
  )
  OR EXISTS (
    SELECT 1 FROM public.structure_entries se
    JOIN public.projects p ON p.id = se.project_id
    WHERE se.id = photos.structure_entry_id
      AND (p.owner_id = auth.uid() OR p.accessible_users @> jsonb_build_array(auth.uid()::text))
  )
);

-- 3) floor_plan_points: parent alternativo mapping_entry_id | structure_entry_id
ALTER TABLE public.floor_plan_points
  ALTER COLUMN mapping_entry_id DROP NOT NULL;

ALTER TABLE public.floor_plan_points
  ADD COLUMN IF NOT EXISTS structure_entry_id UUID REFERENCES public.structure_entries(id) ON DELETE CASCADE;

ALTER TABLE public.floor_plan_points
  DROP CONSTRAINT IF EXISTS fpp_exactly_one_parent;
ALTER TABLE public.floor_plan_points
  ADD CONSTRAINT fpp_exactly_one_parent CHECK (
    (mapping_entry_id IS NOT NULL AND structure_entry_id IS NULL) OR
    (mapping_entry_id IS NULL AND structure_entry_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_floor_plan_points_structure_entry ON public.floor_plan_points(structure_entry_id);

-- 4) typology_prices: aggiunta category (attraversamento/struttura)
ALTER TABLE public.typology_prices
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'attraversamento'
    CHECK (category IN ('attraversamento', 'struttura'));

DROP INDEX IF EXISTS idx_typology_prices_unique_generic;
DROP INDEX IF EXISTS idx_typology_prices_unique_specific;

CREATE UNIQUE INDEX IF NOT EXISTS idx_typology_prices_unique_generic
  ON public.typology_prices(project_id, category, attraversamento)
  WHERE tipologico_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_typology_prices_unique_specific
  ON public.typology_prices(project_id, category, attraversamento, tipologico_id)
  WHERE tipologico_id IS NOT NULL;

-- 5) Seed dropdown options strutture (idempotente, senza dipendere da UNIQUE(category, value))
INSERT INTO public.dropdown_options (category, value, label, sort_order, is_active)
SELECT v.category, v.value, v.label, v.sort_order, v.is_active
FROM (
  VALUES
    ('struttura', 'Parete',                    'Parete',                    10, true),
    ('struttura', 'Soffitto',                  'Soffitto',                  20, true),
    ('struttura', 'Cassonetto porta-impianto', 'Cassonetto porta-impianto', 30, true),
    ('struttura', 'Altro',                     'Altro',                     99, true),
    ('tipo_struttura', 'Flessibile',           'Flessibile',                10, true),
    ('tipo_struttura', 'Rigido',               'Rigido',                    20, true)
) AS v(category, value, label, sort_order, is_active)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.dropdown_options d
  WHERE d.category = v.category
    AND d.value = v.value
);
