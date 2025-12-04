-- ============================================
-- DEBUG: Project Policies and accessible_users
-- ============================================
-- Run this to diagnose policy issues
-- ============================================

-- 1. Check current user info
SELECT
  auth.uid() as current_user_id,
  (SELECT role FROM public.profiles WHERE id = auth.uid()) as current_user_role,
  public.is_admin() as is_admin_check;

-- 2. Check all projects with their accessible_users format
SELECT
  id,
  title,
  owner_id,
  accessible_users,
  jsonb_typeof(accessible_users) as accessible_users_type,
  jsonb_array_length(accessible_users) as num_accessible_users
FROM public.projects
ORDER BY created_at DESC
LIMIT 10;

-- 3. Check which projects current user should have access to
SELECT
  p.id,
  p.title,
  p.owner_id,
  p.owner_id = auth.uid() as is_owner,
  p.accessible_users @> jsonb_build_array(auth.uid()::text) as is_accessible_user,
  public.is_admin() as is_admin,
  p.accessible_users
FROM public.projects p
ORDER BY p.created_at DESC
LIMIT 10;

-- 4. List all policies for projects table
SELECT
  schemaname,
  tablename,
  policyname,
  cmd,
  CASE
    WHEN cmd = 'SELECT' THEN 'SELECT'
    WHEN cmd = 'INSERT' THEN 'INSERT'
    WHEN cmd = 'UPDATE' THEN 'UPDATE'
    WHEN cmd = 'DELETE' THEN 'DELETE'
    WHEN cmd = '*' THEN 'ALL'
  END as command_type,
  permissive,
  roles,
  qual as using_clause,
  with_check as with_check_clause
FROM pg_policies
WHERE tablename = 'projects'
ORDER BY cmd, policyname;

-- 5. Test if a specific project would pass policy checks
-- Replace 'PROJECT-ID-HERE' with an actual project ID you want to test
/*
SELECT
  p.id,
  p.title,
  'Can SELECT' as check_type,
  (p.owner_id = auth.uid()
   OR p.accessible_users @> jsonb_build_array(auth.uid()::text)
   OR public.is_admin()) as would_pass
FROM public.projects p
WHERE p.id = 'PROJECT-ID-HERE'

UNION ALL

SELECT
  p.id,
  p.title,
  'Can UPDATE' as check_type,
  (p.owner_id = auth.uid()
   OR p.accessible_users @> jsonb_build_array(auth.uid()::text)
   OR public.is_admin()) as would_pass
FROM public.projects p
WHERE p.id = 'PROJECT-ID-HERE'

UNION ALL

SELECT
  p.id,
  p.title,
  'Can DELETE' as check_type,
  (p.owner_id = auth.uid()
   OR p.accessible_users @> jsonb_build_array(auth.uid()::text)
   OR public.is_admin()) as would_pass
FROM public.projects p
WHERE p.id = 'PROJECT-ID-HERE';
*/
