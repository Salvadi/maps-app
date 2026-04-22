-- =============================================================================
-- OPImaPPA — Schema Supabase (baseline)
-- =============================================================================
-- Riflette lo stato corrente del database in produzione.
-- Idempotente: puó essere rieseguito per portare un progetto vuoto allo stato
-- atteso dall'app.
--
-- NON incluso in questo file: pipeline RAG/certificati (rag_*, manufacturers,
-- manufacturer_lexicon) — vive in un repo separato.
-- =============================================================================

-- =============================================================================
-- EXTENSIONS
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- HELPER: is_admin()
-- =============================================================================
-- SECURITY DEFINER per evitare ricorsione infinita quando usata nelle RLS
-- policies su profiles.

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
END;
$$;

-- =============================================================================
-- PROFILES
-- =============================================================================
-- Estende auth.users con username e ruolo.

CREATE TABLE IF NOT EXISTS public.profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       TEXT NOT NULL UNIQUE,
  username    TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT username_length CHECK (char_length(username) BETWEEN 3 AND 20),
  CONSTRAINT username_format CHECK (username ~ '^[a-zA-Z][a-zA-Z0-9_]*$')
);

-- =============================================================================
-- PROJECTS
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.projects (
  id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title                       TEXT NOT NULL,
  client                      TEXT NOT NULL DEFAULT '',
  address                     TEXT NOT NULL DEFAULT '',
  notes                       TEXT NOT NULL DEFAULT '',
  floors                      JSONB NOT NULL DEFAULT '[]'::jsonb,
  plans                       JSONB NOT NULL DEFAULT '[]'::jsonb,
  floor_plans                 JSONB NOT NULL DEFAULT '[]'::jsonb,
  typologies                  JSONB NOT NULL DEFAULT '[]'::jsonb,
  owner_id                    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  accessible_users            JSONB NOT NULL DEFAULT '[]'::jsonb,
  use_room_numbering          BOOLEAN NOT NULL DEFAULT false,
  use_intervention_numbering  BOOLEAN NOT NULL DEFAULT false,
  archived                    BOOLEAN NOT NULL DEFAULT false,
  synced                      BOOLEAN NOT NULL DEFAULT true,
  sync_enabled                INTEGER NOT NULL DEFAULT 0,
  version                     INTEGER DEFAULT 1,
  last_modified               BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW())::BIGINT * 1000),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_projects_owner         ON public.projects(owner_id);
