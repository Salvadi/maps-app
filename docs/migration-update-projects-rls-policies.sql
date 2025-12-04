-- ============================================
-- Migration: Update Projects RLS Policies
-- ============================================
-- Date: 2025-12-04
-- Description: Updates RLS policies for projects table
--              - Consolidates SELECT policies into one
--              - Adds admin INSERT, UPDATE, DELETE policies
--              - Removes DELETE policy for accessible users
-- IMPORTANT: Review RLS_POLICIES_ANALYSIS.md before applying!
-- ============================================

-- ============================================
-- BACKUP EXISTING POLICIES (for reference)
-- ============================================
-- To view existing policies, run:
-- SELECT policyname, cmd, qual, with_check
-- FROM pg_policies
-- WHERE schemaname = 'public' AND tablename = 'projects';

-- ============================================
-- DROP OLD POLICIES
-- ============================================

-- Drop old SELECT policies (will be replaced with consolidated one)
DROP POLICY IF EXISTS "Users can view own projects" ON public.projects;
DROP POLICY IF EXISTS "Users can view accessible projects" ON public.projects;
DROP POLICY IF EXISTS "Admins can view all projects" ON public.projects;

-- Drop old INSERT policy (will be replaced with two policies)
DROP POLICY IF EXISTS "Users can create projects" ON public.projects;

-- Drop old UPDATE policies (will be replaced with updated versions)
DROP POLICY IF EXISTS "Users can update own projects" ON public.projects;
DROP POLICY IF EXISTS "Users can update accessible projects" ON public.projects;

-- Drop old DELETE policies
DROP POLICY IF EXISTS "Users can delete own projects" ON public.projects;
DROP POLICY IF EXISTS "Users can delete accessible projects" ON public.projects;

-- ============================================
-- CREATE NEW POLICIES
-- ============================================

-- ================================
-- SELECT (Consolidated)
-- ================================
-- Allows users to view projects they own, have access to, or if they're admin
CREATE POLICY "Projects select"
ON public.projects
FOR SELECT
USING (
  owner_id = auth.uid()
  OR accessible_users @> jsonb_build_array(auth.uid()::text)
  OR public.is_admin()
);

-- ================================
-- INSERT
-- ================================
-- Users can create projects they own
CREATE POLICY "Users insert own projects"
ON public.projects
FOR INSERT
WITH CHECK (
  owner_id = auth.uid()
);

-- Admins can create projects
-- NOTE: This allows admins to create projects with any owner_id
-- Ensure your application validates this appropriately!
CREATE POLICY "Admins insert projects"
ON public.projects
FOR INSERT
WITH CHECK (
  public.is_admin()
);

-- ================================
-- UPDATE
-- ================================
-- Users can update projects they own
-- WITH CHECK ensures owner_id cannot be changed by regular users
CREATE POLICY "Users update own projects"
ON public.projects
FOR UPDATE
USING (
  owner_id = auth.uid()
)
WITH CHECK (
  owner_id = auth.uid()
);

-- Users can update projects they have access to
-- WITH CHECK ensures user remains in accessible_users list
-- NOTE: This prevents users from removing themselves from shared projects
CREATE POLICY "Users update accessible projects"
ON public.projects
FOR UPDATE
USING (
  accessible_users @> jsonb_build_array(auth.uid()::text)
)
WITH CHECK (
  accessible_users @> jsonb_build_array(auth.uid()::text)
);

-- Admins can update all projects
-- WITH CHECK (true) allows admins to change any field, including owner_id
-- CAUTION: Use admin privileges carefully!
CREATE POLICY "Admins update all projects"
ON public.projects
FOR UPDATE
USING (
  public.is_admin()
)
WITH CHECK (true);

-- ================================
-- DELETE
-- ================================
-- Users can delete projects they own
CREATE POLICY "Users delete own projects"
ON public.projects
FOR DELETE
USING (
  owner_id = auth.uid()
);

-- Admins can delete any project
CREATE POLICY "Admins delete all projects"
ON public.projects
FOR DELETE
USING (
  public.is_admin()
);

-- ============================================
-- IMPORTANT NOTES
-- ============================================
--
-- 1. BREAKING CHANGE: Users with shared access can no longer DELETE projects
--    - Previous policy "Users can delete accessible projects" was removed
--    - Only owners and admins can delete projects now
--    - If this is not intended, add back the policy:
--
--    CREATE POLICY "Users delete accessible projects"
--    ON public.projects
--    FOR DELETE
--    USING (
--      accessible_users @> jsonb_build_array(auth.uid()::text)
--    );
--
-- 2. Users cannot remove themselves from accessible_users
--    - The WITH CHECK in "Users update accessible projects" prevents this
--    - If you want to allow users to leave shared projects, modify the policy
--
-- 3. Admins have full control
--    - Can create projects for other users
--    - Can change owner_id
--    - Can delete any project
--    - Ensure your application UI validates admin actions appropriately
--
-- 4. No conflict resolution for concurrent edits
--    - See RLS_POLICIES_ANALYSIS.md for details
--    - Consider implementing version/last_modified fields
--
-- ============================================

-- Verify policies were created successfully
SELECT policyname, cmd, qual IS NOT NULL as has_using, with_check IS NOT NULL as has_with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'projects'
ORDER BY cmd, policyname;

-- Expected output:
-- policyname                      | cmd    | has_using | has_with_check
-- --------------------------------|--------|-----------|---------------
-- Projects select                 | SELECT | true      | false
-- Users insert own projects       | INSERT | false     | true
-- Admins insert projects          | INSERT | false     | true
-- Users update own projects       | UPDATE | true      | true
-- Users update accessible projects| UPDATE | true      | true
-- Admins update all projects      | UPDATE | true      | true
-- Users delete own projects       | DELETE | true      | false
-- Admins delete all projects      | DELETE | true      | false
