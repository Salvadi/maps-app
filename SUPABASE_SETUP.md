# Supabase Setup Guide

This guide will help you set up your Supabase project for the OPImaPPA application.

## Prerequisites

- A Supabase account (https://supabase.com)
- A Supabase project created
- Your project's credentials added to `.env.local`

## Step 1: Database Setup

1. Go to your Supabase Dashboard
2. Navigate to **SQL Editor**
3. Create a new query
4. Copy and paste the contents of `supabase-schema.sql`
5. Click **Run** to execute the SQL

This will create:
- All database tables (profiles, projects, mapping_entries, photos, sync_queue)
- Row Level Security policies
- Indexes for performance
- Triggers for automatic timestamps
- Auto-create user profiles on signup

## Step 2: Storage Bucket Setup

### 2.1 Create the Photos Bucket (Alternative to SQL)

If the bucket doesn't exist, you can create it via the UI:

1. Go to **Storage** in your Supabase Dashboard
2. Click **New Bucket**
3. Configure:
   - **Name**: `photos`
   - **Public**: ❌ Unchecked (private bucket)
   - **File size limit**: `10485760` (10MB)
   - **Allowed MIME types**: `image/jpeg, image/jpg, image/png, image/webp`
4. Click **Create Bucket**

### 2.2 Apply Storage Policies

1. Go to **SQL Editor**
2. Create a new query
3. Copy and paste the contents of `supabase-storage-policies.sql`
4. Click **Run** to execute the SQL

This will create policies that allow:
- Users to upload photos to mapping entries they have access to
- Users to view/update/delete photos from accessible mapping entries
- Admins to view all photos
- File type and size restrictions

## Step 3: Verify Setup

### 3.1 Check Database Tables

Run this query in SQL Editor:

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
```

You should see:
- `mapping_entries`
- `photos`
- `profiles`
- `projects`
- `sync_queue`

### 3.2 Check RLS is Enabled

Run this query:

```sql
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
```

All tables should have `rowsecurity = true`.

### 3.3 Check Storage Policies

Run this query:

```sql
SELECT policyname, cmd
FROM pg_policies
WHERE schemaname = 'storage'
  AND tablename = 'objects'
ORDER BY policyname;
```

You should see 4 policies:
- `Users can upload photos to accessible mapping entries` (INSERT)
- `Users can view photos from accessible mapping entries` (SELECT)
- `Users can update photos in accessible mapping entries` (UPDATE)
- `Users can delete photos from accessible mapping entries` (DELETE)

## Step 4: Create Your First User

1. Go to **Authentication** > **Users**
2. Click **Add User**
3. Enter email and password
4. Click **Create User**

A profile will be automatically created in the `profiles` table.

To make a user an admin:

```sql
UPDATE public.profiles
SET role = 'admin'
WHERE email = 'your-admin@example.com';
```

## Step 5: Test the App

1. Clear your browser's IndexedDB (to reset local data):
   - Open DevTools → Application → IndexedDB
   - Delete `MappingDatabase`

2. Reload the app

3. Log in with your Supabase user credentials

4. Create a project and add photos

5. Check the console - you should see:
   ```
   🔄 Processing X sync queue items as user [user-id]...
   ✅ Synced project CREATE: [project-id]
   ✅ Synced mapping_entry CREATE: [entry-id]
   ✅ Synced photo CREATE: [photo-id]
   ```

6. Verify in Supabase:
   - **Database** → Check tables for your data
   - **Storage** → Check `photos` bucket for uploaded images

## Troubleshooting

### Issue: "new row violates row-level security policy"

**Cause**: User is not authenticated or RLS policies are not set up correctly.

**Solution**:
1. Ensure you're logged in (check localStorage for `supabase.auth.token`)
2. Run the storage policies SQL again
3. Clear browser cache and reload

### Issue: "User not authenticated. Please log in to sync data."

**Cause**: No active Supabase session.

**Solution**:
1. Implement and use the login/signup UI
2. Make sure session persists in localStorage
3. Check that `REACT_APP_SUPABASE_URL` and `REACT_APP_SUPABASE_ANON_KEY` are set correctly

### Issue: Photos upload to storage but metadata insert fails

**Cause**: Database RLS policies blocking the insert.

**Solution**:
1. Verify the mapping entry exists in Supabase
2. Verify you have access to the project that owns the mapping entry
3. Check that `created_by` matches the authenticated user

### Issue: Storage bucket not found

**Cause**: The `photos` bucket doesn't exist.

**Solution**:
1. Go to Storage in Supabase Dashboard
2. Create the `photos` bucket manually
3. Or run the `INSERT INTO storage.buckets` command from `supabase-storage-policies.sql`

## Environment Variables

Make sure your `.env.local` file contains:

```env
REACT_APP_SUPABASE_URL=https://your-project.supabase.co
REACT_APP_SUPABASE_ANON_KEY=your-anon-key
```

Get these from: **Supabase Dashboard** → **Settings** → **API**

## Security Notes

- ✅ Row Level Security is enabled on all tables
- ✅ Storage bucket is private (requires authentication)
- ✅ File types are restricted to images only
- ✅ File size is limited to 10MB
- ✅ Users can only access their own data or shared projects
- ✅ Admins can view all data

## Next Steps

Once setup is complete:
1. Test creating projects, mapping entries, and uploading photos
2. Test sharing projects with other users
3. Verify sync works correctly
4. Set up automated backups in Supabase Dashboard

For more help, see the [Supabase Documentation](https://supabase.com/docs).