CREATE INDEX IF NOT EXISTS idx_projects_updated       ON public.projects(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_synced        ON public.projects(synced);
CREATE INDEX IF NOT EXISTS idx_projects_archived      ON public.projects(archived);
CREATE INDEX IF NOT EXISTS idx_projects_last_modified ON public.projects(last_modified DESC);
CREATE INDEX IF NOT EXISTS idx_projects_version       ON public.projects(version);

-- =============================================================================
-- MAPPING ENTRIES
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.mapping_entries (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id           UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  floor                TEXT NOT NULL,
  room                 TEXT,
  intervention         TEXT,
  crossings            JSONB NOT NULL DEFAULT '[]'::jsonb,
  photos               JSONB NOT NULL DEFAULT '[]'::jsonb,
  timestamp            BIGINT NOT NULL,
  last_modified        BIGINT NOT NULL,
  version              INTEGER NOT NULL DEFAULT 1,
  created_by           UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  modified_by          UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  planimetry_point_id  TEXT,
  planimetry_x         NUMERIC,
  planimetry_y         NUMERIC,
  planimetry_label     TEXT,
  to_complete          BOOLEAN DEFAULT false,
  synced               BOOLEAN NOT NULL DEFAULT true,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mapping_entries_project      ON public.mapping_entries(project_id);
CREATE INDEX IF NOT EXISTS idx_mapping_entries_floor        ON public.mapping_entries(floor);
CREATE INDEX IF NOT EXISTS idx_mapping_entries_created_by   ON public.mapping_entries(created_by);
CREATE INDEX IF NOT EXISTS idx_mapping_entries_timestamp    ON public.mapping_entries(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_mapping_entries_synced       ON public.mapping_entries(synced);
CREATE INDEX IF NOT EXISTS idx_mapping_entries_to_complete  ON public.mapping_entries(to_complete) WHERE to_complete = true;

-- =============================================================================
-- PHOTOS
-- =============================================================================
-- Metadata; i blob reali sono nel bucket Storage "photos".

CREATE TABLE IF NOT EXISTS public.photos (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mapping_entry_id        UUID NOT NULL REFERENCES public.mapping_entries(id) ON DELETE CASCADE,
  storage_path            TEXT,
  url                     TEXT,
  thumbnail_storage_path  TEXT,
  thumbnail_url           TEXT,
  metadata                JSONB NOT NULL DEFAULT '{}'::jsonb,
  uploaded                BOOLEAN NOT NULL DEFAULT false,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_photos_mapping_entry ON public.photos(mapping_entry_id);
CREATE INDEX IF NOT EXISTS idx_photos_uploaded      ON public.photos(uploaded);

-- =============================================================================
-- FLOOR PLANS
-- =============================================================================
-- Planimetrie di progetto; immagini nel bucket Storage "planimetrie".

CREATE TABLE IF NOT EXISTS public.floor_plans (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id         UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  floor              TEXT NOT NULL,
  image_url          TEXT NOT NULL,
  thumbnail_url      TEXT,
  pdf_url            TEXT,
  original_filename  TEXT NOT NULL DEFAULT '',
  original_format    TEXT NOT NULL DEFAULT '',
  width              INTEGER NOT NULL DEFAULT 0,
  height             INTEGER NOT NULL DEFAULT 0,
  metadata           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_floor_plans_project  ON public.floor_plans(project_id);
CREATE INDEX IF NOT EXISTS idx_floor_plans_floor    ON public.floor_plans(floor);
CREATE INDEX IF NOT EXISTS idx_floor_plans_project_floor ON public.floor_plans(project_id, floor);

-- =============================================================================
-- FLOOR PLAN POINTS
-- =============================================================================
-- Annotazioni (punti, perimetri, etichette) sulle planimetrie.

CREATE TABLE IF NOT EXISTS public.floor_plan_points (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  floor_plan_id     UUID NOT NULL REFERENCES public.floor_plans(id) ON DELETE CASCADE,
  mapping_entry_id  UUID NOT NULL REFERENCES public.mapping_entries(id) ON DELETE CASCADE,
  point_type        TEXT NOT NULL,
  point_x           DOUBLE PRECISION NOT NULL,
  point_y           DOUBLE PRECISION NOT NULL,
  label_x           DOUBLE PRECISION NOT NULL,
  label_y           DOUBLE PRECISION NOT NULL,
  perimeter_points  JSONB NOT NULL DEFAULT '[]'::jsonb,
  custom_text       TEXT,
  ei_rating         SMALLINT,
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by        UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_floor_plan_points_floor_plan    ON public.floor_plan_points(floor_plan_id);
CREATE INDEX IF NOT EXISTS idx_floor_plan_points_mapping_entry ON public.floor_plan_points(mapping_entry_id);
CREATE INDEX IF NOT EXISTS idx_floor_plan_points_type          ON public.floor_plan_points(point_type);

-- =============================================================================
-- DROPDOWN OPTIONS
-- =============================================================================
-- Opzioni condivise tra utenti (Supporto, Tipo Supporto, Materiali,
-- Attraversamento, ecc.). Scrivibili solo dagli admin.

CREATE TABLE IF NOT EXISTS public.dropdown_options (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category    TEXT NOT NULL,
  value       TEXT NOT NULL,
  label       TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (category, value)
);

CREATE INDEX IF NOT EXISTS idx_dropdown_options_category   ON public.dropdown_options(category);
CREATE INDEX IF NOT EXISTS idx_dropdown_options_sort_order ON public.dropdown_options(category, sort_order);

-- =============================================================================
-- PRODUCTS
-- =============================================================================
-- Catalogo prodotti per brand. Scrivibile solo dagli admin.

CREATE TABLE IF NOT EXISTS public.products (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand       TEXT NOT NULL,
  name        TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (brand, name)
);

CREATE INDEX IF NOT EXISTS idx_products_brand      ON public.products(brand);
CREATE INDEX IF NOT EXISTS idx_products_sort_order ON public.products(brand, sort_order);

-- =============================================================================
-- SALS (Stato Avanzamento Lavori)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.sals (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id  UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  number      INTEGER NOT NULL,
  name        TEXT,
  date        BIGINT NOT NULL,
  notes       TEXT,
  synced      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, number)
);

CREATE INDEX IF NOT EXISTS idx_sals_project ON public.sals(project_id);

-- =============================================================================
-- TYPOLOGY PRICES
-- =============================================================================
-- Prezzi per tipologia di attraversamento/tipologico, scoped per progetto.

CREATE TABLE IF NOT EXISTS public.typology_prices (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id      UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  attraversamento TEXT NOT NULL,
  tipologico_id   TEXT,
  price_per_unit  NUMERIC(12, 2) NOT NULL DEFAULT 0,
  unit            TEXT NOT NULL CHECK (unit IN ('piece', 'sqm')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

-- =============================================================================
-- STANDALONE MAPS
-- =============================================================================
-- Planimetrie indipendenti (non legate a un progetto), per-utente.

CREATE TABLE IF NOT EXISTS public.standalone_maps (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  description        TEXT,
  image_url          TEXT NOT NULL,
  thumbnail_url      TEXT,
  pdf_url            TEXT,
  original_filename  TEXT NOT NULL DEFAULT '',
  original_format    TEXT,
  width              INTEGER NOT NULL DEFAULT 0,
  height             INTEGER NOT NULL DEFAULT 0,
  points             JSONB NOT NULL DEFAULT '[]'::jsonb,
  grid_enabled       BOOLEAN NOT NULL DEFAULT false,
  grid_config        JSONB NOT NULL DEFAULT '{"rows":10,"cols":10,"offsetX":0,"offsetY":0}'::jsonb,
  metadata           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_standalone_maps_user    ON public.standalone_maps(user_id);
CREATE INDEX IF NOT EXISTS idx_standalone_maps_updated ON public.standalone_maps(updated_at DESC);

-- =============================================================================
-- TRIGGERS: updated_at
-- =============================================================================

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS update_profiles_updated_at          ON public.profiles;
DROP TRIGGER IF EXISTS update_projects_updated_at          ON public.projects;
DROP TRIGGER IF EXISTS update_mapping_entries_updated_at   ON public.mapping_entries;
DROP TRIGGER IF EXISTS update_photos_updated_at            ON public.photos;
DROP TRIGGER IF EXISTS update_floor_plans_updated_at       ON public.floor_plans;
DROP TRIGGER IF EXISTS update_floor_plan_points_updated_at ON public.floor_plan_points;
DROP TRIGGER IF EXISTS update_dropdown_options_updated_at  ON public.dropdown_options;
DROP TRIGGER IF EXISTS update_products_updated_at          ON public.products;
DROP TRIGGER IF EXISTS update_typology_prices_updated_at   ON public.typology_prices;
DROP TRIGGER IF EXISTS update_standalone_maps_updated_at   ON public.standalone_maps;

CREATE TRIGGER update_profiles_updated_at          BEFORE UPDATE ON public.profiles          FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_projects_updated_at          BEFORE UPDATE ON public.projects          FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_mapping_entries_updated_at   BEFORE UPDATE ON public.mapping_entries   FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_photos_updated_at            BEFORE UPDATE ON public.photos            FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_floor_plans_updated_at       BEFORE UPDATE ON public.floor_plans       FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_floor_plan_points_updated_at BEFORE UPDATE ON public.floor_plan_points FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_dropdown_options_updated_at  BEFORE UPDATE ON public.dropdown_options  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_products_updated_at          BEFORE UPDATE ON public.products          FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_typology_prices_updated_at   BEFORE UPDATE ON public.typology_prices   FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_standalone_maps_updated_at   BEFORE UPDATE ON public.standalone_maps   FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================================================
-- TRIGGERS: last_modified (conflict resolution)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.update_last_modified_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.last_modified = EXTRACT(EPOCH FROM NOW())::BIGINT * 1000;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS update_projects_last_modified ON public.projects;
CREATE TRIGGER update_projects_last_modified
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.update_last_modified_column();

-- =============================================================================
-- TRIGGER: creazione profilo al signup
-- =============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  user_username TEXT;
BEGIN
  user_username := COALESCE(
    NEW.raw_user_meta_data->>'username',
    split_part(NEW.email, '@', 1)
  );

  IF char_length(user_username) < 3 THEN
    user_username := split_part(NEW.email, '@', 1);
  END IF;

  INSERT INTO public.profiles (id, email, username, role)
  VALUES (NEW.id, NEW.email, user_username, 'user');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =============================================================================
-- ROW LEVEL SECURITY — enable
-- =============================================================================

ALTER TABLE public.profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mapping_entries   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.photos            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.floor_plans       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.floor_plan_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dropdown_options  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sals              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.typology_prices   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.standalone_maps   ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- RLS POLICIES — profiles
-- =============================================================================

DROP POLICY IF EXISTS "Users can view own profile"   ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;

CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Admins can view all profiles"
  ON public.profiles FOR SELECT USING (public.is_admin());

-- =============================================================================
-- RLS POLICIES — projects
-- =============================================================================

DROP POLICY IF EXISTS "Projects select"                  ON public.projects;
DROP POLICY IF EXISTS "Users insert own projects"        ON public.projects;
DROP POLICY IF EXISTS "Admins insert projects"           ON public.projects;
DROP POLICY IF EXISTS "Users update own projects"        ON public.projects;
DROP POLICY IF EXISTS "Users update accessible projects" ON public.projects;
DROP POLICY IF EXISTS "Admins update all projects"       ON public.projects;
DROP POLICY IF EXISTS "Users delete own projects"        ON public.projects;
DROP POLICY IF EXISTS "Admins delete all projects"       ON public.projects;

CREATE POLICY "Projects select" ON public.projects FOR SELECT USING (
  owner_id = auth.uid()
  OR accessible_users @> jsonb_build_array(auth.uid()::text)
  OR public.is_admin()
);

CREATE POLICY "Users insert own projects" ON public.projects FOR INSERT
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Admins insert projects" ON public.projects FOR INSERT
  WITH CHECK (public.is_admin());

CREATE POLICY "Users update own projects" ON public.projects FOR UPDATE
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Users update accessible projects" ON public.projects FOR UPDATE
  USING (accessible_users @> jsonb_build_array(auth.uid()::text))
  WITH CHECK (accessible_users @> jsonb_build_array(auth.uid()::text));

CREATE POLICY "Admins update all projects" ON public.projects FOR UPDATE
  USING (public.is_admin()) WITH CHECK (true);

CREATE POLICY "Users delete own projects" ON public.projects FOR DELETE
  USING (owner_id = auth.uid());

CREATE POLICY "Admins delete all projects" ON public.projects FOR DELETE
  USING (public.is_admin());

-- =============================================================================
-- RLS POLICIES — mapping_entries
-- =============================================================================

DROP POLICY IF EXISTS "Users view mapping entries"       ON public.mapping_entries;
DROP POLICY IF EXISTS "Admins view all mapping entries"  ON public.mapping_entries;
DROP POLICY IF EXISTS "Users create mapping entries"     ON public.mapping_entries;
DROP POLICY IF EXISTS "Users update mapping entries"     ON public.mapping_entries;
DROP POLICY IF EXISTS "Users delete own mapping entries" ON public.mapping_entries;

CREATE POLICY "Users view mapping entries" ON public.mapping_entries FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = mapping_entries.project_id
      AND (p.owner_id = auth.uid() OR p.accessible_users @> jsonb_build_array(auth.uid()::text))
  )
);

CREATE POLICY "Admins view all mapping entries" ON public.mapping_entries FOR SELECT
  USING (public.is_admin());

CREATE POLICY "Users create mapping entries" ON public.mapping_entries FOR INSERT
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = mapping_entries.project_id
        AND (p.owner_id = auth.uid() OR p.accessible_users @> jsonb_build_array(auth.uid()::text))
    )
  );

CREATE POLICY "Users update mapping entries" ON public.mapping_entries FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = mapping_entries.project_id
      AND (p.owner_id = auth.uid() OR p.accessible_users @> jsonb_build_array(auth.uid()::text))
  )
);

CREATE POLICY "Users delete own mapping entries" ON public.mapping_entries FOR DELETE
  USING (created_by = auth.uid());

-- =============================================================================
-- RLS POLICIES — photos
-- =============================================================================

DROP POLICY IF EXISTS "Users view photos"       ON public.photos;
DROP POLICY IF EXISTS "Admins view all photos"  ON public.photos;
DROP POLICY IF EXISTS "Users create photos"     ON public.photos;
DROP POLICY IF EXISTS "Users update photos"     ON public.photos;
DROP POLICY IF EXISTS "Users delete photos"     ON public.photos;

CREATE POLICY "Users view photos" ON public.photos FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.mapping_entries me
    JOIN public.projects p ON p.id = me.project_id
    WHERE me.id = photos.mapping_entry_id
      AND (p.owner_id = auth.uid() OR p.accessible_users @> jsonb_build_array(auth.uid()::text))
  )
);

