# OPImaPPA

Progressive Web App mobile-first per la mappatura di sigillature antincendio su cantieri. Consente di fotografare, geolocalizzare su planimetria, catalogare e esportare gli interventi — online o completamente offline.

Frontend React 19 + TypeScript, store locale Dexie (IndexedDB), backend Supabase (Postgres + Storage + Auth). Architettura **online-first**: letture live con write-through verso la cache locale e fallback completo su IndexedDB quando la rete manca.

## Stack

- **React 19** + **TypeScript**, CRA + CRACO, **Tailwind CSS**
- **Dexie** (IndexedDB) — store locale versionato
- **Supabase** — auth, Postgres (RLS), Storage (bucket `photos`, `planimetrie`)
- **PDF**: `pdf-lib`, `pdfjs-dist`, `jspdf`
- **Export**: `xlsx`, `jszip`, `file-saver`
- **UI**: `lucide-react`, `framer-motion`
- **PWA**: Service Worker custom con update flow esplicito

## Quick start

```bash
npm install --legacy-peer-deps   # richiesto da peer conflicts React 19
npm start                        # dev server su http://localhost:3000
npm run build                    # bundle produzione in build/
npm test                         # Jest / React Testing Library
```

### Variabili d'ambiente

Crea `.env.local` in root (template in [docs/.env.local.example](./docs/.env.local.example)):

```
REACT_APP_SUPABASE_URL=https://<project-ref>.supabase.co
REACT_APP_SUPABASE_ANON_KEY=<anon-key>
```

Senza queste variabili l'app parte in **offline-only**: niente sync, niente login remoto.

## Struttura

```
maps-app/
├── src/
│   ├── App.tsx              # Router single-component (View state)
│   ├── components/          # UI — view heavy in React.lazy
│   ├── db/                  # Dexie schema + CRUD per entità
│   │   ├── database.ts      # Schema versionato (v10)
│   │   ├── onlineFirst.ts   # Helper read online-first
│   │   └── projects|mappings|floorPlans|photos|sal|pricing|...
│   ├── sync/                # Engine sync bidirezionale
│   │   ├── syncEngine.ts          # Queue, lock, scheduler, eventi
│   │   ├── syncUploadHandlers.ts  # Upload per entità
│   │   ├── syncDownloadHandlers.ts# Download da Supabase
│   │   └── conflictResolution.ts  # last-modified-wins
│   ├── utils/               # Export (xlsx, zip), planimetrie utils
│   ├── hooks/               # useBlobUrl, useDropdownOptions, useModal
│   ├── config/              # Opzioni statiche (attraversamento, prodotti…)
│   └── lib/supabase.ts      # Client Supabase
├── public/
│   ├── service-worker.js    # Cache app shell + update flow
│   └── manifest.json        # PWA manifest
├── supabase/
│   ├── schema.sql           # Schema Postgres + RLS (baseline)
│   └── storage-policies.sql # Bucket + policies Storage
├── docs/                    # Documentazione tecnica
├── craco.config.js
├── tailwind.config.js
├── tsconfig.json
└── vercel.json              # Deploy + CSP
```

## Architettura

### Data layer

Dexie schema in [src/db/database.ts](src/db/database.ts), versione corrente **v10**. Le modifiche allo schema richiedono **sempre** un nuovo `this.version(n+1).stores(...)` — mai modificare blocchi passati. I boolean indicizzati sono salvati come `0|1` perché IndexedDB non indicizza `true/false`.

Entità principali: `Project`, `MappingEntry`, `Photo`, `FloorPlan`, `FloorPlanPoint`, `StandaloneMap`, `Sal`, `TypologyPrice`, più cache per dropdown options e catalogo prodotti.

### Pattern online-first

Ogni read passa da [src/db/onlineFirst.ts](src/db/onlineFirst.ts): se `isOnlineAndConfigured()` → fetch da Supabase, overlay dei pending writes dalla sync queue locale, write-through su Dexie, ritorno al chiamante. Se offline → lettura diretta da Dexie. Le nuove read path devono usare questi helper invece di `try-remote-then-local` manuali.

### Sync engine

- **Upload handler per entità** in [syncUploadHandlers.ts](src/sync/syncUploadHandlers.ts) consumano `db.syncQueue`.
- **Download handler** in [syncDownloadHandlers.ts](src/sync/syncDownloadHandlers.ts) popolano Dexie da Supabase; settano `hasRemotePhotos`.
- **Conflict resolution** last-modified-wins per `projects` e `mapping_entries` ([conflictResolution.ts](src/sync/conflictResolution.ts)); gli eventi vengono loggati in `conflictHistory`. Dettagli in [docs/CONFLICT_RESOLUTION.md](docs/CONFLICT_RESOLUTION.md).

Tipi entità supportati in queue: `project | mapping_entry | photo | floor_plan | floor_plan_point | standalone_map | sal`.

### Storage

Le foto vanno nel bucket privato `photos` — il client richiede **signed URL** e non costruisce mai URL pubbliche. Le planimetrie vanno in `planimetrie` (pubblico in lettura). Le foto sono compresse client-side a ≤1 MB / 1920px via `browser-image-compression`; le planimetrie vengono rasterizzate a 2× con thumbnail separata, e per i PDF originali si mantiene `pdfBlobBase64` + `pdfUrl` per export vettoriale con `pdf-lib`.

### PWA / update

`public/service-worker.js` registrato in [serviceWorkerRegistration.ts](src/serviceWorkerRegistration.ts). Il componente `UpdateNotification` intercetta la nuova versione; "Aggiorna Ora" invoca `clearAndSync()` che svuota Dexie e riscarica da Supabase. Bump della versione del SW → forza questo flusso su tutti i client. Dettagli in [docs/UPDATE_SYSTEM.md](docs/UPDATE_SYSTEM.md).

## Supabase

Schema autoritativo in [supabase/schema.sql](supabase/schema.sql) e policy Storage in [supabase/storage-policies.sql](supabase/storage-policies.sql). Eseguili nell'ordine dalla SQL Editor di Supabase per ricostruire l'ambiente da zero. Procedura completa in [docs/SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md).

## Deploy

Produzione su Vercel (config in [vercel.json](vercel.json), inclusa CSP). Aggiungere nuove origini a `connect-src` quando si introduce un servizio terzo. Guida in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Convenzioni

- Commenti, commit message e testi UI in **italiano**.
- Boolean Dexie da indicizzare: tipo `0 | 1` o `number` (es. `synced`, `archived`, `syncEnabled`).
- ID: UUID via `crypto.randomUUID()` esposto come `generateId()` in `database.ts`. Timestamp: epoch ms via `now()`.
- Aggiunta di un campo a un'entità sincronizzata: aggiornare interfaccia Dexie → bump schema version con `.upgrade()` se serve backfill → tipi Supabase in [src/lib/supabase.ts](src/lib/supabase.ts) → schema Postgres + RLS → upload + download handler.

## Documentazione

- [docs/SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md) — setup backend da zero
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — deploy produzione
- [docs/CONFLICT_RESOLUTION.md](docs/CONFLICT_RESOLUTION.md) — strategia conflitti
- [docs/UPDATE_SYSTEM.md](docs/UPDATE_SYSTEM.md) — flusso aggiornamenti PWA
