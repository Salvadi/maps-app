-- ============================================
-- FLOOR PLANS MIGRATION
-- Adds floor plan support to the maps-app
-- ============================================

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- FLOOR PLANS TABLE
-- Stores floor plan images for each floor in a project
-- ============================================
CREATE TABLE IF NOT EXISTS public.floor_plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  floor TEXT NOT NULL,
  image_url TEXT NOT NULL, -- URL in Supabase Storage (full resolution 2x PNG)
  thumbnail_url TEXT, -- Optional thumbnail for quick previews (512px)
  original_filename TEXT NOT NULL,
  original_format TEXT NOT NULL, -- 'pdf', 'png', 'jpg', etc.
  width INTEGER NOT NULL, -- Image width in pixels
  height INTEGER NOT NULL, -- Image height in pixels
  metadata JSONB DEFAULT '{}'::jsonb, -- Additional metadata
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Ensure one floor plan per project-floor combination
  UNIQUE(project_id, floor)
);

-- ============================================
-- FLOOR PLAN POINTS TABLE
-- Stores points (markers) on floor plans linked to mapping entries
-- ============================================
CREATE TABLE IF NOT EXISTS public.floor_plan_points (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  floor_plan_id UUID NOT NULL REFERENCES public.floor_plans(id) ON DELETE CASCADE,
  mapping_entry_id UUID NOT NULL REFERENCES public.mapping_entries(id) ON DELETE CASCADE,
  
  -- Point type: 'parete', 'solaio', 'perimetro', 'generico'
  point_type TEXT NOT NULL CHECK (point_type IN ('parete', 'solaio', 'perimetro', 'generico')),
  
  -- Point position (normalized 0-1 coordinates)
  point_x FLOAT NOT NULL CHECK (point_x >= 0 AND point_x <= 1),
  point_y FLOAT NOT NULL CHECK (point_y >= 0 AND point_y <= 1),
  
  -- Label position (normalized 0-1 coordinates)
  label_x FLOAT NOT NULL CHECK (label_x >= 0 AND label_x <= 1),
  label_y FLOAT NOT NULL CHECK (label_y >= 0 AND label_y <= 1),
  
  -- For 'perimetro' type - array of additional points forming the perimeter
  perimeter_points JSONB DEFAULT '[]'::jsonb, -- Array of {x, y} coordinates
  
  -- For 'generico' type - custom text
  custom_text TEXT,
  
  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb,
  
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Ensure one point per mapping entry
  UNIQUE(mapping_entry_id)
);

-- ============================================
-- STANDALONE MAPS TABLE
-- For mappings not tied to a project
-- ============================================
CREATE TABLE IF NOT EXISTS public.standalone_maps (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  image_url TEXT NOT NULL, -- URL in Supabase Storage
  thumbnail_url TEXT, -- Optional thumbnail
  original_filename TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  
  -- Points data stored as JSONB array
  points JSONB DEFAULT '[]'::jsonb, -- Array of point objects
  
  -- Grid settings
  grid_enabled BOOLEAN DEFAULT false,
  grid_config JSONB DEFAULT '{}'::jsonb, -- Grid configuration
  
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- INDEXES
-- ============================================

-- Floor plans indexes
CREATE INDEX IF NOT EXISTS idx_floor_plans_project ON public.floor_plans(project_id);
CREATE INDEX IF NOT EXISTS idx_floor_plans_floor ON public.floor_plans(floor);
CREATE INDEX IF NOT EXISTS idx_floor_plans_created_by ON public.floor_plans(created_by);

-- Floor plan points indexes
CREATE INDEX IF NOT EXISTS idx_floor_plan_points_floor_plan ON public.floor_plan_points(floor_plan_id);
CREATE INDEX IF NOT EXISTS idx_floor_plan_points_mapping_entry ON public.floor_plan_points(mapping_entry_id);
CREATE INDEX IF NOT EXISTS idx_floor_plan_points_type ON public.floor_plan_points(point_type);

-- Standalone maps indexes
CREATE INDEX IF NOT EXISTS idx_standalone_maps_user ON public.standalone_maps(user_id);
CREATE INDEX IF NOT EXISTS idx_standalone_maps_created ON public.standalone_maps(created_at DESC);

-- ============================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================

-- Enable RLS on all tables
ALTER TABLE public.floor_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.floor_plan_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.standalone_maps ENABLE ROW LEVEL SECURITY;

-- ============================================
-- FLOOR PLANS POLICIES
-- ============================================

-- Users can view floor plans for projects they have access to
CREATE POLICY "Users can view floor plans for accessible projects"
  ON public.floor_plans
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = floor_plans.project_id
      AND (
        p.owner_id = auth.uid()
        OR p.accessible_users @> jsonb_build_array(auth.uid()::text)
      )
    )
  );