CREATE POLICY "Admins view all photos" ON public.photos FOR SELECT USING (public.is_admin());

CREATE POLICY "Users create photos" ON public.photos FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.mapping_entries me
    JOIN public.projects p ON p.id = me.project_id
    WHERE me.id = photos.mapping_entry_id
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
);

CREATE POLICY "Users delete photos" ON public.photos FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM public.mapping_entries me
    JOIN public.projects p ON p.id = me.project_id
    WHERE me.id = photos.mapping_entry_id
      AND (p.owner_id = auth.uid() OR p.accessible_users @> jsonb_build_array(auth.uid()::text))
  )
);

-- =============================================================================
-- RLS POLICIES — floor_plans
-- =============================================================================

DROP POLICY IF EXISTS "Users view floor plans"   ON public.floor_plans;
DROP POLICY IF EXISTS "Admins view all floor plans" ON public.floor_plans;
DROP POLICY IF EXISTS "Users create floor plans" ON public.floor_plans;
DROP POLICY IF EXISTS "Users update floor plans" ON public.floor_plans;
DROP POLICY IF EXISTS "Users delete floor plans" ON public.floor_plans;

CREATE POLICY "Users view floor plans" ON public.floor_plans FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = floor_plans.project_id
      AND (p.owner_id = auth.uid() OR p.accessible_users @> jsonb_build_array(auth.uid()::text))
  )
);

