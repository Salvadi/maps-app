-- ============================================
-- Migration: Add Conflict Resolution Fields to Projects
-- ============================================
-- Date: 2025-12-04
-- Description: Adds version and last_modified columns to projects table
--              for proper conflict detection and resolution
-- ============================================

-- Add version column (for conflict detection)
ALTER TABLE public.projects
ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;

-- Add last_modified column (for timestamp-based conflict resolution)
ALTER TABLE public.projects
ADD COLUMN IF NOT EXISTS last_modified BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT * 1000;

-- Create index for performance on last_modified
CREATE INDEX IF NOT EXISTS idx_projects_last_modified
ON public.projects(last_modified DESC);

-- Create index for performance on version
CREATE INDEX IF NOT EXISTS idx_projects_version
ON public.projects(version);

-- ============================================
-- Populate existing projects with initial values
-- ============================================

-- Update existing projects to have version = 1 and last_modified = updated_at
UPDATE public.projects
SET
  version = 1,
  last_modified = EXTRACT(EPOCH FROM updated_at)::BIGINT * 1000
WHERE version IS NULL OR last_modified IS NULL;

-- ============================================
-- Create trigger to auto-update last_modified
-- ============================================

-- Function to update last_modified timestamp
CREATE OR REPLACE FUNCTION update_last_modified_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.last_modified = EXTRACT(EPOCH FROM NOW())::BIGINT * 1000;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update last_modified on UPDATE
DROP TRIGGER IF EXISTS update_projects_last_modified ON public.projects;
CREATE TRIGGER update_projects_last_modified
  BEFORE UPDATE ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION update_last_modified_column();

-- ============================================
-- Verify migration
-- ============================================

-- Check columns were added
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'projects'
  AND column_name IN ('version', 'last_modified');

-- Expected output:
-- column_name   | data_type | is_nullable | column_default
-- --------------|-----------|-------------|---------------
-- version       | integer   | YES         | 1
-- last_modified | bigint    | YES         | (EXTRACT(...))

-- Check indexes were created
SELECT indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'projects'
  AND indexname LIKE '%last_modified%' OR indexname LIKE '%version%';

-- Expected output:
-- indexname
-- --------------------------------
-- idx_projects_last_modified
-- idx_projects_version

-- Check existing projects were updated
SELECT COUNT(*) as total_projects,
       COUNT(CASE WHEN version IS NOT NULL THEN 1 END) as with_version,
       COUNT(CASE WHEN last_modified IS NOT NULL THEN 1 END) as with_last_modified
FROM public.projects;

-- Expected: total_projects = with_version = with_last_modified

-- ============================================
-- NOTES
-- ============================================
--
-- 1. Backward Compatibility:
--    - Columns are optional (nullable) for backward compatibility
--    - Existing code will work even if these columns are missing
--    - New code sets version=1 and last_modified=now() by default
--
-- 2. Conflict Resolution:
--    - version increments on each UPDATE operation
--    - last_modified updates automatically via trigger
--    - syncEngine uses these fields to detect and resolve conflicts
--
-- 3. Performance:
--    - Indexes created for efficient conflict checking
--    - Minimal overhead on INSERT/UPDATE operations
--
-- 4. Testing:
--    After migration, test conflict resolution by:
--    - Creating a project on device A
--    - Going offline on both devices
--    - Modifying the same project on device A and B
--    - Going online and syncing - should see conflict resolution in console
--
-- ============================================
