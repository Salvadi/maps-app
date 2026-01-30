-- ============================================
-- Script to mark mapping entries without photos as to_complete = true
-- ============================================
-- Run this in Supabase SQL Editor
-- This updates all mapping entries that have no photos
-- ============================================

-- First, let's see how many entries will be affected
SELECT
  COUNT(*) as entries_without_photos,
  COUNT(DISTINCT project_id) as affected_projects
FROM mapping_entries
WHERE
  (photos IS NULL OR photos = '[]'::jsonb)
  AND (to_complete IS NULL OR to_complete = false);

-- Now update those entries
UPDATE mapping_entries
SET
  to_complete = true,
  version = version + 1,
  updated_at = NOW()
WHERE
  (photos IS NULL OR photos = '[]'::jsonb)
  AND (to_complete IS NULL OR to_complete = false);

-- Show summary of what was updated
SELECT
  'Updated' as status,
  COUNT(*) as count,
  COUNT(DISTINCT project_id) as projects_affected
FROM mapping_entries
WHERE
  to_complete = true
  AND (photos IS NULL OR photos = '[]'::jsonb);

-- Optional: Show some examples of updated entries
SELECT
  id,
  floor,
  room,
  intervention,
  to_complete,
  updated_at
FROM mapping_entries
WHERE
  to_complete = true
  AND (photos IS NULL OR photos = '[]'::jsonb)
ORDER BY updated_at DESC
LIMIT 10;
