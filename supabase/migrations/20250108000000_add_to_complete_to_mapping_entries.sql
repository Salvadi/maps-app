-- ============================================
-- Add to_complete column to mapping_entries
-- ============================================
-- Migration to add support for marking mapping entries as "Da Completare" (To Complete)
-- This allows users to flag interventions that still need to be completed
-- ============================================

-- Add to_complete column to mapping_entries table
ALTER TABLE public.mapping_entries
ADD COLUMN IF NOT EXISTS to_complete BOOLEAN DEFAULT false;

-- Create index for efficient filtering of incomplete entries
CREATE INDEX IF NOT EXISTS idx_mapping_entries_to_complete
ON public.mapping_entries(to_complete)
WHERE to_complete = true;

-- Add comment for documentation
COMMENT ON COLUMN public.mapping_entries.to_complete IS 'Flag to indicate if this mapping entry still needs to be completed';
