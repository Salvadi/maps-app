# Deployment Guide for OPImaPPA

## Quick Deploy to Vercel (Recommended)

### Option A: Using Vercel Website (Easiest - No CLI needed)

1. **Go to [https://vercel.com](https://vercel.com)**
   - Sign up/login with GitHub

2. **Import Your Repository**
   - Click "Add New Project"
   - Import your GitHub repository (Salvadi/maps-app)
   - Vercel will auto-detect it's a Create React App

3. **Configure Build Settings**
   - Build Command: `npm run build`
   - Output Directory: `build`
   - Install Command: `npm install --legacy-peer-deps`

4. **Add Environment Variable (Important)**
   - Add this in the Environment Variables section:
   - Name: `NPM_FLAGS`
   - Value: `--legacy-peer-deps`

5. **Deploy**
   - Click "Deploy"
   - Wait 2-3 minutes for build to complete
   - You'll get a URL like: `https://opimappa.vercel.app`

6. **Test on Your Smartphone**
   - Open the URL on your phone
   - Chrome will show "Add to Home Screen"
   - Install the PWA!

---

### Option B: Using Vercel CLI (For Command Line)

If you prefer using the terminal:

1. **Install Vercel CLI**
   ```bash
   npm install -g vercel
   ```

2. **Login to Vercel**
   ```bash
   vercel login
   ```

3. **Deploy**
   ```bash
   # Make sure you're in the project directory
   cd maps-app

   # Deploy to production
   vercel --prod
   ```

4. **Follow the prompts:**
   - Set up and deploy? **Yes**
   - Which scope? **Your username**
   - Link to existing project? **No**
   - Project name? **opimappa** (or press Enter)
   - Directory? **./** (press Enter)
   - Override settings? **Yes**
   - Build Command: `npm run build`
   - Output Directory: `build`
   - Development Command: `npm start`

5. **Wait for deployment**
   - You'll get a production URL
   - Example: `https://opimappa.vercel.app`

---

## Alternative: Deploy to Netlify

1. **Go to [https://netlify.com](https://netlify.com)**
   - Sign up/login with GitHub

2. **New Site from Git**
   - Click "Add new site" → "Import an existing project"
   - Connect to GitHub
   - Select your repository

3. **Build Settings**
   - Build command: `npm run build`
   - Publish directory: `build`
   - Add environment variable:
     - `NPM_FLAGS` = `--legacy-peer-deps`

4. **Deploy**
   - Click "Deploy site"
   - Wait for build to complete
   - Get URL like: `https://opimappa.netlify.app`

---

## Testing on Your Smartphone

### Android (Chrome)
1. Open the deployed URL on Chrome mobile
2. Chrome will show a banner: "Add OPImaPPA to Home Screen"
3. Tap "Add" or go to Menu → "Add to Home Screen"
4. The app icon appears on your home screen
5. Open it - works like a native app!

### iOS (Safari)
1. Open the deployed URL in Safari
2. Tap the "Share" button
3. Scroll and tap "Add to Home Screen"
4. Edit the name if needed, tap "Add"
5. The app appears on your home screen

---

## Verify PWA Features

After deploying, check:

1. **HTTPS** ✅ (Automatic on Vercel/Netlify)
2. **Service Worker**
   - Open DevTools on desktop
   - Application → Service Workers
   - Should show "activated"
3. **Installable**
   - Chrome shows install prompt
4. **Offline**
   - Load the app once
   - Turn off internet/enable airplane mode
   - Refresh - still works!

---

## Build Configuration for Vercel

Create a `vercel.json` file in the project root (optional):

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "build",
  "installCommand": "npm install --legacy-peer-deps",
  "framework": "create-react-app"
}
```

This ensures proper build configuration.

---

## Troubleshooting

### Build Fails on Vercel
- **Issue**: Dependencies not installing
- **Fix**: Add `NPM_FLAGS=--legacy-peer-deps` in Environment Variables

### PWA Not Installing
- **Issue**: App doesn't show "Add to Home Screen"
- **Fix**: Ensure you're on HTTPS (Vercel/Netlify automatic)

### Service Worker Not Registering
- **Issue**: Offline features don't work
- **Fix**: Clear cache, reload, check Console for errors

---

## Update Deployment

When you make changes:

1. **Push to Git**
   ```bash
   git add .
   git commit -m "Your changes"
   git push origin main
   ```

2. **Auto-Deploy**
   - Vercel/Netlify automatically redeploy on push
   - New version live in 2-3 minutes

---

## Your Deployment Checklist

- [ ] Create Vercel/Netlify account
- [ ] Import GitHub repository
- [ ] Configure build settings
- [ ] Add `NPM_FLAGS=--legacy-peer-deps` environment variable
- [ ] Deploy
- [ ] Get deployment URL
- [ ] Test on smartphone
- [ ] Install PWA on home screen
- [ ] Test offline mode
- [ ] Share the URL!

---

**Your app will be live at:**
- Vercel: `https://opimappa.vercel.app` (or similar)
- Netlify: `https://opimappa.netlify.app` (or similar)

**Deployment time:** 2-5 minutes ⚡
