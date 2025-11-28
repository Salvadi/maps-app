-- ============================================
-- OPImaPPA Supabase Database Schema
-- ============================================
-- This schema mirrors the IndexedDB structure
-- and includes Row Level Security policies
-- ============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- TABLES
-- ============================================

-- Profiles table (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT username_length CHECK (char_length(username) >= 3 AND char_length(username) <= 20),
  CONSTRAINT username_format CHECK (username ~ '^[a-zA-Z][a-zA-Z0-9_]*$')
);

-- Projects table
CREATE TABLE IF NOT EXISTS public.projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  client TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  floors JSONB NOT NULL DEFAULT '[]'::jsonb,
  plans JSONB NOT NULL DEFAULT '[]'::jsonb,
  intervention_mode TEXT NOT NULL DEFAULT 'room' CHECK (intervention_mode IN ('room', 'intervento')),
  typologies JSONB NOT NULL DEFAULT '[]'::jsonb,
  owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  accessible_users JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  synced BOOLEAN NOT NULL DEFAULT true
);

-- Mapping entries table
CREATE TABLE IF NOT EXISTS public.mapping_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  floor TEXT NOT NULL,
  room_or_intervention TEXT NOT NULL,
  crossings JSONB NOT NULL DEFAULT '[]'::jsonb,
  timestamp BIGINT NOT NULL,
  last_modified BIGINT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  modified_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  photos JSONB NOT NULL DEFAULT '[]'::jsonb,
  synced BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Photos table (stores metadata, actual files in Storage)
CREATE TABLE IF NOT EXISTS public.photos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mapping_entry_id UUID NOT NULL REFERENCES public.mapping_entries(id) ON DELETE CASCADE,
  storage_path TEXT, -- Path in Supabase Storage
  url TEXT, -- Public/signed URL
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  uploaded BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Sync queue table (tracks pending changes)
CREATE TABLE IF NOT EXISTS public.sync_queue (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  operation TEXT NOT NULL CHECK (operation IN ('CREATE', 'UPDATE', 'DELETE')),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('project', 'mapping_entry', 'photo')),
  entity_id UUID NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  timestamp BIGINT NOT NULL,
  synced BOOLEAN NOT NULL DEFAULT false,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

-- ============================================
-- INDEXES
-- ============================================