-- Admins can view all floor plans
CREATE POLICY "Admins can view all floor plans"
  ON public.floor_plans
  FOR SELECT
  USING (public.is_admin());

-- Users can create floor plans for their own projects
CREATE POLICY "Users can create floor plans for their projects"
  ON public.floor_plans
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = floor_plans.project_id
      AND p.owner_id = auth.uid()
    )
    AND created_by = auth.uid()
  );

-- Admins can create floor plans for any project
CREATE POLICY "Admins can create floor plans"
  ON public.floor_plans
  FOR INSERT
  WITH CHECK (public.is_admin());

-- Users can update floor plans for their projects
CREATE POLICY "Users can update floor plans for their projects"
  ON public.floor_plans
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = floor_plans.project_id
      AND p.owner_id = auth.uid()
    )
  );

-- Admins can update all floor plans
CREATE POLICY "Admins can update all floor plans"
  ON public.floor_plans
  FOR UPDATE
  USING (public.is_admin());

-- Users can delete floor plans for their projects
CREATE POLICY "Users can delete floor plans for their projects"
  ON public.floor_plans
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = floor_plans.project_id
      AND p.owner_id = auth.uid()
    )
  );

-- Admins can delete all floor plans
CREATE POLICY "Admins can delete all floor plans"
  ON public.floor_plans
  FOR DELETE
  USING (public.is_admin());

-- ============================================
-- FLOOR PLAN POINTS POLICIES
-- ============================================

-- Users can view points for floor plans they have access to
CREATE POLICY "Users can view points for accessible floor plans"
  ON public.floor_plan_points
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.floor_plans fp
      JOIN public.projects p ON p.id = fp.project_id
      WHERE fp.id = floor_plan_points.floor_plan_id
      AND (
        p.owner_id = auth.uid()
        OR p.accessible_users @> jsonb_build_array(auth.uid()::text)
      )
    )
  );

-- Admins can view all points
CREATE POLICY "Admins can view all points"
  ON public.floor_plan_points
  FOR SELECT
  USING (public.is_admin());

-- Users can create points for accessible floor plans
CREATE POLICY "Users can create points"
  ON public.floor_plan_points
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.floor_plans fp
      JOIN public.projects p ON p.id = fp.project_id
      WHERE fp.id = floor_plan_points.floor_plan_id
      AND (
        p.owner_id = auth.uid()
        OR p.accessible_users @> jsonb_build_array(auth.uid()::text)
      )
    )
    AND created_by = auth.uid()
  );

-- Admins can create points
CREATE POLICY "Admins can create points"
  ON public.floor_plan_points
  FOR INSERT
  WITH CHECK (public.is_admin());

-- Users can update points for accessible floor plans
CREATE POLICY "Users can update points"
  ON public.floor_plan_points
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.floor_plans fp
      JOIN public.projects p ON p.id = fp.project_id
      WHERE fp.id = floor_plan_points.floor_plan_id
      AND (
        p.owner_id = auth.uid()
        OR p.accessible_users @> jsonb_build_array(auth.uid()::text)
      )
    )
  );

-- Admins can update all points
CREATE POLICY "Admins can update all points"
  ON public.floor_plan_points
  FOR UPDATE
  USING (public.is_admin());

-- Users can delete points they created
CREATE POLICY "Users can delete own points"
  ON public.floor_plan_points
  FOR DELETE
  USING (created_by = auth.uid());

-- Admins can delete all points
CREATE POLICY "Admins can delete all points"
  ON public.floor_plan_points
  FOR DELETE
  USING (public.is_admin());

-- ============================================
-- STANDALONE MAPS POLICIES
-- ============================================

