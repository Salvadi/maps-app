-- ============================================
-- OPImaPPA Supabase Storage Bucket Policies
-- ============================================
-- Run these commands in Supabase SQL Editor
-- to enable photo uploads with proper RLS
-- ============================================

-- First, ensure the 'photos' bucket exists
-- If it doesn't exist, create it (set public=false for security)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'photos',
  'photos',
  false,  -- Not public - requires authentication
  10485760,  -- 10MB limit per file
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- STORAGE OBJECT POLICIES
-- ============================================

-- Policy 1: Users can upload photos to mapping entries they have access to
-- File path format: {mappingEntryId}/{photoId}.jpg
CREATE POLICY "Users can upload photos to accessible mapping entries"
  ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'photos'
    AND auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.mapping_entries me
      JOIN public.projects p ON p.id = me.project_id
      WHERE me.id::text = (storage.foldername(name))[1]
      AND (
        p.owner_id = auth.uid()
        OR p.accessible_users @> jsonb_build_array(auth.uid()::text)
      )
    )
  );

-- Policy 2: Users can view photos from mapping entries they have access to
CREATE POLICY "Users can view photos from accessible mapping entries"
  ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'photos'
    AND (
      auth.uid() IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.mapping_entries me
        JOIN public.projects p ON p.id = me.project_id
        WHERE me.id::text = (storage.foldername(name))[1]
        AND (
          p.owner_id = auth.uid()
          OR p.accessible_users @> jsonb_build_array(auth.uid()::text)
        )
      )
      OR EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role = 'admin'
      )
    )
  );

-- Policy 3: Users can update photos in mapping entries they have access to
CREATE POLICY "Users can update photos in accessible mapping entries"
  ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'photos'
    AND auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.mapping_entries me
      JOIN public.projects p ON p.id = me.project_id
      WHERE me.id::text = (storage.foldername(name))[1]
      AND (
        p.owner_id = auth.uid()
        OR p.accessible_users @> jsonb_build_array(auth.uid()::text)
      )
    )
  );

-- Policy 4: Users can delete photos from mapping entries they have access to
CREATE POLICY "Users can delete photos from accessible mapping entries"
  ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'photos'
    AND auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.mapping_entries me
      JOIN public.projects p ON p.id = me.project_id
      WHERE me.id::text = (storage.foldername(name))[1]
      AND (
        p.owner_id = auth.uid()
        OR p.accessible_users @> jsonb_build_array(auth.uid()::text)
      )
    )
  );

-- ============================================
-- VERIFICATION
-- ============================================

-- Check if policies were created successfully
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual
FROM pg_policies
WHERE schemaname = 'storage'
  AND tablename = 'objects'
ORDER BY policyname;

-- ============================================
-- NOTES
-- ============================================
--
-- File path structure: {mappingEntryId}/{photoId}.jpg
-- Example: a19a9109-9701-4b7a-96d1-5087cf56ec30/df4ac2ce-52d1-466c-8a38-23ece4e8ebcc.jpg
--
-- These policies ensure that:
-- 1. Only authenticated users can access the bucket
-- 2. Users can only upload/view/update/delete photos for mapping entries
--    that belong to projects they own or have access to
-- 3. Admins can view all photos
-- 4. File types are restricted to images only
-- 5. File size is limited to 10MB per file
--
-- ============================================
