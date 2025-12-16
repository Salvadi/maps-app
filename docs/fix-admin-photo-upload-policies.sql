-- ============================================
-- Fix Admin Photo Upload Policies
-- ============================================
-- Run these commands in Supabase SQL Editor
-- to allow admins to upload photos
-- ============================================

-- ============================================
-- PHOTOS TABLE POLICIES (Add INSERT for admins)
-- ============================================

-- Admins can insert photos (metadata) for any mapping entry
CREATE POLICY "Admins can create photos"
  ON public.photos
  FOR INSERT
  WITH CHECK (public.is_admin());

-- Admins can update photos (metadata) for any mapping entry
CREATE POLICY "Admins can update all photos"
  ON public.photos
  FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Admins can delete photos for any mapping entry
CREATE POLICY "Admins can delete all photos"
  ON public.photos
  FOR DELETE
  USING (public.is_admin());

-- ============================================
-- STORAGE BUCKET POLICIES (Add INSERT for admins)
-- ============================================

-- Admins can upload photos to any mapping entry folder
CREATE POLICY "Admins can upload photos to any mapping entry"
  ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'photos'
    AND auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Admins can update photos in any mapping entry folder
CREATE POLICY "Admins can update photos in any mapping entry"
  ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'photos'
    AND auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Admins can delete photos from any mapping entry folder
CREATE POLICY "Admins can delete photos from any mapping entry"
  ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'photos'
    AND auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- ============================================
-- VERIFICATION
-- ============================================

-- Check photos table policies
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'photos'
ORDER BY policyname;

-- Check storage object policies
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd
FROM pg_policies
WHERE schemaname = 'storage'
  AND tablename = 'objects'
  AND policyname LIKE '%Admin%'
ORDER BY policyname;

-- ============================================
-- NOTES
-- ============================================
--
-- These policies allow admins to:
-- 1. Create photo metadata records in the photos table
-- 2. Upload photo files to Supabase Storage
-- 3. Update and delete photos as needed
--
-- Without these policies, admins could only view photos
-- but couldn't upload new ones.
--
-- ============================================
