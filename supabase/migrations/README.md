# Supabase Migrations

This directory contains database migrations for the OPImaPPA application.

## How to Apply Migrations

### Option 1: Using Supabase Dashboard (Recommended)

1. Go to your Supabase Dashboard: https://supabase.com/dashboard
2. Select your project
3. Navigate to **SQL Editor** in the left sidebar
4. Copy the contents of the migration file (in chronological order)
5. Paste into the SQL Editor
6. Click **Run** to execute the migration

### Option 2: Using Supabase CLI

If you have the Supabase CLI installed:

```bash
# Apply all pending migrations
supabase db push

# Or apply a specific migration
supabase db execute --file supabase/migrations/YYYYMMDDHHMMSS_description.sql
```

## Migration Files

### 20250101000000_add_sync_enabled_to_projects.sql

**Status**: ⚠️ DEPRECATED (syncEnabled is now local-only)

**Purpose**: Originally added `sync_enabled` column for selective synchronization.

**Current Behavior**:
- The app now stores `syncEnabled` only in IndexedDB (local per-device)
- This migration can be skipped or the column can be removed if already applied
- See root `IMPORTANTE_LEGGI.md` for details (if still present)

**Impact**: No impact - field is ignored by current app version

---

### 20250104000001_update_projects_rls_policies.sql

**Status**: ✅ Ready to apply

**Purpose**: Updates Row Level Security (RLS) policies for the `projects` table.

**What it does**:
- Consolidates SELECT policies for better performance
- Adds admin-specific INSERT, UPDATE, DELETE policies
- **BREAKING**: Removes DELETE permission for shared users (only owner/admin can delete)
- Improves security and access control

**Prerequisites**:
- Read [/docs/RLS_POLICIES_ANALYSIS.md](../../docs/RLS_POLICIES_ANALYSIS.md) first
- Review [/docs/ACTION_ITEMS_RLS_POLICIES.md](../../docs/ACTION_ITEMS_RLS_POLICIES.md)
- Create database backup before applying

**Impact**:
- ⚠️ Shared users can no longer delete projects (security improvement)
- Better performance for SELECT queries
- Clearer admin permissions

---

### 20250104000002_add_projects_conflict_resolution.sql

**Status**: ✅ Ready to apply

**Purpose**: Adds conflict resolution fields to the `projects` table for multi-device sync.

**What it does**:
- Adds `version INTEGER DEFAULT 1` column
- Adds `last_modified BIGINT` column (timestamp in milliseconds)
- Creates indexes for performance
- Creates trigger to auto-update `last_modified` on UPDATE
- Initializes existing projects with default values

**Prerequisites**:
- Read [/docs/CONFLICT_RESOLUTION.md](../../docs/CONFLICT_RESOLUTION.md)
- Understand conflict resolution strategies (last-modified-wins, merge, etc.)

**Impact**:
- Enables automatic conflict resolution for project updates
- Prevents data loss in multi-device scenarios
- Backward compatible - existing projects get default values

## Migration Order

Apply migrations in this order:

1. ~~`20250101000000_add_sync_enabled_to_projects.sql`~~ (Skip - deprecated)
2. `20250104000001_update_projects_rls_policies.sql`
3. `20250104000002_add_projects_conflict_resolution.sql`

## Verification

After applying migrations, verify with:

```sql
-- Check projects table structure
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'projects'
ORDER BY ordinal_position;

-- Check RLS policies
SELECT policyname, cmd, qual
FROM pg_policies
WHERE tablename = 'projects'
ORDER BY policyname;

-- Check triggers
SELECT trigger_name, event_manipulation, event_object_table
FROM information_schema.triggers
WHERE event_object_table = 'projects';

-- Test with sample data
SELECT id, title, version, last_modified FROM projects LIMIT 5;
```

## Rollback Instructions

### For 20250104000001 (RLS Policies)

```sql
-- Drop new policies
DROP POLICY IF EXISTS "Users can view own and shared projects" ON projects;
DROP POLICY IF EXISTS "Admins can view all projects" ON projects;
DROP POLICY IF EXISTS "Users can create own projects" ON projects;
DROP POLICY IF EXISTS "Admins can create projects for any user" ON projects;
-- ... (continue for all policies)

-- Re-create old policies (backup required)
```

### For 20250104000002 (Conflict Resolution)

```sql
-- Remove trigger
DROP TRIGGER IF EXISTS update_projects_last_modified ON projects;

-- Remove columns
ALTER TABLE projects DROP COLUMN IF EXISTS version;
ALTER TABLE projects DROP COLUMN IF EXISTS last_modified;

-- Remove indexes
DROP INDEX IF EXISTS idx_projects_version;
DROP INDEX IF EXISTS idx_projects_last_modified;
```

## Best Practices

1. **Always backup** before applying migrations
2. **Test in staging** environment first
3. **Read documentation** linked in each migration
4. **Apply in order** - never skip migrations
5. **Verify** after each migration
6. **Keep rollback plan** ready

## Documentation

For detailed setup instructions, see:
- [/docs/SUPABASE_SETUP.md](../../docs/SUPABASE_SETUP.md)
- [/docs/CONFLICT_RESOLUTION.md](../../docs/CONFLICT_RESOLUTION.md)
- [/docs/RLS_POLICIES_ANALYSIS.md](../../docs/RLS_POLICIES_ANALYSIS.md)

---

**Last Updated**: 2025-12-30