CREATE POLICY "Admins view all floor plans" ON public.floor_plans FOR SELECT USING (public.is_admin());

CREATE POLICY "Users create floor plans" ON public.floor_plans FOR INSERT WITH CHECK (
  created_by = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = floor_plans.project_id
      AND (p.owner_id = auth.uid() OR p.accessible_users @> jsonb_build_array(auth.uid()::text))
  )
);

CREATE POLICY "Users update floor plans" ON public.floor_plans FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = floor_plans.project_id
      AND (p.owner_id = auth.uid() OR p.accessible_users @> jsonb_build_array(auth.uid()::text))
  )
);

CREATE POLICY "Users delete floor plans" ON public.floor_plans FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = floor_plans.project_id
      AND (p.owner_id = auth.uid() OR p.accessible_users @> jsonb_build_array(auth.uid()::text))
  )
);

-- =============================================================================
-- RLS POLICIES — floor_plan_points
-- =============================================================================

DROP POLICY IF EXISTS "Users view floor plan points"   ON public.floor_plan_points;
DROP POLICY IF EXISTS "Admins view all floor plan points" ON public.floor_plan_points;
DROP POLICY IF EXISTS "Users create floor plan points" ON public.floor_plan_points;
DROP POLICY IF EXISTS "Users update floor plan points" ON public.floor_plan_points;
DROP POLICY IF EXISTS "Users delete floor plan points" ON public.floor_plan_points;