-- Users can view their own standalone maps
CREATE POLICY "Users can view own standalone maps"
  ON public.standalone_maps
  FOR SELECT
  USING (user_id = auth.uid());

-- Admins can view all standalone maps
CREATE POLICY "Admins can view all standalone maps"
  ON public.standalone_maps
  FOR SELECT
  USING (public.is_admin());

-- Users can create their own standalone maps
CREATE POLICY "Users can create standalone maps"
  ON public.standalone_maps
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Users can update their own standalone maps
CREATE POLICY "Users can update own standalone maps"
  ON public.standalone_maps
  FOR UPDATE
  USING (user_id = auth.uid());

-- Admins can update all standalone maps
CREATE POLICY "Admins can update all standalone maps"
  ON public.standalone_maps
  FOR UPDATE
  USING (public.is_admin());

-- Users can delete their own standalone maps
CREATE POLICY "Users can delete own standalone maps"
  ON public.standalone_maps
  FOR DELETE
  USING (user_id = auth.uid());

-- Admins can delete all standalone maps
CREATE POLICY "Admins can delete all standalone maps"
  ON public.standalone_maps
  FOR DELETE
  USING (public.is_admin());

-- ============================================
-- UPDATED_AT TRIGGERS
-- ============================================

-- Floor plans updated_at trigger
CREATE OR REPLACE FUNCTION update_floor_plans_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER floor_plans_updated_at
  BEFORE UPDATE ON public.floor_plans
  FOR EACH ROW
  EXECUTE FUNCTION update_floor_plans_updated_at();

-- Floor plan points updated_at trigger
CREATE OR REPLACE FUNCTION update_floor_plan_points_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER floor_plan_points_updated_at
  BEFORE UPDATE ON public.floor_plan_points
  FOR EACH ROW
  EXECUTE FUNCTION update_floor_plan_points_updated_at();

-- Standalone maps updated_at trigger
CREATE OR REPLACE FUNCTION update_standalone_maps_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER standalone_maps_updated_at
  BEFORE UPDATE ON public.standalone_maps
  FOR EACH ROW
  EXECUTE FUNCTION update_standalone_maps_updated_at();

-- ============================================
-- STORAGE BUCKET POLICIES (Run in Supabase Dashboard)
-- ============================================

-- Create the 'planimetrie' bucket (do this in Supabase Dashboard):
-- 1. Go to Storage
-- 2. Create new bucket named 'planimetrie'
-- 3. Set to private (public: false)

-- Then apply these policies via SQL or Dashboard:

-- Users can upload floor plans to their own folders
-- CREATE POLICY "Users can upload floor plans"
--   ON storage.objects
--   FOR INSERT
--   WITH CHECK (
--     bucket_id = 'planimetrie'
--     AND auth.uid() IS NOT NULL
--   );

-- Users can view floor plans for accessible projects
-- CREATE POLICY "Users can view floor plans"
--   ON storage.objects
--   FOR SELECT
--   USING (
--     bucket_id = 'planimetrie'
--     AND auth.uid() IS NOT NULL
--   );

-- Users can update floor plans they uploaded
-- CREATE POLICY "Users can update floor plans"
--   ON storage.objects
--   FOR UPDATE
--   USING (
--     bucket_id = 'planimetrie'
--     AND auth.uid() IS NOT NULL
--   );

-- Users can delete floor plans they uploaded
-- CREATE POLICY "Users can delete floor plans"
--   ON storage.objects
--   FOR DELETE
--   USING (
--     bucket_id = 'planimetrie'
--     AND auth.uid() IS NOT NULL
--   );

-- ============================================
-- VERIFICATION QUERIES
-- ============================================

-- Verify tables were created
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN ('floor_plans', 'floor_plan_points', 'standalone_maps')
ORDER BY table_name;

-- Verify RLS is enabled
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
AND tablename IN ('floor_plans', 'floor_plan_points', 'standalone_maps')
ORDER BY tablename;

-- Verify policies were created
SELECT schemaname, tablename, policyname
FROM pg_policies
WHERE tablename IN ('floor_plans', 'floor_plan_points', 'standalone_maps')
ORDER BY tablename, policyname;

-- ============================================
-- END OF MIGRATION
-- ============================================
