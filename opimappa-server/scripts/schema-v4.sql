-- =============================================================================
-- OPImaPPA — Schema v4 (PostgreSQL 17, self-hosted)
-- =============================================================================
-- Migrazione da Supabase verso home server demeter227.
-- Differenze chiave vs supabase/schema.sql:
--   1. Niente auth.* schema: tabelle better-auth native ("user", "session",
--      "account", "verification") con id TEXT (UUID-string enforced via CHECK).
--   2. profiles è una VIEW di compat su "user" + INSTEAD OF triggers
--      (UPDATE/INSERT/DELETE) — i 94 call site frontend restano invariati.
--   3. FK precedenti verso profiles(id) UUID rimappate a "user"(id) TEXT.
--   4. Nessuna RLS: enforcement applicativo nell'API Hono (scopeProjectFilter +
--      requireUser middleware) + test isolation tenant in CI (§13 piano v4).
--   5. Tabella change_log durabile (BIGSERIAL seq) + 10 triggers per-tabella
--      per realtime SSE robusto a SSE disconnect prolungato (C6 review v4).
--   6. cleanup_accessible_users con COALESCE(..., '[]'::jsonb) (C4 review v3).
--   7. Trigger profiles INSTEAD OF DELETE (C5 review v4).
--
-- Idempotente: re-eseguibile in sicurezza. Tutti CREATE TABLE IF NOT EXISTS,
-- CREATE OR REPLACE FUNCTION, DROP TRIGGER IF EXISTS prima di ogni CREATE.
--
-- Applicare via: psql -h localhost -U opimappa -d opimappa -f schema-v4.sql
-- =============================================================================


-- =============================================================================
-- EXTENSIONS
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- =============================================================================
-- BETTER-AUTH TABLES (schema nativo, NON modificare nomi/colonne)
-- =============================================================================
-- @better-auth/cli genera questo schema. Manteniamo conformità per evitare
-- drift con la libreria. Estensione applicativa: campi "role" e "active".
-- =============================================================================

CREATE TABLE IF NOT EXISTS "user" (
  id              TEXT PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  "emailVerified" BOOLEAN NOT NULL DEFAULT false,
  image           TEXT,
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Estensione applicativa
  role            TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  active          BOOLEAN NOT NULL DEFAULT true,
  -- better-auth admin plugin
  banned          BOOLEAN NOT NULL DEFAULT false,
  "banReason"     TEXT,
  "banExpires"    TIMESTAMPTZ,
  -- C5 review v4: force UUID format per compat con profiles VIEW (id::uuid)
  CONSTRAINT user_id_uuid_format CHECK (
    id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  )
);

