-- ============================================
-- Migration: Add archived column to projects table
-- ============================================
-- This migration adds the archived field to the projects table
-- Run this on your existing Supabase database if you've already
-- deployed the schema without the archived column.
-- ============================================

-- Add archived column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'projects'
    AND column_name = 'archived'
  ) THEN
    ALTER TABLE public.projects
    ADD COLUMN archived BOOLEAN NOT NULL DEFAULT false;

    RAISE NOTICE 'Added archived column to projects table';
  ELSE
    RAISE NOTICE 'Column archived already exists in projects table';
  END IF;
END $$;

-- Create index for archived column if it doesn't exist
CREATE INDEX IF NOT EXISTS idx_projects_archived ON public.projects(archived);

-- Verify the column was added
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'projects'
  AND column_name = 'archived';
