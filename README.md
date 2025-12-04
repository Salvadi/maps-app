# OPImaPPA

A mobile-first Progressive Web App for construction and installation mapping with offline-first architecture. Capture photos, manage mapping entries, and export data - all while working completely offline.

## 🚀 Features

### ✅ Phase 1: Core Offline with IndexedDB
- **Offline-First Architecture** - All data stored in IndexedDB, works without internet
- **Photo Compression** - Automatic compression to 1MB max, 1920px using browser-image-compression
- **Project Management** - Create, edit, delete, and view projects
- **Mock Authentication** - Multi-user support with role-based access control
- **Service Worker** - App shell caching for instant offline access
- **PWA Manifest** - Installable on mobile devices as a native app

### ✅ Phase 2: Mapping View & Export
- **Mapping View** - Display all mapping entries for a project with photo gallery
- **Photo Gallery** - Expandable cards with responsive image grid
- **XLSX Export** - Export mapping data to formatted Excel spreadsheet
- **ZIP Export** - Export Excel file + photos organized by floor/room
- **Smart Navigation** - Context-aware navigation between views

### ✅ Phase 3: Supabase Sync (Implemented)
- Real-time sync with Supabase backend
- Background sync when connection returns
- Bidirectional sync (upload and download)
- Multi-device support
- Row Level Security (RLS) policies
- Admin role-based access control
- ✅ Conflict resolution (projects & mapping_entries, see [CONFLICT_RESOLUTION.md](./docs/CONFLICT_RESOLUTION.md))

---

## 🛠️ Technologies

- **React 18** - UI framework with TypeScript
- **Dexie.js** - IndexedDB wrapper for offline storage
- **Service Worker** - Offline-first caching strategy
- **browser-image-compression** - Photo compression
- **SheetJS (xlsx)** - Excel file generation
- **JSZip** - ZIP file creation
- **file-saver** - File download handling

---

## 📦 Installation

### Prerequisites
- Node.js 16+ and npm

### Steps

1. **Clone the repository**
   ```bash
   git clone <your-repo-url>
   cd maps-app
   ```

2. **Install dependencies**
   ```bash
   npm install --legacy-peer-deps
   ```

   *Note: `--legacy-peer-deps` is required due to React 19 compatibility*

