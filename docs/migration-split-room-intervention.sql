-- ============================================
-- Migration: Split room_or_intervention into room and intervention
-- Date: 2025-12-04
-- Description: Converts the single room_or_intervention column into
--              separate room and intervention columns to support
--              projects that use both room and intervention numbering
-- ============================================

-- Step 1: Add new columns (nullable initially)
ALTER TABLE public.mapping_entries
ADD COLUMN IF NOT EXISTS room TEXT,
ADD COLUMN IF NOT EXISTS intervention TEXT;

-- Step 2: Migrate existing data
-- Copy room_or_intervention to room column if the project uses room numbering
-- Copy room_or_intervention to intervention column if the project uses intervention numbering
UPDATE public.mapping_entries me
SET
  room = CASE
    WHEN (SELECT use_room_numbering FROM public.projects WHERE id = me.project_id) = true
    THEN me.room_or_intervention
    ELSE NULL
  END,
  intervention = CASE
    WHEN (SELECT use_intervention_numbering FROM public.projects WHERE id = me.project_id) = true
    THEN me.room_or_intervention
    ELSE NULL
  END
WHERE room_or_intervention IS NOT NULL;

-- Step 3: Drop the old column (optional - uncomment when ready)
-- ALTER TABLE public.mapping_entries DROP COLUMN IF EXISTS room_or_intervention;

-- Step 4: Verify the migration
SELECT
  'Total entries' as description,
  COUNT(*) as count
FROM public.mapping_entries

UNION ALL

SELECT
  'Entries with room' as description,
  COUNT(*) as count
FROM public.mapping_entries
WHERE room IS NOT NULL

UNION ALL

SELECT
  'Entries with intervention' as description,
  COUNT(*) as count
FROM public.mapping_entries
WHERE intervention IS NOT NULL

UNION ALL

SELECT
  'Entries with both' as description,
  COUNT(*) as count
FROM public.mapping_entries
WHERE room IS NOT NULL AND intervention IS NOT NULL;

-- ============================================
-- IMPORTANT NOTES:
-- ============================================
-- 1. Before running this migration, make sure to backup your database
-- 2. The old room_or_intervention column is NOT dropped by default
--    to allow for rollback if needed
-- 3. Once you've verified the migration is successful, you can
--    uncomment Step 3 to drop the old column
-- 4. Projects that have both useRoomNumbering and useInterventionNumbering
--    enabled will need to create new mappings to populate both fields,
--    as the old data can only be migrated to one field
-- ============================================
