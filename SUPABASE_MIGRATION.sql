-- ========================================
-- MIGRAZIONE URGENTE PER SUPABASE
-- ========================================
-- Questa migrazione aggiunge il campo sync_enabled alla tabella projects
--
-- ISTRUZIONI:
-- 1. Vai su https://supabase.com/dashboard
-- 2. Seleziona il tuo progetto
-- 3. Vai su "SQL Editor" nel menu laterale
-- 4. Copia e incolla TUTTO questo codice SQL
-- 5. Clicca "Run" per eseguire
-- ========================================

-- Add sync_enabled column to projects table
ALTER TABLE projects
ADD COLUMN IF NOT EXISTS sync_enabled INTEGER DEFAULT 0 NOT NULL;

-- Create index for efficient filtering
CREATE INDEX IF NOT EXISTS idx_projects_sync_enabled ON projects(sync_enabled);

-- Add comment to document the column
COMMENT ON COLUMN projects.sync_enabled IS 'Controls sync behavior: 0 = metadata only, 1 = full sync with mappings and photos';

-- Update all existing projects to have sync_enabled = 0
UPDATE projects SET sync_enabled = 0 WHERE sync_enabled IS NULL;

-- Verify the migration worked
SELECT
  column_name,
  data_type,
  column_default,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'projects'
  AND column_name = 'sync_enabled';

-- Show sample data
SELECT id, title, sync_enabled, created_at
FROM projects
ORDER BY created_at DESC
LIMIT 5;