3. **Start the development server**
   ```bash
   npm start
   ```

   The app will open at [http://localhost:3000](http://localhost:3000)

4. **Build for production**
   ```bash
   npm run build
   ```

   Builds the app to the `build/` folder (243 kB gzipped)

---

## 🧪 How to Test the App

### Basic Testing

1. **Start the app**
   ```bash
   npm start
   ```

2. **Login**
   - Use one of the mock accounts:
     - **Admin**: `admin@example.com` (any password) - Can see all projects
     - **User**: `user@example.com` (any password) - Can see only their projects

3. **Create a Project**
   - Click the **+** button on the Home page
   - Fill in:
     - Title (required)
     - Client, Address, Notes (optional)
     - Floors (e.g., "-1, 0, 1, 2")
     - Intervention mode: Room or Intervention
     - Typologies (optional)
   - Click **Create**

4. **View Projects**
   - Click the **eye icon** on any project card to view mappings
   - Initially empty - no mappings yet

5. **Add Mapping Entries**
   - From Home, click the **door icon** to enter mapping mode
   - OR from Mapping View, click the **+** button
   - Capture/upload photos (supports multiple photos)
   - Select floor and room/intervention
   - Add crossings (optional)
   - Click **Save**

6. **View Mapping Gallery**
   - Click **eye icon** on a project
   - See all mapping entries with photo counts
   - Click any mapping card to expand and view photos
   - Photos load from IndexedDB instantly

7. **Export Data**
   - From Mapping View:
     - **Export Excel**: Downloads spreadsheet with mapping data
     - **Export ZIP**: Downloads ZIP with Excel + photos organized by floor/room

### Offline Testing

1. **Enable Offline Mode**
   - Open Chrome DevTools (F12)
   - Go to **Application** → **Service Workers**
   - Check the **Offline** checkbox
   - OR go to **Network** tab → Select **Offline** from throttling dropdown

2. **Refresh the Page**
   - The app should still load (served from cache)
   - All functionality works offline

3. **Create Projects Offline**
   - Create new projects
   - Add mapping entries with photos
   - Everything saves to IndexedDB

4. **Test Data Persistence**
   - Close the browser completely
   - Reopen and navigate to http://localhost:3000
   - All your data is still there!

5. **Check Service Worker**
   - Open DevTools → Application → Service Workers
   - Should see "activated and running"
   - Cache Storage shows cached assets

### PWA Installation Testing

1. **Desktop (Chrome)**
   - Click the **install icon** in the address bar
   - OR go to Settings (3 dots) → "Install OPImaPPA"
   - App opens in standalone window

2. **Mobile (Android Chrome)**
   - Deploy the app to a server (must be HTTPS)
   - Open in Chrome mobile
   - Tap menu → "Add to Home Screen"
   - App installs like a native app

### Photo Compression Testing

1. **Upload Large Photos**
   - Take a high-resolution photo (5-10 MB)
   - Add to a mapping entry
   - Photo is automatically compressed to ~1 MB
   - Check DevTools → Application → IndexedDB → photos → blob size

---

## 📱 Usage Guide

### User Roles

- **Admin** (`admin@example.com`)
  - Can see all projects from all users
  - Full CRUD permissions

- **Regular User** (`user@example.com`)
  - Can only see projects they own or have access to
  - Can create their own projects

### Workflow

```
Login → Home → Create Project → View Project → Add Mappings → Export
```

1. **Login** with mock credentials
2. **Create a project** with floor plans and typologies
3. **Add mapping entries** by capturing photos on-site
4. **View all mappings** in the gallery view
5. **Export to Excel/ZIP** for sharing or archival

### Customizing Typologies Menu Options

The Typologies section in the Project Form uses predefined menu options that can be easily customized. To modify the available options:

1. **Open** `src/components/ProjectForm.tsx`
2. **Locate** the constants at the top of the file (lines 5-34):

```typescript
// Supporto options (Parete, Solaio)
const SUPPORTO_OPTIONS = [
  { value: '', label: '' },
  { value: 'parete', label: 'Parete' },
  { value: 'solaio', label: 'Solaio' },
];

// Tipo Supporto options (Mattoni, Cemento, etc.)
const TIPO_SUPPORTO_OPTIONS = [
  { value: '', label: '' },
  { value: 'brick', label: 'Mattoni' },
  { value: 'concrete', label: 'Cemento' },
  { value: 'wood', label: 'Legno' },
  { value: 'steel', label: 'Acciaio' },
  { value: 'plasterboard', label: 'Cartongesso' },
];

// Materiali options
const MATERIALI_OPTIONS = [
  { value: '', label: '' },
  { value: 'plastic', label: 'Plastica' },
  { value: 'metal', label: 'Metallo' },
  { value: 'fiber', label: 'Fibra' },
  { value: 'composite', label: 'Composito' },
];

// Attraversamento options
const ATTRAVERSAMENTO_OPTIONS = [
  { value: '', label: '' },
  { value: 'horizontal', label: 'Orizzontale' },
  { value: 'vertical', label: 'Verticale' },
  { value: 'diagonal', label: 'Diagonale' },
];
```

3. **Add, remove, or modify** entries as needed
4. **Format**: Each entry requires `{ value: 'key', label: 'Display Text' }`
5. **Save** and rebuild the app

**Example - Adding a new material:**
```typescript
const MATERIALI_OPTIONS = [
  { value: '', label: '' },
  { value: 'plastic', label: 'Plastica' },
  { value: 'metal', label: 'Metallo' },
  { value: 'fiber', label: 'Fibra' },
  { value: 'composite', label: 'Composito' },
  { value: 'ceramic', label: 'Ceramica' }, // ← New option
];
```

### Project Structure

```
maps-app/
├── public/
│   ├── service-worker.js      # PWA service worker
│   └── manifest.json           # PWA manifest
├── src/
│   ├── components/
│   │   ├── Login.tsx          # Login page
│   │   ├── Home.tsx           # Project list
│   │   ├── ProjectForm.tsx    # Create/edit projects
│   │   ├── MappingPage.tsx    # Add mapping entries
│   │   └── MappingView.tsx    # View mappings + export
│   ├── db/
│   │   ├── database.ts        # Dexie schema
│   │   ├── projects.ts        # Project CRUD
│   │   ├── mappings.ts        # Mapping CRUD
│   │   ├── auth.ts            # Mock authentication
│   │   └── index.ts           # Exports
│   ├── App.tsx                # Main app component
│   └── index.tsx              # Entry point + SW registration
└── package.json
```

---

## 💾 Data Storage

All data is stored in **IndexedDB** (browser local storage):

- **Projects** - Title, client, address, floors, typologies
- **Mapping Entries** - Floor, room, crossings, timestamps
- **Photos** - Compressed blobs (1MB max)
- **Sync Queue** - Pending changes for Phase 3 sync
- **Users** - Mock user accounts

**Storage Estimate**: ~50 MB per 100 photos (compressed)

---

## 🔒 Offline Capabilities

### What Works Offline

✅ **Login** - Authentication with mock users
✅ **Create Projects** - All project creation/editing
✅ **Add Mappings** - Capture photos and save entries
✅ **View Mappings** - Browse photo gallery
✅ **Export Excel** - Generate XLSX files
✅ **Export ZIP** - Create ZIP with photos
✅ **Full UI** - All pages and navigation

### Service Worker Strategy

- **Cache-First** for app shell (HTML, CSS, JS)
- **Network-First** with fallback for API calls (Phase 3)
- **Runtime Caching** for dynamic content

---

## 🚀 Deployment

### Build for Production

```bash
npm run build
```

Output: `build/` folder (243 kB gzipped)

### Deploy to Static Hosting

#### Vercel
```bash
vercel --prod
```

#### Netlify
```bash
netlify deploy --prod --dir=build
```

#### GitHub Pages
```bash
npm run build
# Push build folder to gh-pages branch
```

**Important**: For PWA features to work, the app must be served over **HTTPS**.

---

## 🐛 Troubleshooting

### Build Errors

**Issue**: `Module not found: Can't resolve 'dexie'`
**Fix**: Run `npm install --legacy-peer-deps`

**Issue**: `Module not found: Can't resolve 'browser-image-compression'`
**Fix**: Run `npm install --legacy-peer-deps`

### Runtime Errors

**Issue**: IndexedDB not working
**Fix**: Ensure you're not in private/incognito mode

**Issue**: Photos not compressing
**Fix**: Check browser console for compression errors. Ensure photos are valid image files.

**Issue**: Service Worker not registering
**Fix**: Ensure you're on HTTPS or localhost. Check DevTools → Application → Service Workers

### Data Loss

**Issue**: Lost data after browser update
**Fix**: IndexedDB is persistent. Check Application → IndexedDB in DevTools. Data should be there unless manually cleared.

---

## 📊 Performance

- **Bundle Size**: 243 kB gzipped (main.js + CSS)
- **First Load**: ~500ms on 3G
- **Offline Load**: <100ms (served from cache)
- **Photo Compression**: ~1-2s per photo
- **Export Time**: ~2-5s for 50 mappings with 100 photos

---

## 📚 Documentation

### Supabase Setup & RLS Policies

For detailed information about Supabase setup and RLS policies:

- **[SUPABASE_SETUP.md](./docs/SUPABASE_SETUP.md)** - Complete guide to setting up Supabase backend
- **[RLS_POLICIES_ANALYSIS.md](./docs/RLS_POLICIES_ANALYSIS.md)** - In-depth analysis of RLS policies, potential bugs, and security considerations
- **[ACTION_ITEMS_RLS_POLICIES.md](./docs/ACTION_ITEMS_RLS_POLICIES.md)** - Action items checklist before deploying RLS policy updates
- **[CONFLICT_RESOLUTION.md](./docs/CONFLICT_RESOLUTION.md)** - How conflict resolution works for projects and mapping entries
- **[migration-update-projects-rls-policies.sql](./docs/migration-update-projects-rls-policies.sql)** - SQL migration script for updated policies
- **[migration-add-projects-conflict-resolution.sql](./docs/migration-add-projects-conflict-resolution.sql)** - SQL migration for conflict resolution fields

**⚠️ Important**: If you're updating RLS policies, please read the analysis document first to understand breaking changes and recommendations.

## 🔮 Future Enhancements (Phase 4+)

### Phase 3: Completed ✅
- [x] Supabase authentication
- [x] Real-time sync with Postgres
- [x] Background sync when online
- [x] Row Level Security (RLS)
- [x] Complete conflict resolution strategy (projects & mapping_entries)

### Known Issues & Limitations

- **✅ Conflict resolution implemented**: Projects and mapping entries use "last-modified-wins" strategy (see [CONFLICT_RESOLUTION.md](./docs/CONFLICT_RESOLUTION.md))
- **⚠️ Shared users cannot delete projects**: Only owners and admins can delete (by design, see RLS_POLICIES_ANALYSIS.md)
- **⚠️ Users cannot remove themselves from shared projects**: Policy prevents self-removal from accessible_users list
- **⚠️ Migration required**: Apply `migration-add-projects-conflict-resolution.sql` in Supabase for full conflict resolution support

See [ACTION_ITEMS_RLS_POLICIES.md](./docs/ACTION_ITEMS_RLS_POLICIES.md) for planned improvements.

### Phase 4: Advanced Features
- [ ] Floor plan upload and annotation
- [ ] Offline maps integration
- [ ] Team collaboration
- [ ] Real-time updates
- [ ] Push notifications

### Phase 5: Analytics & Reporting
- [ ] Dashboard with statistics
- [ ] Custom report generation
- [ ] Timeline view
- [ ] Photo comparison tools

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit changes: `git commit -m 'Add my feature'`
4. Push to branch: `git push origin feature/my-feature`
5. Open a Pull Request

---

## 📄 License

This project is licensed under the MIT License.

---

## 📞 Support

For issues or questions:
- Open an issue on GitHub
- Check the troubleshooting section above
- Review the browser console for error messages

---

## 🙏 Acknowledgments

- Built with Create React App
- Offline storage powered by Dexie.js
- Photo compression by browser-image-compression
- Export functionality using SheetJS and JSZip

---

**Built with ❤️ for offline-first construction mapping**
