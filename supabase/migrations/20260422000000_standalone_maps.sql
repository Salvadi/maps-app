-- Create standalone_maps table for multi-device sync
CREATE TABLE IF NOT EXISTS public.standalone_maps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  thumbnail_url TEXT,
  original_filename TEXT NOT NULL DEFAULT '',
  width INTEGER NOT NULL DEFAULT 0,
  height INTEGER NOT NULL DEFAULT 0,
  points JSONB NOT NULL DEFAULT '[]',
  grid_enabled BOOLEAN NOT NULL DEFAULT false,
  grid_config JSONB NOT NULL DEFAULT '{"rows":10,"cols":10,"offsetX":0,"offsetY":0}',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_standalone_maps_user ON public.standalone_maps(user_id);
CREATE INDEX IF NOT EXISTS idx_standalone_maps_updated ON public.standalone_maps(updated_at DESC);

ALTER TABLE public.standalone_maps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own standalone maps"
  ON public.standalone_maps FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own standalone maps"
  ON public.standalone_maps FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own standalone maps"
  ON public.standalone_maps FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own standalone maps"
  ON public.standalone_maps FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all standalone maps"
  ON public.standalone_maps FOR SELECT
  USING (public.is_admin());

CREATE POLICY "Admins can insert all standalone maps"
  ON public.standalone_maps FOR INSERT
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins can update all standalone maps"
  ON public.standalone_maps FOR UPDATE
  USING (public.is_admin());

CREATE POLICY "Admins can delete all standalone maps"
  ON public.standalone_maps FOR DELETE
  USING (public.is_admin());
