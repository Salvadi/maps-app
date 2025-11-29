# Supabase Setup Guide for OPImaPPA

## Step 1: Create Supabase Account & Project

1. **Go to [supabase.com](https://supabase.com)**
2. **Sign up** with GitHub (recommended) or email
3. **Create a new project**:
   - Organization: Choose or create one
   - Project Name: `opimappa`
   - Database Password: Generate a strong password (save it!)
   - Region: Choose closest to your users (e.g., Europe West for Italy)
   - Pricing Plan: **Free** (includes authentication, database, storage)

4. **Wait 2-3 minutes** for the project to provision

---

## Step 2: Get Your API Keys

1. In your Supabase project, go to **Settings** → **API**
2. Copy these values (we'll need them):

   ```
   Project URL: https://xxxxx.supabase.co
   anon public key: eyJhbGciOi...
   service_role key: eyJhbGciOi... (keep secret!)
   ```

3. **Save these securely** - we'll add them to the app

---

## Step 3: Set Up Database Schema

1. Go to **SQL Editor** in your Supabase dashboard
2. Click **New Query**
3. Copy and paste the SQL from `supabase-schema.sql`
4. Click **Run** to create all tables
5. Verify tables were created: **Database** → **Tables**

You should see:
- `profiles` - User profiles
- `projects` - Construction projects
- `mapping_entries` - Mapping data
- `photos` - Photo metadata
- `sync_queue` - Sync tracking

---

## Step 4: Enable Row Level Security (RLS)

The SQL script automatically enables RLS policies that:
- ✅ Users can only see their own projects
- ✅ Admin users can see all data
- ✅ Users can only edit data they own
- ✅ Photos are private to project members

---

## Step 5: Set Up Storage for Photos

1. Go to **Storage** in Supabase dashboard
2. Click **New Bucket**
3. Bucket name: `photos`
4. Settings:
   - **Public bucket**: No (private)
   - **Allowed MIME types**: image/jpeg, image/png, image/webp
   - **File size limit**: 5 MB
5. Click **Create bucket**

6. **Set up storage policies**:
   - Go to **Policies** tab in the `photos` bucket
   - Add policies from the SQL script (in Step 3)

---

## Step 6: Enable Authentication

1. Go to **Authentication** → **Providers**
2. Enable **Email** provider (already enabled by default)
3. Optional: Enable **Google**, **GitHub**, or other OAuth providers
4. Configure email templates:
   - **Authentication** → **Email Templates**
   - Customize confirmation and password reset emails

---

## Step 7: Configure Environment Variables

Add these to your local `.env.local` file:

```env
REACT_APP_SUPABASE_URL=https://xxxxx.supabase.co
REACT_APP_SUPABASE_ANON_KEY=eyJhbGciOi...
```

For Vercel deployment:
1. Go to **Vercel Dashboard** → Your Project → **Settings** → **Environment Variables**
2. Add:
   - `REACT_APP_SUPABASE_URL`: Your Project URL
   - `REACT_APP_SUPABASE_ANON_KEY`: Your anon public key
3. Redeploy

---

## What's Next?

After completing these steps, we'll:
1. ✅ Replace mock authentication with Supabase Auth
2. ✅ Implement sync queue processor
3. ✅ Add photo upload to Supabase Storage
4. ✅ Enable real-time sync
5. ✅ Test multi-device sync

---

## Free Tier Limits

Supabase Free Tier includes:
- ✅ 500 MB database space
- ✅ 1 GB file storage
- ✅ 50,000 monthly active users
- ✅ 2 GB bandwidth
- ✅ Unlimited API requests

**This is perfect for OPImaPPA!** You can store ~500 projects with ~5,000 photos.

---

## Security Notes

- ✅ **Never commit** API keys to git
- ✅ Use `.env.local` for local development
- ✅ Use Vercel Environment Variables for production
- ✅ Only use `anon` key in frontend (never `service_role`)
- ✅ RLS policies protect all data

---

## Troubleshooting

**Issue: Can't create project**
- Check email confirmation
- Try different region
- Wait a few minutes and refresh

**Issue: SQL script fails**
- Run queries one at a time
- Check for syntax errors
- Ensure you're in the correct project

**Issue: RLS blocking queries**
- Verify you're authenticated
- Check RLS policies in **Authentication** → **Policies**
- Use **SQL Editor** to test queries

---

Ready to proceed? Complete Steps 1-6 above, then let me know your:
- ✅ Supabase Project URL
- ✅ Anon public key

I'll help you integrate it into the app! 🚀