CREATE POLICY "Users view floor plan points" ON public.floor_plan_points FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.floor_plans fp
    JOIN public.projects p ON p.id = fp.project_id
    WHERE fp.id = floor_plan_points.floor_plan_id
      AND (p.owner_id = auth.uid() OR p.accessible_users @> jsonb_build_array(auth.uid()::text))
  )
);

CREATE POLICY "Admins view all floor plan points" ON public.floor_plan_points FOR SELECT USING (public.is_admin());

CREATE POLICY "Users create floor plan points" ON public.floor_plan_points FOR INSERT WITH CHECK (
  created_by = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.floor_plans fp
    JOIN public.projects p ON p.id = fp.project_id
    WHERE fp.id = floor_plan_points.floor_plan_id
      AND (p.owner_id = auth.uid() OR p.accessible_users @> jsonb_build_array(auth.uid()::text))
  )
);

CREATE POLICY "Users update floor plan points" ON public.floor_plan_points FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM public.floor_plans fp
    JOIN public.projects p ON p.id = fp.project_id
    WHERE fp.id = floor_plan_points.floor_plan_id
      AND (p.owner_id = auth.uid() OR p.accessible_users @> jsonb_build_array(auth.uid()::text))
  )
);

CREATE POLICY "Users delete floor plan points" ON public.floor_plan_points FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM public.floor_plans fp
    JOIN public.projects p ON p.id = fp.project_id
    WHERE fp.id = floor_plan_points.floor_plan_id
      AND (p.owner_id = auth.uid() OR p.accessible_users @> jsonb_build_array(auth.uid()::text))
  )
);