-- Projects indexes
CREATE INDEX IF NOT EXISTS idx_projects_owner ON public.projects(owner_id);
CREATE INDEX IF NOT EXISTS idx_projects_updated ON public.projects(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_synced ON public.projects(synced);

-- Mapping entries indexes
CREATE INDEX IF NOT EXISTS idx_mapping_entries_project ON public.mapping_entries(project_id);
CREATE INDEX IF NOT EXISTS idx_mapping_entries_floor ON public.mapping_entries(floor);
CREATE INDEX IF NOT EXISTS idx_mapping_entries_created_by ON public.mapping_entries(created_by);
CREATE INDEX IF NOT EXISTS idx_mapping_entries_timestamp ON public.mapping_entries(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_mapping_entries_synced ON public.mapping_entries(synced);

-- Photos indexes
CREATE INDEX IF NOT EXISTS idx_photos_mapping_entry ON public.photos(mapping_entry_id);
CREATE INDEX IF NOT EXISTS idx_photos_uploaded ON public.photos(uploaded);

-- Sync queue indexes
CREATE INDEX IF NOT EXISTS idx_sync_queue_user ON public.sync_queue(user_id);
CREATE INDEX IF NOT EXISTS idx_sync_queue_synced ON public.sync_queue(synced);
CREATE INDEX IF NOT EXISTS idx_sync_queue_timestamp ON public.sync_queue(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_sync_queue_entity ON public.sync_queue(entity_type, entity_id);

-- ============================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mapping_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_queue ENABLE ROW LEVEL SECURITY;

-- ============================================
-- PROFILES POLICIES
-- ============================================

-- Users can view their own profile
CREATE POLICY "Users can view own profile"
  ON public.profiles
  FOR SELECT
  USING (auth.uid() = id);

-- Users can update their own profile
CREATE POLICY "Users can update own profile"
  ON public.profiles
  FOR UPDATE
  USING (auth.uid() = id);

-- Admins can view all profiles
CREATE POLICY "Admins can view all profiles"
  ON public.profiles
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- ============================================
-- PROJECTS POLICIES
-- ============================================

-- Users can view projects they own
CREATE POLICY "Users can view own projects"
  ON public.projects
  FOR SELECT
  USING (owner_id = auth.uid());

-- Users can view projects they have access to
CREATE POLICY "Users can view accessible projects"
  ON public.projects
  FOR SELECT
  USING (
    accessible_users @> jsonb_build_array(auth.uid()::text)
  );

-- Admins can view all projects
CREATE POLICY "Admins can view all projects"
  ON public.projects
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Users can create their own projects
CREATE POLICY "Users can create projects"
  ON public.projects
  FOR INSERT
  WITH CHECK (owner_id = auth.uid());

-- Users can update projects they own
CREATE POLICY "Users can update own projects"
  ON public.projects
  FOR UPDATE
  USING (owner_id = auth.uid());

-- Users can delete projects they own
CREATE POLICY "Users can delete own projects"
  ON public.projects
  FOR DELETE
  USING (owner_id = auth.uid());

-- ============================================
-- MAPPING ENTRIES POLICIES
-- ============================================

-- Users can view mapping entries for accessible projects
CREATE POLICY "Users can view mapping entries for accessible projects"
  ON public.mapping_entries
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE id = mapping_entries.project_id
      AND (
        owner_id = auth.uid()
        OR accessible_users @> jsonb_build_array(auth.uid()::text)
      )
    )
  );

-- Admins can view all mapping entries
CREATE POLICY "Admins can view all mapping entries"
  ON public.mapping_entries
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Users can create mapping entries for accessible projects
CREATE POLICY "Users can create mapping entries"
  ON public.mapping_entries
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE id = mapping_entries.project_id
      AND (
        owner_id = auth.uid()
        OR accessible_users @> jsonb_build_array(auth.uid()::text)
      )
    )
    AND created_by = auth.uid()
  );

-- Users can update mapping entries for accessible projects
CREATE POLICY "Users can update mapping entries"
  ON public.mapping_entries
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE id = mapping_entries.project_id
      AND (
        owner_id = auth.uid()
        OR accessible_users @> jsonb_build_array(auth.uid()::text)
      )
    )
  );

-- Users can delete mapping entries they created
CREATE POLICY "Users can delete own mapping entries"
  ON public.mapping_entries
  FOR DELETE
  USING (created_by = auth.uid());

-- ============================================
-- PHOTOS POLICIES
-- ============================================

-- Users can view photos for accessible mapping entries
CREATE POLICY "Users can view photos for accessible entries"
  ON public.photos
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.mapping_entries me
      JOIN public.projects p ON p.id = me.project_id
      WHERE me.id = photos.mapping_entry_id
      AND (
        p.owner_id = auth.uid()
        OR p.accessible_users @> jsonb_build_array(auth.uid()::text)
      )
    )
  );

-- Admins can view all photos
CREATE POLICY "Admins can view all photos"
  ON public.photos
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Users can create photos for accessible mapping entries
CREATE POLICY "Users can create photos"
  ON public.photos
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.mapping_entries me
      JOIN public.projects p ON p.id = me.project_id
      WHERE me.id = photos.mapping_entry_id
      AND (
        p.owner_id = auth.uid()
        OR p.accessible_users @> jsonb_build_array(auth.uid()::text)
      )
    )
  );