CREATE TABLE IF NOT EXISTS "session" (
  id          TEXT PRIMARY KEY,
  "userId"    TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  token       TEXT NOT NULL UNIQUE,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_session_user_id    ON "session"("userId");
CREATE INDEX IF NOT EXISTS idx_session_expires_at ON "session"("expiresAt");
CREATE INDEX IF NOT EXISTS idx_session_token      ON "session"(token);

CREATE TABLE IF NOT EXISTS "account" (
  id           TEXT PRIMARY KEY,
  "userId"     TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "accountId"  TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  password     TEXT,                                       -- argon2id hash
  "createdAt"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_account_user_id ON "account"("userId");
CREATE INDEX IF NOT EXISTS idx_account_provider ON "account"("providerId", "accountId");

CREATE TABLE IF NOT EXISTS "verification" (
  id          TEXT PRIMARY KEY,
  identifier  TEXT NOT NULL,
  value       TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_verification_identifier ON "verification"(identifier);


-- =============================================================================
-- PROFILES — vista compat su "user" (C2/C5 review)
-- =============================================================================
-- I 94 call site frontend usano supabase.from('profiles'). Manteniamo questa
-- vista per zero refactor del frontend. INSTEAD OF triggers per UPDATE/INSERT/
-- DELETE (C5 review v4: tutti e 3, non solo UPDATE+INSERT).
-- =============================================================================

DROP VIEW IF EXISTS profiles CASCADE;

CREATE VIEW profiles AS
SELECT
  id::uuid                                    AS id,
  email,
  name                                        AS username,
  role,
  active,
  "createdAt"                                 AS created_at,
  "updatedAt"                                 AS updated_at
FROM "user";

-- INSTEAD OF UPDATE: patch sul "user" sottostante
CREATE OR REPLACE FUNCTION profiles_update() RETURNS trigger AS $$
BEGIN
  UPDATE "user" SET
    email       = COALESCE(NEW.email, email),
    name        = COALESCE(NEW.username, name),
    role        = COALESCE(NEW.role, role),
    active      = COALESCE(NEW.active, active),
    "updatedAt" = NOW()
  WHERE id = OLD.id::text;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS profiles_update_trg ON profiles;
CREATE TRIGGER profiles_update_trg
  INSTEAD OF UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION profiles_update();

-- INSTEAD OF INSERT: blocca, forza uso /api/auth/admin/create-user
CREATE OR REPLACE FUNCTION profiles_insert_block() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Inserimento diretto su profiles non permesso. Usa /api/auth/admin/create-user.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS profiles_insert_trg ON profiles;
CREATE TRIGGER profiles_insert_trg
  INSTEAD OF INSERT ON profiles
  FOR EACH ROW EXECUTE FUNCTION profiles_insert_block();

-- INSTEAD OF DELETE: hard delete su "user" (cascade FK su entità figlie + cleanup accessible_users)
CREATE OR REPLACE FUNCTION profiles_delete() RETURNS trigger AS $$
BEGIN
  DELETE FROM "user" WHERE id = OLD.id::text;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS profiles_delete_trg ON profiles;
CREATE TRIGGER profiles_delete_trg
  INSTEAD OF DELETE ON profiles
  FOR EACH ROW EXECUTE FUNCTION profiles_delete();


-- =============================================================================
-- CLEANUP accessible_users on user delete (C4 review v3 — COALESCE)
-- =============================================================================
-- Quando un utente viene eliminato, ripulisce array JSONB accessible_users
-- in tutti i projects. COALESCE evita NULL se ultimo utente rimosso.

CREATE OR REPLACE FUNCTION cleanup_accessible_users() RETURNS trigger AS $$
BEGIN
  UPDATE projects
  SET accessible_users = COALESCE((
    SELECT jsonb_agg(elem)
    FROM jsonb_array_elements_text(accessible_users) elem
    WHERE elem <> OLD.id
  ), '[]'::jsonb)
  WHERE accessible_users ? OLD.id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS user_delete_cleanup ON "user";
CREATE TRIGGER user_delete_cleanup
  BEFORE DELETE ON "user"
  FOR EACH ROW EXECUTE FUNCTION cleanup_accessible_users();


-- =============================================================================
-- PROJECTS
-- =============================================================================
-- owner_id: TEXT (era UUID) per FK verso "user"(id) TEXT.
-- =============================================================================

CREATE TABLE IF NOT EXISTS projects (
  id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title                       TEXT NOT NULL,
  client                      TEXT NOT NULL DEFAULT '',
  address                     TEXT NOT NULL DEFAULT '',
  notes                       TEXT NOT NULL DEFAULT '',
  floors                      JSONB NOT NULL DEFAULT '[]'::jsonb,
  plans                       JSONB NOT NULL DEFAULT '[]'::jsonb,
  floor_plans                 JSONB NOT NULL DEFAULT '[]'::jsonb,
  typologies                  JSONB NOT NULL DEFAULT '[]'::jsonb,
  owner_id                    TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS idx_projects_owner         ON projects(owner_id);
CREATE INDEX IF NOT EXISTS idx_projects_updated       ON projects(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_synced        ON projects(synced);
CREATE INDEX IF NOT EXISTS idx_projects_archived      ON projects(archived);
CREATE INDEX IF NOT EXISTS idx_projects_last_modified ON projects(last_modified DESC);
CREATE INDEX IF NOT EXISTS idx_projects_version       ON projects(version);
-- GIN index per containment query `accessible_users ? userId` (review v3 C3)
CREATE INDEX IF NOT EXISTS idx_projects_accessible_users_gin
  ON projects USING GIN (accessible_users);


-- =============================================================================
-- MAPPING ENTRIES
-- =============================================================================

CREATE TABLE IF NOT EXISTS mapping_entries (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id           UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  floor                TEXT NOT NULL,
  room                 TEXT,
  intervention         TEXT,
  crossings            JSONB NOT NULL DEFAULT '[]'::jsonb,
  photos               JSONB NOT NULL DEFAULT '[]'::jsonb,
  timestamp            BIGINT NOT NULL,
  last_modified        BIGINT NOT NULL,
  version              INTEGER NOT NULL DEFAULT 1,
  created_by           TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  modified_by          TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  planimetry_point_id  TEXT,
  planimetry_x         NUMERIC,
  planimetry_y         NUMERIC,
  planimetry_label     TEXT,
  to_complete          BOOLEAN DEFAULT false,
  synced               BOOLEAN NOT NULL DEFAULT true,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mapping_entries_project       ON mapping_entries(project_id);
CREATE INDEX IF NOT EXISTS idx_mapping_entries_floor         ON mapping_entries(floor);
CREATE INDEX IF NOT EXISTS idx_mapping_entries_created_by    ON mapping_entries(created_by);
CREATE INDEX IF NOT EXISTS idx_mapping_entries_timestamp     ON mapping_entries(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_mapping_entries_synced        ON mapping_entries(synced);
CREATE INDEX IF NOT EXISTS idx_mapping_entries_to_complete   ON mapping_entries(to_complete) WHERE to_complete = true;
CREATE INDEX IF NOT EXISTS idx_mapping_entries_last_modified ON mapping_entries(last_modified DESC);


-- =============================================================================
-- STRUCTURE ENTRIES (C1 review v3: load-bearing, mancante in v3)
-- =============================================================================
-- Strutture costruite (pareti, soffitti, cassonetti). Parallele a mapping_entries.

CREATE TABLE IF NOT EXISTS structure_entries (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  floor         TEXT NOT NULL,
  room          TEXT,
  intervention  TEXT,
  structures    JSONB NOT NULL DEFAULT '[]'::jsonb,
  photos        JSONB NOT NULL DEFAULT '[]'::jsonb,
  timestamp     BIGINT NOT NULL,
  last_modified BIGINT NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1,
  created_by    TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  modified_by   TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  to_complete   BOOLEAN DEFAULT false,
  synced        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_structure_entries_project       ON structure_entries(project_id);
CREATE INDEX IF NOT EXISTS idx_structure_entries_floor         ON structure_entries(floor);
CREATE INDEX IF NOT EXISTS idx_structure_entries_created_by    ON structure_entries(created_by);
CREATE INDEX IF NOT EXISTS idx_structure_entries_timestamp     ON structure_entries(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_structure_entries_last_modified ON structure_entries(last_modified DESC);


-- =============================================================================
-- PHOTOS (metadata; blob in MinIO bucket "photos")
-- =============================================================================
-- mapping_entry_id E structure_entry_id sono nullable; CHECK forza esattamente uno.

CREATE TABLE IF NOT EXISTS photos (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mapping_entry_id        UUID REFERENCES mapping_entries(id) ON DELETE CASCADE,
  structure_entry_id      UUID REFERENCES structure_entries(id) ON DELETE CASCADE,
  storage_path            TEXT,
  url                     TEXT,
  thumbnail_storage_path  TEXT,
  thumbnail_url           TEXT,
  metadata                JSONB NOT NULL DEFAULT '{}'::jsonb,
  uploaded                BOOLEAN NOT NULL DEFAULT false,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT photos_exactly_one_parent CHECK (
    (mapping_entry_id IS NOT NULL AND structure_entry_id IS NULL) OR
    (mapping_entry_id IS NULL AND structure_entry_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_photos_mapping_entry   ON photos(mapping_entry_id);
CREATE INDEX IF NOT EXISTS idx_photos_structure_entry ON photos(structure_entry_id);
CREATE INDEX IF NOT EXISTS idx_photos_uploaded        ON photos(uploaded);


-- =============================================================================
-- FLOOR PLANS (planimetrie progetto; immagini in MinIO bucket "planimetrie")
-- =============================================================================
-- Path canonicali (review v4 C7): _storage_path colonne, URL signed runtime.

CREATE TABLE IF NOT EXISTS floor_plans (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id              UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  floor                   TEXT NOT NULL,
  -- URL legacy mantenute per backward compat durante migrazione
  image_url               TEXT NOT NULL DEFAULT '',
  thumbnail_url           TEXT,
  pdf_url                 TEXT,
  -- Path canonicali (review v4 C7): nuove colonne
  image_storage_path      TEXT,
  thumbnail_storage_path  TEXT,
  pdf_storage_path        TEXT,
  original_filename       TEXT NOT NULL DEFAULT '',
  original_format         TEXT NOT NULL DEFAULT '',
  width                   INTEGER NOT NULL DEFAULT 0,
  height                  INTEGER NOT NULL DEFAULT 0,
  metadata                JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by              TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_floor_plans_project       ON floor_plans(project_id);
CREATE INDEX IF NOT EXISTS idx_floor_plans_floor         ON floor_plans(floor);
CREATE INDEX IF NOT EXISTS idx_floor_plans_project_floor ON floor_plans(project_id, floor);


-- =============================================================================
-- FLOOR PLAN POINTS (annotazioni planimetrie)
-- =============================================================================

CREATE TABLE IF NOT EXISTS floor_plan_points (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  floor_plan_id       UUID NOT NULL REFERENCES floor_plans(id) ON DELETE CASCADE,
  mapping_entry_id    UUID REFERENCES mapping_entries(id) ON DELETE CASCADE,
  structure_entry_id  UUID REFERENCES structure_entries(id) ON DELETE CASCADE,
  point_type          TEXT NOT NULL,
  point_x             DOUBLE PRECISION NOT NULL,
  point_y             DOUBLE PRECISION NOT NULL,
  label_x             DOUBLE PRECISION NOT NULL,
  label_y             DOUBLE PRECISION NOT NULL,
  perimeter_points    JSONB NOT NULL DEFAULT '[]'::jsonb,
  custom_text         TEXT,
  ei_rating           SMALLINT,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by          TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fpp_exactly_one_parent CHECK (
    (mapping_entry_id IS NOT NULL AND structure_entry_id IS NULL) OR
    (mapping_entry_id IS NULL AND structure_entry_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_floor_plan_points_floor_plan      ON floor_plan_points(floor_plan_id);
CREATE INDEX IF NOT EXISTS idx_floor_plan_points_mapping_entry   ON floor_plan_points(mapping_entry_id);
CREATE INDEX IF NOT EXISTS idx_floor_plan_points_structure_entry ON floor_plan_points(structure_entry_id);
CREATE INDEX IF NOT EXISTS idx_floor_plan_points_type            ON floor_plan_points(point_type);


-- =============================================================================
-- STANDALONE MAPS (planimetrie indipendenti per-utente)
-- =============================================================================

CREATE TABLE IF NOT EXISTS standalone_maps (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  name                    TEXT NOT NULL,
  description             TEXT,
  -- URL legacy + path canonicali (review v4 C7)
  image_url               TEXT NOT NULL DEFAULT '',
  thumbnail_url           TEXT,
  pdf_url                 TEXT,
  image_storage_path      TEXT,
  thumbnail_storage_path  TEXT,
  pdf_storage_path        TEXT,
  original_filename       TEXT NOT NULL DEFAULT '',
  original_format         TEXT,
  width                   INTEGER NOT NULL DEFAULT 0,
  height                  INTEGER NOT NULL DEFAULT 0,
  points                  JSONB NOT NULL DEFAULT '[]'::jsonb,
  grid_enabled            BOOLEAN NOT NULL DEFAULT false,
  grid_config             JSONB NOT NULL DEFAULT '{"rows":10,"cols":10,"offsetX":0,"offsetY":0}'::jsonb,
  metadata                JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_standalone_maps_user    ON standalone_maps(user_id);
CREATE INDEX IF NOT EXISTS idx_standalone_maps_updated ON standalone_maps(updated_at DESC);


-- =============================================================================
-- DROPDOWN OPTIONS (globali, admin-only write)
-- =============================================================================

CREATE TABLE IF NOT EXISTS dropdown_options (
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

CREATE INDEX IF NOT EXISTS idx_dropdown_options_category   ON dropdown_options(category);
CREATE INDEX IF NOT EXISTS idx_dropdown_options_sort_order ON dropdown_options(category, sort_order);


-- =============================================================================
-- PRODUCTS (catalogo brand, admin-only write)
-- =============================================================================

CREATE TABLE IF NOT EXISTS products (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand       TEXT NOT NULL,
  name        TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (brand, name)
);

CREATE INDEX IF NOT EXISTS idx_products_brand      ON products(brand);
CREATE INDEX IF NOT EXISTS idx_products_sort_order ON products(brand, sort_order);


-- =============================================================================
-- SALS (Stato Avanzamento Lavori)
-- =============================================================================

CREATE TABLE IF NOT EXISTS sals (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  number      INTEGER NOT NULL,
  name        TEXT,
  date        BIGINT NOT NULL,
  notes       TEXT,
  synced      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, number)
);

CREATE INDEX IF NOT EXISTS idx_sals_project ON sals(project_id);


-- =============================================================================
-- TYPOLOGY PRICES (prezzi tipologici, scoped per progetto)
-- =============================================================================
-- category aggiunge distinzione strutture/attraversamenti.

CREATE TABLE IF NOT EXISTS typology_prices (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  attraversamento TEXT NOT NULL,
  tipologico_id   TEXT,
  category        TEXT NOT NULL DEFAULT 'attraversamento'
                    CHECK (category IN ('attraversamento', 'struttura')),
  price_per_unit  NUMERIC(12, 2) NOT NULL DEFAULT 0,
  unit            TEXT NOT NULL CHECK (unit IN ('piece', 'sqm')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_typology_prices_project ON typology_prices(project_id);
CREATE INDEX IF NOT EXISTS idx_typology_prices_project_attraversamento
  ON typology_prices(project_id, attraversamento);
CREATE UNIQUE INDEX IF NOT EXISTS idx_typology_prices_unique_generic
  ON typology_prices(project_id, category, attraversamento)
  WHERE tipologico_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_typology_prices_unique_specific
  ON typology_prices(project_id, category, attraversamento, tipologico_id)
  WHERE tipologico_id IS NOT NULL;


-- =============================================================================
-- TRIGGERS: updated_at (preserva logica supabase/schema.sql)
-- =============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS update_projects_updated_at          ON projects;
DROP TRIGGER IF EXISTS update_mapping_entries_updated_at   ON mapping_entries;
DROP TRIGGER IF EXISTS update_structure_entries_updated_at ON structure_entries;
DROP TRIGGER IF EXISTS update_photos_updated_at            ON photos;
DROP TRIGGER IF EXISTS update_floor_plans_updated_at       ON floor_plans;
DROP TRIGGER IF EXISTS update_floor_plan_points_updated_at ON floor_plan_points;
DROP TRIGGER IF EXISTS update_dropdown_options_updated_at  ON dropdown_options;
DROP TRIGGER IF EXISTS update_products_updated_at          ON products;
DROP TRIGGER IF EXISTS update_typology_prices_updated_at   ON typology_prices;
DROP TRIGGER IF EXISTS update_standalone_maps_updated_at   ON standalone_maps;

CREATE TRIGGER update_projects_updated_at          BEFORE UPDATE ON projects          FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_mapping_entries_updated_at   BEFORE UPDATE ON mapping_entries   FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_structure_entries_updated_at BEFORE UPDATE ON structure_entries FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_photos_updated_at            BEFORE UPDATE ON photos            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_floor_plans_updated_at       BEFORE UPDATE ON floor_plans       FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_floor_plan_points_updated_at BEFORE UPDATE ON floor_plan_points FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_dropdown_options_updated_at  BEFORE UPDATE ON dropdown_options  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_products_updated_at          BEFORE UPDATE ON products          FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_typology_prices_updated_at   BEFORE UPDATE ON typology_prices   FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_standalone_maps_updated_at   BEFORE UPDATE ON standalone_maps   FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- =============================================================================
-- TRIGGERS: last_modified (conflict resolution last-modified-wins)
-- =============================================================================

CREATE OR REPLACE FUNCTION update_last_modified_column()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.last_modified = EXTRACT(EPOCH FROM NOW())::BIGINT * 1000;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS update_projects_last_modified ON projects;
CREATE TRIGGER update_projects_last_modified
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION update_last_modified_column();


-- =============================================================================
-- CHANGE LOG (C6 review v4: durabile, BIGSERIAL seq cursor)
-- =============================================================================
-- Realtime durevole: SSE down non perde eventi. Client salva lastSeq in Dexie
-- e fa catch-up via /api/changes?sinceSeq=. Retention 30gg via cron.
-- =============================================================================

CREATE TABLE IF NOT EXISTS change_log (
  seq          BIGSERIAL PRIMARY KEY,
  table_name   TEXT NOT NULL,
  row_id       TEXT NOT NULL,
  op           TEXT NOT NULL CHECK (op IN ('INSERT', 'UPDATE', 'DELETE')),
  project_id   UUID,           -- popolato per tabelle scoped per progetto
  user_id      TEXT,           -- popolato per standalone_maps (no project)
  originator   TEXT,           -- session_id che ha generato evento (self-echo filter)
  changed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_change_log_seq          ON change_log(seq);
CREATE INDEX IF NOT EXISTS idx_change_log_table_seq    ON change_log(table_name, seq);
CREATE INDEX IF NOT EXISTS idx_change_log_project      ON change_log(project_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_change_log_user         ON change_log(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_change_log_changed_at   ON change_log(changed_at);


-- =============================================================================
-- TRIGGER FUNCTIONS: log_change_* per-tabella (C5+H3 review v4)
-- =============================================================================
-- Triggers custom per tabella perché photos/floor_plan_points derivano
-- project_id via JOIN su parent. standalone_maps usa user_id (no project).
-- Originator session via SET LOCAL opimappa.originator_session (server-derived).
-- =============================================================================

-- projects: project_id = id, owner_id diretto
CREATE OR REPLACE FUNCTION log_change_projects() RETURNS trigger AS $$
DECLARE originator text; new_seq bigint;
BEGIN
  BEGIN originator := current_setting('opimappa.originator_session', true); EXCEPTION WHEN OTHERS THEN originator := NULL; END;
  INSERT INTO change_log (table_name, row_id, op, project_id, user_id, originator)
  VALUES ('projects', COALESCE(NEW.id, OLD.id)::text, TG_OP, COALESCE(NEW.id, OLD.id), COALESCE(NEW.owner_id, OLD.owner_id), originator)
  RETURNING seq INTO new_seq;
  PERFORM pg_notify('opimappa_changes', new_seq::text);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS projects_changelog ON projects;
CREATE TRIGGER projects_changelog
  AFTER INSERT OR UPDATE OR DELETE ON projects
  FOR EACH ROW EXECUTE FUNCTION log_change_projects();


-- mapping_entries: project_id diretto
CREATE OR REPLACE FUNCTION log_change_mapping_entries() RETURNS trigger AS $$
DECLARE originator text; new_seq bigint;
BEGIN
  BEGIN originator := current_setting('opimappa.originator_session', true); EXCEPTION WHEN OTHERS THEN originator := NULL; END;
  INSERT INTO change_log (table_name, row_id, op, project_id, originator)
  VALUES ('mapping_entries', COALESCE(NEW.id, OLD.id)::text, TG_OP, COALESCE(NEW.project_id, OLD.project_id), originator)
  RETURNING seq INTO new_seq;
  PERFORM pg_notify('opimappa_changes', new_seq::text);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS mapping_entries_changelog ON mapping_entries;
CREATE TRIGGER mapping_entries_changelog
  AFTER INSERT OR UPDATE OR DELETE ON mapping_entries
  FOR EACH ROW EXECUTE FUNCTION log_change_mapping_entries();


-- structure_entries: project_id diretto (C1)
CREATE OR REPLACE FUNCTION log_change_structure_entries() RETURNS trigger AS $$
DECLARE originator text; new_seq bigint;
BEGIN
  BEGIN originator := current_setting('opimappa.originator_session', true); EXCEPTION WHEN OTHERS THEN originator := NULL; END;
  INSERT INTO change_log (table_name, row_id, op, project_id, originator)
  VALUES ('structure_entries', COALESCE(NEW.id, OLD.id)::text, TG_OP, COALESCE(NEW.project_id, OLD.project_id), originator)
  RETURNING seq INTO new_seq;
  PERFORM pg_notify('opimappa_changes', new_seq::text);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS structure_entries_changelog ON structure_entries;
CREATE TRIGGER structure_entries_changelog
  AFTER INSERT OR UPDATE OR DELETE ON structure_entries
  FOR EACH ROW EXECUTE FUNCTION log_change_structure_entries();


-- photos: project_id via JOIN su mapping_entry o structure_entry parent (C5)
CREATE OR REPLACE FUNCTION log_change_photos() RETURNS trigger AS $$
DECLARE
  originator text;
  new_seq bigint;
  proj uuid;
  me_id uuid;
  se_id uuid;
BEGIN
  BEGIN originator := current_setting('opimappa.originator_session', true); EXCEPTION WHEN OTHERS THEN originator := NULL; END;
  me_id := COALESCE(NEW.mapping_entry_id, OLD.mapping_entry_id);
  se_id := COALESCE(NEW.structure_entry_id, OLD.structure_entry_id);

  IF me_id IS NOT NULL THEN
    SELECT project_id INTO proj FROM mapping_entries WHERE id = me_id;
  ELSIF se_id IS NOT NULL THEN
    SELECT project_id INTO proj FROM structure_entries WHERE id = se_id;
  END IF;
  -- proj può essere NULL se parent già eliminato (cascade DELETE): evento DELETE comunque loggato per consistenza

  INSERT INTO change_log (table_name, row_id, op, project_id, originator)
  VALUES ('photos', COALESCE(NEW.id, OLD.id)::text, TG_OP, proj, originator)
  RETURNING seq INTO new_seq;
  PERFORM pg_notify('opimappa_changes', new_seq::text);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS photos_changelog ON photos;
CREATE TRIGGER photos_changelog
  AFTER INSERT OR UPDATE OR DELETE ON photos
  FOR EACH ROW EXECUTE FUNCTION log_change_photos();


-- floor_plans: project_id diretto
CREATE OR REPLACE FUNCTION log_change_floor_plans() RETURNS trigger AS $$
DECLARE originator text; new_seq bigint;
BEGIN
  BEGIN originator := current_setting('opimappa.originator_session', true); EXCEPTION WHEN OTHERS THEN originator := NULL; END;
  INSERT INTO change_log (table_name, row_id, op, project_id, originator)
  VALUES ('floor_plans', COALESCE(NEW.id, OLD.id)::text, TG_OP, COALESCE(NEW.project_id, OLD.project_id), originator)
  RETURNING seq INTO new_seq;
  PERFORM pg_notify('opimappa_changes', new_seq::text);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS floor_plans_changelog ON floor_plans;
CREATE TRIGGER floor_plans_changelog
  AFTER INSERT OR UPDATE OR DELETE ON floor_plans
  FOR EACH ROW EXECUTE FUNCTION log_change_floor_plans();


-- floor_plan_points: project_id via JOIN su floor_plan parent (C5)
CREATE OR REPLACE FUNCTION log_change_floor_plan_points() RETURNS trigger AS $$
DECLARE
  originator text;
  new_seq bigint;
  proj uuid;
  fp_id uuid;
BEGIN
  BEGIN originator := current_setting('opimappa.originator_session', true); EXCEPTION WHEN OTHERS THEN originator := NULL; END;
  fp_id := COALESCE(NEW.floor_plan_id, OLD.floor_plan_id);
  SELECT project_id INTO proj FROM floor_plans WHERE id = fp_id;

  INSERT INTO change_log (table_name, row_id, op, project_id, originator)
  VALUES ('floor_plan_points', COALESCE(NEW.id, OLD.id)::text, TG_OP, proj, originator)
  RETURNING seq INTO new_seq;
  PERFORM pg_notify('opimappa_changes', new_seq::text);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS floor_plan_points_changelog ON floor_plan_points;
CREATE TRIGGER floor_plan_points_changelog
  AFTER INSERT OR UPDATE OR DELETE ON floor_plan_points
  FOR EACH ROW EXECUTE FUNCTION log_change_floor_plan_points();


-- standalone_maps: user_id (no project)
CREATE OR REPLACE FUNCTION log_change_standalone_maps() RETURNS trigger AS $$
DECLARE originator text; new_seq bigint;
BEGIN
  BEGIN originator := current_setting('opimappa.originator_session', true); EXCEPTION WHEN OTHERS THEN originator := NULL; END;
  INSERT INTO change_log (table_name, row_id, op, user_id, originator)
  VALUES ('standalone_maps', COALESCE(NEW.id, OLD.id)::text, TG_OP, COALESCE(NEW.user_id, OLD.user_id), originator)
  RETURNING seq INTO new_seq;
  PERFORM pg_notify('opimappa_changes', new_seq::text);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS standalone_maps_changelog ON standalone_maps;
CREATE TRIGGER standalone_maps_changelog
  AFTER INSERT OR UPDATE OR DELETE ON standalone_maps
  FOR EACH ROW EXECUTE FUNCTION log_change_standalone_maps();


-- sals: project_id diretto
CREATE OR REPLACE FUNCTION log_change_sals() RETURNS trigger AS $$
DECLARE originator text; new_seq bigint;
BEGIN
  BEGIN originator := current_setting('opimappa.originator_session', true); EXCEPTION WHEN OTHERS THEN originator := NULL; END;
  INSERT INTO change_log (table_name, row_id, op, project_id, originator)
  VALUES ('sals', COALESCE(NEW.id, OLD.id)::text, TG_OP, COALESCE(NEW.project_id, OLD.project_id), originator)
  RETURNING seq INTO new_seq;
  PERFORM pg_notify('opimappa_changes', new_seq::text);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sals_changelog ON sals;
CREATE TRIGGER sals_changelog
  AFTER INSERT OR UPDATE OR DELETE ON sals
  FOR EACH ROW EXECUTE FUNCTION log_change_sals();


-- typology_prices: project_id diretto
CREATE OR REPLACE FUNCTION log_change_typology_prices() RETURNS trigger AS $$
DECLARE originator text; new_seq bigint;
BEGIN
  BEGIN originator := current_setting('opimappa.originator_session', true); EXCEPTION WHEN OTHERS THEN originator := NULL; END;
  INSERT INTO change_log (table_name, row_id, op, project_id, originator)
  VALUES ('typology_prices', COALESCE(NEW.id, OLD.id)::text, TG_OP, COALESCE(NEW.project_id, OLD.project_id), originator)
  RETURNING seq INTO new_seq;
  PERFORM pg_notify('opimappa_changes', new_seq::text);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS typology_prices_changelog ON typology_prices;
CREATE TRIGGER typology_prices_changelog
  AFTER INSERT OR UPDATE OR DELETE ON typology_prices
  FOR EACH ROW EXECUTE FUNCTION log_change_typology_prices();


-- dropdown_options + products: globali, project_id=NULL user_id=NULL → visibili a tutti
CREATE OR REPLACE FUNCTION log_change_global() RETURNS trigger AS $$
DECLARE originator text; new_seq bigint;
BEGIN
  BEGIN originator := current_setting('opimappa.originator_session', true); EXCEPTION WHEN OTHERS THEN originator := NULL; END;
  INSERT INTO change_log (table_name, row_id, op, originator)
  VALUES (TG_TABLE_NAME, COALESCE(NEW.id, OLD.id)::text, TG_OP, originator)
  RETURNING seq INTO new_seq;
  PERFORM pg_notify('opimappa_changes', new_seq::text);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS dropdown_options_changelog ON dropdown_options;
CREATE TRIGGER dropdown_options_changelog
  AFTER INSERT OR UPDATE OR DELETE ON dropdown_options
  FOR EACH ROW EXECUTE FUNCTION log_change_global();

DROP TRIGGER IF EXISTS products_changelog ON products;
CREATE TRIGGER products_changelog
  AFTER INSERT OR UPDATE OR DELETE ON products
  FOR EACH ROW EXECUTE FUNCTION log_change_global();


-- =============================================================================
-- AUDIT LOG (Sprint 2 — auth events: login fallito, escalation, cross-tenant)
-- =============================================================================

CREATE TABLE IF NOT EXISTS auth_audit_log (
  id          BIGSERIAL PRIMARY KEY,
  user_id     TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  event       TEXT NOT NULL,
  ip          INET,
  user_agent  TEXT,
  success     BOOLEAN NOT NULL,
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  ts          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_audit_log_user_id ON auth_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_audit_log_event   ON auth_audit_log(event);
CREATE INDEX IF NOT EXISTS idx_auth_audit_log_ts      ON auth_audit_log(ts DESC);


-- =============================================================================
-- SEED: dropdown_options (strutture, tipo struttura)
-- =============================================================================
-- Replica seed da supabase/schema.sql:1030-1038 — idempotente.

INSERT INTO dropdown_options (category, value, label, sort_order, is_active)
VALUES
  ('struttura',      'Parete',                    'Parete',                    10, true),
  ('struttura',      'Soffitto',                  'Soffitto',                  20, true),
  ('struttura',      'Cassonetto porta-impianto', 'Cassonetto porta-impianto', 30, true),
  ('struttura',      'Altro',                     'Altro',                     99, true),
  ('tipo_struttura', 'Flessibile',                'Flessibile',                10, true),
  ('tipo_struttura', 'Rigido',                    'Rigido',                    20, true)
ON CONFLICT (category, value) DO NOTHING;


-- =============================================================================
-- COMPLETED
-- =============================================================================
-- Tabelle business: 12 (esclusa profiles vista)
-- Tabelle better-auth: 4 (user, session, account, verification)
-- Tabelle infra: 2 (change_log, auth_audit_log)
-- Trigger log_change_*: 10 (projects, mapping_entries, structure_entries,
--   photos, floor_plans, floor_plan_points, standalone_maps, sals,
--   typology_prices, dropdown_options + products via log_change_global)
-- Trigger compat profiles: 3 (UPDATE, INSERT block, DELETE)
-- Trigger cleanup_accessible_users: 1
-- Trigger updated_at: 10
-- Trigger last_modified: 1 (projects)
-- =============================================================================