-- =============================================================================
-- RLS POLICIES — dropdown_options (lettura: tutti autenticati; scrittura: admin)
-- =============================================================================

DROP POLICY IF EXISTS "Authenticated can read dropdown_options" ON public.dropdown_options;
DROP POLICY IF EXISTS "Admin can insert dropdown_options" ON public.dropdown_options;
DROP POLICY IF EXISTS "Admin can update dropdown_options" ON public.dropdown_options;
DROP POLICY IF EXISTS "Admin can delete dropdown_options" ON public.dropdown_options;

CREATE POLICY "Authenticated can read dropdown_options"
  ON public.dropdown_options FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admin can insert dropdown_options"
  ON public.dropdown_options FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "Admin can update dropdown_options"
  ON public.dropdown_options FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY "Admin can delete dropdown_options"
  ON public.dropdown_options FOR DELETE TO authenticated
  USING (public.is_admin());

-- =============================================================================
-- RLS POLICIES — products
-- =============================================================================

DROP POLICY IF EXISTS "Authenticated can read products" ON public.products;
DROP POLICY IF EXISTS "Admin can insert products" ON public.products;
DROP POLICY IF EXISTS "Admin can update products" ON public.products;
DROP POLICY IF EXISTS "Admin can delete products" ON public.products;

CREATE POLICY "Authenticated can read products"
  ON public.products FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admin can insert products"
  ON public.products FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "Admin can update products"
  ON public.products FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY "Admin can delete products"
  ON public.products FOR DELETE TO authenticated
  USING (public.is_admin());

-- =============================================================================
-- RLS POLICIES — sals
-- =============================================================================

DROP POLICY IF EXISTS "Users view sals"        ON public.sals;
DROP POLICY IF EXISTS "Admins view all sals"   ON public.sals;
DROP POLICY IF EXISTS "Users create sals"      ON public.sals;
DROP POLICY IF EXISTS "Users update sals"      ON public.sals;
DROP POLICY IF EXISTS "Users delete sals"      ON public.sals;
DROP POLICY IF EXISTS "Admins manage all sals" ON public.sals;

CREATE POLICY "Users view sals" ON public.sals FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = sals.project_id
      AND (p.owner_id = auth.uid() OR p.accessible_users @> jsonb_build_array(auth.uid()::text))
  )
);

CREATE POLICY "Admins view all sals" ON public.sals FOR SELECT USING (public.is_admin());

CREATE POLICY "Users create sals" ON public.sals FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = sals.project_id
      AND (p.owner_id = auth.uid() OR p.accessible_users @> jsonb_build_array(auth.uid()::text))
  )
);