-- Users can update photos for accessible mapping entries
CREATE POLICY "Users can update photos"
  ON public.photos
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.mapping_entries me
      JOIN public.projects p ON p.id = me.project_id
      WHERE me.id = photos.mapping_entry_id
      AND (
        p.owner_id = auth.uid()
        OR p.accessible_users @> jsonb_build_array(auth.uid()::text)
      )
    )
  );

-- Users can delete photos for accessible mapping entries
CREATE POLICY "Users can delete photos"
  ON public.photos
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.mapping_entries me
      JOIN public.projects p ON p.id = me.project_id
      WHERE me.id = photos.mapping_entry_id
      AND (
        p.owner_id = auth.uid()
        OR p.accessible_users @> jsonb_build_array(auth.uid()::text)
      )
    )
  );

-- ============================================
-- SYNC QUEUE POLICIES
-- ============================================

-- Users can view their own sync queue
CREATE POLICY "Users can view own sync queue"
  ON public.sync_queue
  FOR SELECT
  USING (user_id = auth.uid());

-- Users can create their own sync queue items
CREATE POLICY "Users can create sync queue items"
  ON public.sync_queue
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Users can update their own sync queue items
CREATE POLICY "Users can update own sync queue items"
  ON public.sync_queue
  FOR UPDATE
  USING (user_id = auth.uid());

-- Users can delete their own sync queue items
CREATE POLICY "Users can delete own sync queue items"
  ON public.sync_queue
  FOR DELETE
  USING (user_id = auth.uid());

-- ============================================
-- FUNCTIONS
-- ============================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for updated_at
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_mapping_entries_updated_at BEFORE UPDATE ON public.mapping_entries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_photos_updated_at BEFORE UPDATE ON public.photos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to automatically create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  user_username TEXT;
BEGIN
  -- Extract username from raw_user_meta_data, fallback to email username
  user_username := COALESCE(
    NEW.raw_user_meta_data->>'username',
    split_part(NEW.email, '@', 1)
  );

  -- Ensure username meets requirements
  IF char_length(user_username) < 3 THEN
    user_username := split_part(NEW.email, '@', 1);
  END IF;

  INSERT INTO public.profiles (id, email, username, role)
  VALUES (NEW.id, NEW.email, user_username, 'user');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to create profile on auth.users insert
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================
-- STORAGE BUCKET POLICIES
-- ============================================
-- NOTE: Run these in Supabase Dashboard > Storage > photos bucket > Policies
-- Or use the Supabase Storage API

-- Create the photos bucket first (do this in Supabase Dashboard or via SQL):
-- INSERT INTO storage.buckets (id, name, public) VALUES ('photos', 'photos', false);

-- Policy: Users can upload photos to their own folders
-- CREATE POLICY "Users can upload photos"
--   ON storage.objects
--   FOR INSERT
--   WITH CHECK (
--     bucket_id = 'photos'
--     AND auth.uid()::text = (storage.foldername(name))[1]
--   );

-- Policy: Users can view photos they have access to
-- CREATE POLICY "Users can view accessible photos"
--   ON storage.objects
--   FOR SELECT
--   USING (
--     bucket_id = 'photos'
--     AND (
--       auth.uid()::text = (storage.foldername(name))[1]
--       OR EXISTS (
--         SELECT 1 FROM public.profiles
--         WHERE id = auth.uid() AND role = 'admin'
--       )
--     )
--   );

-- Policy: Users can delete their own photos
-- CREATE POLICY "Users can delete own photos"
--   ON storage.objects
--   FOR DELETE
--   USING (
--     bucket_id = 'photos'
--     AND auth.uid()::text = (storage.foldername(name))[1]
--   );

-- ============================================
-- SAMPLE DATA (Optional - for testing)
-- ============================================

-- Create a test admin user profile (after user signs up via Supabase Auth)
-- UPDATE public.profiles SET role = 'admin' WHERE email = 'admin@example.com';

-- ============================================
-- END OF SCHEMA
-- ============================================

-- Verify tables were created
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;

-- Verify RLS is enabled
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
