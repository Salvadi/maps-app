-- Add sync_enabled column to projects table
-- This column controls whether projects sync full data (mappings + photos) or just metadata

-- Add the column with default value 0 (metadata-only sync)
ALTER TABLE projects
ADD COLUMN IF NOT EXISTS sync_enabled INTEGER DEFAULT 0 NOT NULL;

-- Create index for efficient filtering of sync-enabled projects
CREATE INDEX IF NOT EXISTS idx_projects_sync_enabled ON projects(sync_enabled);

-- Add comment to document the column
COMMENT ON COLUMN projects.sync_enabled IS 'Controls sync behavior: 0 = metadata only, 1 = full sync with mappings and photos';

-- Update all existing projects to have sync_enabled = 0 (default to lightweight sync)
UPDATE projects SET sync_enabled = 0 WHERE sync_enabled IS NULL;
