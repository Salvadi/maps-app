# Supabase Migrations

## How to Apply Migrations

### Option 1: Using Supabase Dashboard (Recommended)

1. Go to your Supabase Dashboard: https://supabase.com/dashboard
2. Select your project
3. Navigate to **SQL Editor** in the left sidebar
4. Copy the contents of the migration file
5. Paste into the SQL Editor
6. Click **Run** to execute the migration

### Option 2: Using Supabase CLI

If you have the Supabase CLI installed:

```bash
# Apply all pending migrations
supabase db push

# Or apply a specific migration
supabase db execute --file supabase/migrations/20250101000000_add_sync_enabled_to_projects.sql
```

## Migration Files

### 20250101000000_add_sync_enabled_to_projects.sql

**Purpose**: Adds the `sync_enabled` column to the `projects` table to support selective project synchronization.

**What it does**:
- Adds `sync_enabled INTEGER DEFAULT 0 NOT NULL` column
- Creates an index on `sync_enabled` for efficient filtering
- Sets all existing projects to `sync_enabled = 0` (metadata-only sync)

**Impact**:
- Enables users to choose which projects to fully sync (mappings + photos)
- Reduces initial app load by defaulting to metadata-only sync
- No breaking changes - all existing functionality continues to work

## Rollback

If you need to rollback this migration:

```sql
-- Remove the sync_enabled column
ALTER TABLE projects DROP COLUMN IF EXISTS sync_enabled;

-- Remove the index
DROP INDEX IF EXISTS idx_projects_sync_enabled;
```

## Verification

After applying the migration, verify it worked:

```sql
-- Check if column exists
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'projects' AND column_name = 'sync_enabled';

-- Check existing data
SELECT id, title, sync_enabled FROM projects LIMIT 5;
```
