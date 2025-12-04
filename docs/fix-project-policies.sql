-- ============================================
-- FIX: Project RLS Policies for Shared Projects
-- ============================================
-- This script fixes the policies to allow:
-- 1. Shared users to update/delete projects
-- 2. Admins to update/delete all projects
-- ============================================

-- Drop existing UPDATE and DELETE policies for projects
DROP POLICY IF EXISTS "Users can update own projects" ON public.projects;
DROP POLICY IF EXISTS "Users can update accessible projects" ON public.projects;
DROP POLICY IF EXISTS "Admins can update all projects" ON public.projects;
DROP POLICY IF EXISTS "Users can delete own projects" ON public.projects;
DROP POLICY IF EXISTS "Users can delete accessible projects" ON public.projects;
DROP POLICY IF EXISTS "Admins can delete all projects" ON public.projects;

-- ============================================
-- UPDATE POLICIES
-- ============================================

-- Users can update projects they own
CREATE POLICY "Users can update own projects"
  ON public.projects
  FOR UPDATE
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- Users can update projects they have access to
CREATE POLICY "Users can update accessible projects"
  ON public.projects
  FOR UPDATE
  USING (
    accessible_users @> jsonb_build_array(auth.uid()::text)
  )
  WITH CHECK (
    accessible_users @> jsonb_build_array(auth.uid()::text)
  );

-- Admins can update all projects (no restrictions on new values)
CREATE POLICY "Admins can update all projects"
  ON public.projects
  FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (true);

-- ============================================
-- DELETE POLICIES
-- ============================================

-- Users can delete projects they own
CREATE POLICY "Users can delete own projects"
  ON public.projects
  FOR DELETE
  USING (owner_id = auth.uid());

-- Users can delete projects they have access to
CREATE POLICY "Users can delete accessible projects"
  ON public.projects
  FOR DELETE
  USING (
    accessible_users @> jsonb_build_array(auth.uid()::text)
  );

-- Admins can delete all projects
CREATE POLICY "Admins can delete all projects"
  ON public.projects
  FOR DELETE
  USING (public.is_admin());

-- ============================================
-- Verify the policies were created
-- ============================================
SELECT
  schemaname,
  tablename,
  policyname,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'projects'
  AND cmd IN ('UPDATE', 'DELETE')
ORDER BY cmd, policyname;