CREATE POLICY "Users update sals" ON public.sals FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = sals.project_id
      AND (p.owner_id = auth.uid() OR p.accessible_users @> jsonb_build_array(auth.uid()::text))
  )
);

CREATE POLICY "Users delete sals" ON public.sals FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = sals.project_id
      AND (p.owner_id = auth.uid() OR p.accessible_users @> jsonb_build_array(auth.uid()::text))
  )
);

CREATE POLICY "Admins manage all sals" ON public.sals
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- =============================================================================
-- RLS POLICIES — typology_prices
-- =============================================================================

DROP POLICY IF EXISTS "Users view typology prices"        ON public.typology_prices;
DROP POLICY IF EXISTS "Admins view all typology prices"   ON public.typology_prices;
DROP POLICY IF EXISTS "Users create typology prices"      ON public.typology_prices;
DROP POLICY IF EXISTS "Users update typology prices"      ON public.typology_prices;
DROP POLICY IF EXISTS "Users delete typology prices"      ON public.typology_prices;
DROP POLICY IF EXISTS "Admins manage all typology prices" ON public.typology_prices;

CREATE POLICY "Users view typology prices" ON public.typology_prices FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = typology_prices.project_id
      AND (p.owner_id = auth.uid() OR p.accessible_users @> jsonb_build_array(auth.uid()::text))
  )
);

CREATE POLICY "Admins view all typology prices" ON public.typology_prices FOR SELECT
  USING (public.is_admin());

CREATE POLICY "Users create typology prices" ON public.typology_prices FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = typology_prices.project_id
      AND (p.owner_id = auth.uid() OR p.accessible_users @> jsonb_build_array(auth.uid()::text))
  )
);

CREATE POLICY "Users update typology prices" ON public.typology_prices FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = typology_prices.project_id
      AND (p.owner_id = auth.uid() OR p.accessible_users @> jsonb_build_array(auth.uid()::text))
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = typology_prices.project_id
      AND (p.owner_id = auth.uid() OR p.accessible_users @> jsonb_build_array(auth.uid()::text))
  )
);

CREATE POLICY "Users delete typology prices" ON public.typology_prices FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = typology_prices.project_id
      AND (p.owner_id = auth.uid() OR p.accessible_users @> jsonb_build_array(auth.uid()::text))
  )
);

CREATE POLICY "Admins manage all typology prices" ON public.typology_prices
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- =============================================================================
-- RLS POLICIES — standalone_maps
-- =============================================================================

DROP POLICY IF EXISTS "Users view own standalone maps"    ON public.standalone_maps;
DROP POLICY IF EXISTS "Users insert own standalone maps"  ON public.standalone_maps;
DROP POLICY IF EXISTS "Users update own standalone maps"  ON public.standalone_maps;
DROP POLICY IF EXISTS "Users delete own standalone maps"  ON public.standalone_maps;
DROP POLICY IF EXISTS "Admins view all standalone maps"   ON public.standalone_maps;
DROP POLICY IF EXISTS "Admins insert all standalone maps" ON public.standalone_maps;
DROP POLICY IF EXISTS "Admins update all standalone maps" ON public.standalone_maps;
DROP POLICY IF EXISTS "Admins delete all standalone maps" ON public.standalone_maps;

CREATE POLICY "Users view own standalone maps"   ON public.standalone_maps FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own standalone maps" ON public.standalone_maps FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own standalone maps" ON public.standalone_maps FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own standalone maps" ON public.standalone_maps FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Admins view all standalone maps"   ON public.standalone_maps FOR SELECT USING (public.is_admin());
CREATE POLICY "Admins insert all standalone maps" ON public.standalone_maps FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY "Admins update all standalone maps" ON public.standalone_maps FOR UPDATE USING (public.is_admin());
CREATE POLICY "Admins delete all standalone maps" ON public.standalone_maps FOR DELETE USING (public.is_admin());

-- =============================================================================
-- FINE
-- =============================================================================
-- Policies per i bucket Storage (`photos`, `planimetrie`) in `storage-policies.sql`.
