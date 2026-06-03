# OPImaPPA — Mappatura funzionale completa

> Documento di riferimento per la **riscrittura** dell'app nel contesto **migrazione Supabase → homeserver**.
>
> Sorgenti analizzate:
> - `origin/master` (~36k LOC `src/`, schema `supabase/schema.sql`, storage policies).
> - `feature/migration-sprint6` (branch homeserver, +21k inserzioni, -1.2k delezioni) — include `opimappa-server/` (Hono+Drizzle+Postgres+MinIO+Caddy).
> - Working tree allineato a `origin/master` per i file `src/`.

---

## INDICE
1. [Cos'è l'app](#1-cosè-lapp)
2. [Stack tecnico](#2-stack-tecnico)
3. [Modello dati completo](#3-modello-dati-completo)
4. [Shell applicativa e navigazione](#4-shell-applicativa-e-navigazione)
5. [Autenticazione](#5-autenticazione)
6. [Flusso mappatura attraversamenti](#6-flusso-mappatura-attraversamenti)
7. [Flusso strutture](#7-flusso-strutture)
8. [Editor planimetrie](#8-editor-planimetrie)
9. [Esportazioni (Excel, ZIP, PDF)](#9-esportazioni-excel-zip-pdf)
10. [Contabilità e SAL](#10-contabilità-e-sal)
11. [Motore di sincronizzazione](#11-motore-di-sincronizzazione)
12. [Storage, PWA, service worker](#12-storage-pwa-service-worker)
13. [Sicurezza e RLS (versione Supabase)](#13-sicurezza-e-rls-versione-supabase)
14. [**Migrazione homeserver — cosa è stato fatto**](#14-migrazione-homeserver--cosa-è-stato-fatto)
15. [Debito tecnico e invarianti](#15-debito-tecnico-e-invarianti)
16. [**Revisione critica esterna**](#16-revisione-critica-esterna)

---

## 1. Cos'è l'app

PWA mobile-first per **mappatura antincendio**: sigillature di attraversamenti (tubi, cavi, condotti) e strutture compartimentanti (pareti, soffitti, cassonetti) in cantieri di costruzione.

**Flusso operativo tipico** dell'operatore in cantiere:
1. Crea un **progetto/cantiere** (cliente, indirizzo, piani, tipologici, planimetrie).
2. Registra **mappature attraversamenti** con foto, dati tecnici (supporto, diametro, attraversamento, asola), posizione su planimetria.
3. Registra **strutture** (parete/soffitto/cassonetto) con dimensioni e foto.
4. **Annota la planimetria** con punti (parete/solaio), perimetri (per strutture/aree generiche), etichette numeriche, classificazioni EI (resistenza al fuoco 30/60/90/120/180/240).
5. Configura **prezzi unitari per tipologico** e crea **SAL** (Stato Avanzamento Lavori) progressivi per la contabilità.
6. **Esporta** report Excel (mappature + tipologici + strutture), archivi ZIP (foto gerarchizzate + PDF planimetrie annotate), o singole planimetrie PDF.

**Requisito non negoziabile**: **funzionamento 100% offline** + sincronizzazione bidirezionale al ritorno della connessione.

---

## 2. Stack tecnico

### 2.1 Versione attuale (master, Supabase)
| Layer | Tecnologia |
|-------|-----------|
| Frontend | React 19 + TypeScript |
| Build | CRA 5 (`react-scripts`) + CRACO override |
| Styling | Tailwind CSS + CSS file per componente |
| Store locale | IndexedDB via **Dexie v3** (schema v11) |
| Backend BaaS | Supabase (Postgres 15 + GoTrue + Storage + Realtime) |
| Auth | Supabase Auth (email/password + sessione JWT) |
| Storage | Supabase Storage (2 bucket: `photos` privato, `planimetrie` pubblico-read) |
| Realtime | Supabase Realtime (non utilizzato attivamente nel codice; sync = polling+manual) |
| PDF | `pdf-lib` (PDF vettoriale planimetrie), `pdfjs-dist` (raster preview), `jsPDF` (fallback) |
| Export | `xlsx` (SheetJS), `JSZip`, `file-saver` |
| Foto | `browser-image-compression` (compressione lossy ≤1MB / 1920px) |
| PWA | Service worker custom (`public/service-worker.js`), Background Sync API |
| UI extra | `lucide-react` (icone), `framer-motion` (animazioni) |
| Deploy | Vercel (CDN edge) — header CSP definiti in `vercel.json` |

### 2.2 Versione homeserver (branch `feature/migration-sprint6`)
| Layer | Tecnologia |
|-------|-----------|
| Server runtime | **Hono** (TypeScript, Node 20+) |
| ORM | **Drizzle ORM** (`drizzle-orm/postgres-js`) |
| DB | **Postgres 17.4-alpine** |
| Auth | **better-auth** (+ `drizzleAdapter` + `admin` plugin) |
| Storage | **MinIO** (S3-compatible, RELEASE.2025-04-08+) via `@aws-sdk/client-s3` + `s3-request-presigner` |
| Realtime | Postgres `LISTEN/NOTIFY` (`opimappa_changes`) + tabella `change_log` (seq bigint) + SSE |
| Reverse proxy | **Caddy 2.8.4-alpine** (TLS terminata su Cloudflare edge) |
| Tunnel | **cloudflared 2025.4.0** (tunnel → edge Cloudflare) |
| Orchestrazione | Docker Compose, rete interna `opimappa_net`, volumi su `/opt/opimappa/data/...` |
| Frontend | Invariato (React 19 + Dexie) ma client `apiFetch`/`apiStorageFrom` invece di `supabase-js` |

Dettagli del lavoro homeserver: vedi §14.

---

## 3. Modello dati completo

> Doppia rappresentazione obbligata: **Dexie** (locale, booleani come `0|1` per via dell'incapacità di Dexie di indicizzare booleani veri) ↔ **Postgres** (remoto, snake_case, booleani nativi, blob su Storage). Conversione nei sync handler (`convertRemoteToLocal*`).

### 3.1 Inventario entità

| Entità (TS) | Tabella Dexie | Tabella Postgres | Storage |
|-------------|--------------|------------------|---------|
| `User` | `users` | `profiles` (Supabase) / `user` (homeserver better-auth) | — |
| `Project` | `projects` | `projects` | — |
| `Typology` | embedded in `Project.typologies[]` | colonna JSONB su `projects` | — |
| `MappingEntry` | `mappingEntries` | `mapping_entries` | — |
| `Crossing` | embedded in `MappingEntry.crossings[]` | JSONB | — |
| `StructureEntry` | `structureEntries` (v11+) | `structure_entries` | — |
| `Structure` | embedded in `StructureEntry.structures[]` | JSONB | — |
| `Photo` | `photos` | `photos` | bucket `photos` (privato, signed URL) |
| `FloorPlan` | `floorPlans` | `floor_plans` | bucket `planimetrie` (immagine + thumb + PDF) |
| `FloorPlanPoint` | `floorPlanPoints` | `floor_plan_points` | — |
| `StandaloneMap` | `standaloneMaps` | `standalone_maps` | bucket `planimetrie` (path `standalone/{userId}/{mapId}/`) |
| `TypologyPrice` | `typologyPrices` | `typology_prices` | — |
| `Sal` | `sals` | `sals` | — |
| `DropdownOptionCache` | `dropdownOptionsCache` | `dropdown_options` | — |
| `ProductCache` | `productsCache` | `products` | — |
| `SyncQueueItem` | `syncQueue` | — (puro outbox locale) | — |
| `ConflictHistory` | `conflictHistory` | — | — |
| `ProjectCachePref` | `projectCachePrefs` (v10+) | — | — |
| `AppMetadata` | `metadata` | — | — |
| `AuthCache` *(solo homeserver)* | `authCache` (v12) | — | — |
| `RealtimeState` *(solo homeserver)* | `realtimeState` (v13) | — | — |

### 3.2 Schema dettagliato delle entità principali

#### `Project` (campi essenziali)
- `id: UUID`, `title`, `client`, `address`, `notes`
- `floors: string[]` — etichette dei piani (es. `['-1','0','1','2']`)
- `plans: string[]` — backward compat (oggi gestito da `FloorPlan` separato)
- `typologies: Typology[]` — array embedded
- `useRoomNumbering: boolean`, `useInterventionNumbering: boolean` — switch numerazione
- `ownerId: string`, `accessibleUsers: string[]` — condivisione progetto
- `archived: 0|1`, `syncEnabled: 0|1` (0 = solo metadati, 1 = full incluse foto)
- `createdAt`, `updatedAt`, `version?`, `lastModified?`
- `synced: 0|1`

#### `Typology` (embedded)
- `id`, `number` (progressivo nel progetto)
- `category?: 'attraversamento' | 'struttura'` (undefined = `'attraversamento'` retrocompat)
- `supporto`, `tipoSupporto`, `attraversamento`, `attraversamentoCustom?`
- `struttura?`, `tipoStruttura?` (solo se `category='struttura'`)
- `marcaProdottoUtilizzato`, `prodottiSelezionati: string[]`

#### `MappingEntry` (scheda di mappatura)
- `id`, `projectId`, `floor`, `room?`, `intervention?`
- `photos: PhotoMetadata[]` — referenze (ID + remoteUrl)
- `crossings: Crossing[]` — array embedded
- `toComplete?: boolean`
- `timestamp`, `createdBy`, `lastModified`, `modifiedBy`, `version`
- `synced: 0|1`, `hasRemotePhotos?: boolean` (foto remote non ancora scaricate)

#### `Crossing` (embedded)
- `id`, `supporto`, `tipoSupporto`, `attraversamento`, `attraversamentoCustom?`
- `tipologicoId?` — riferimento a `Project.typologies[].id`
- `quantita?`, `diametro?`, `dimensioni?`, `notes?`
- `inAsola?: boolean`, `asolaB?: number` (cm), `asolaH?: number` (cm)
- `salId?` — UUID del SAL a cui è assegnato (undefined = non contabilizzato)
- Calcolo area: `calcAsolaMq(b,h) = Math.max(0.2, (b*h)/10000)` — **minimo 0,2 mq imposto**.

#### `StructureEntry` / `Structure`
Speculare a `MappingEntry`/`Crossing` ma per strutture edili:
- `struttura: string` (`'Parete' | 'Soffitto' | 'Cassonetto porta-impianto' | 'Altro'`), `strutturaCustom?`
- `tipoStruttura?` (`'Flessibile' | 'Rigido' | ...`)
- `base?` (m), `altezza?` (m), `superficie?` (mq, auto-calcolata), `lunghezza?` (ml, per cassonetti)
- `tipologicoId?`, `salId?`, `notes?`

#### `Photo`
- `id`, `mappingEntryId` (e/o `structureEntryId` indirettamente via `entryType`)
- `entryType?: 'mapping' | 'structure'` (undefined = `'mapping'` retrocompat)
- `blob?: Blob`, `thumbnailBlob?: Blob` (entrambi opzionali: foto remote-only finché non scaricate)
- `remoteUrl?`, `thumbnailRemoteUrl?`, `storagePath?`, `thumbnailStoragePath?`
- `metadata`: `{width, height, size, mimeType, captureTimestamp, gps?}`
- `uploaded: boolean`

#### `FloorPlan`
- `id`, `projectId`, `floor`
- `imageBlob?: Blob`, `thumbnailBlob?: Blob` — locali, lazy
- `imageUrl?`, `thumbnailUrl?`, `pdfUrl?` — Supabase URL quando sync
- `pdfBlobBase64?: string` — PDF originale base64 per export vettoriale (preservare)
- `originalFilename`, `originalFormat`, `width`, `height`
- `gridEnabled?`, `gridConfig?: {rows, cols, offsetX, offsetY}`
- `metadata?: Record<string,any>` (contiene tra l'altro `cartiglio`)
- `createdBy`, `createdAt`, `updatedAt`, `remoteUpdatedAt?` (per conflict detection)
- `assetDirty?: 0|1` (1 quando blob locali modificati e va re-uploadati)
- `synced: 0|1`

#### `FloorPlanPoint`
- `id`, `floorPlanId`
- `mappingEntryId?` o `structureEntryId?` — collegamento a entry (mutuamente esclusivi se valorizzati)
- `pointType: 'parete' | 'solaio' | 'perimetro' | 'generico'`
- `pointX, pointY: number` — **coordinate normalizzate [0,1]** (rispetto all'immagine originale)
- `labelX, labelY: number` — **normalizzate [0,1]**
- `perimeterPoints?: Array<{x,y}>` — solo per `pointType='perimetro'`
- `customText?: string` — solo per `pointType='generico'`
- `eiRating?: 30|60|90|120|180|240`
- `metadata?` — contiene `labelText[]`, `labelBackgroundColor`, `labelTextColor`
- `createdBy`, `createdAt`, `updatedAt`, `remoteUpdatedAt?`, `synced: 0|1`

#### `StandaloneMap`
Planimetria indipendente da progetto, per-utente. Stessi campi di `FloorPlan` + `userId`, `name`, `description?`, ma con `points[]` embedded (non tabella separata) e supporto `labelText[]`, `labelBackgroundColor`, `labelTextColor`.

#### `SyncQueueItem` (outbox locale)
- `id`, `operation: 'CREATE'|'UPDATE'|'DELETE'`
- `entityType: 'project' | 'mapping_entry' | 'photo' | 'floor_plan' | 'floor_plan_point' | 'standalone_map' | 'sal' | 'typology_price' | 'structure_entry'`
- `entityId`, `payload: any`, `timestamp`
- `retryCount`, `lastError?`, `lastAttemptAt?`
- `synced: 0 = pending | 1 = synced | 2 = permanently failed`

#### `TypologyPrice`
- `id`, `projectId`, `attraversamento` (chiave), `tipologicoId?`
- `category?: 'attraversamento' | 'struttura'`
- `pricePerUnit: number`, `unit: 'piece' | 'sqm'`
- Indici Dexie compositi: `[projectId+attraversamento]`, `[projectId+attraversamento+tipologicoId]`

#### `Sal`
- `id`, `projectId`, `number: number` (progressivo automatico), `name?`, `date: number` (timestamp), `notes?`

### 3.3 Convenzioni dati invarianti
- **ID**: UUID v4 via `crypto.randomUUID()` con fallback Safari < 15.4 (`xxxxxxxx-xxxx-4xxx-yxxx-...` regex).
- **Timestamp**: epoch ms (`Date.now()` o `now()` helper).
- **Booleani indicizzati su Dexie**: `0|1` (Dexie non indicizza booleani veri → `.where('synced').equals(0)` fallirebbe silenziosamente con `true/false`).
- **Coordinate planimetria**: sempre **normalizzate `[0,1]`** rispetto all'immagine originale (zoom/risoluzione-agnostiche).
- **Asola**: minimo **0,2 mq** imposto.
- **Storage**:
  - bucket `photos` privato → lettura via **signed URL** (`signPhotoPaths`, batch ≤500).
  - bucket `planimetrie` pubblico in lettura → URL diretti possibili (ma vedi shim homeserver in §14.7).
  - path foto: `{mappingEntryId}/{photoId}.{ext}` (struttura analoga).
  - path planimetrie: `{projectId}/{floor}/{filename}`.
  - path standalone: `standalone/{userId}/{mapId}/`.

### 3.4 Schema versioning Dexie (`MappingDatabase`)
11 versioni successive — **regola ferrea: mai mutare un blocco `version(n)` passato, sempre aggiungere `version(n+1)` con `.upgrade()` opzionale per backfill**.

| v | Aggiunta | Note |
|---|----------|------|
| 1 | base: projects, mappingEntries, photos, syncQueue, users, metadata | — |
| 2 | `archived` index su projects | upgrade: `archived = 0` ovunque |
| 3 | `syncEnabled` su projects + tabella `conflictHistory` | upgrade: `syncEnabled = 0` |
| 4 | tabelle floor plan (`floorPlans`, `floorPlanPoints`, `standaloneMaps`) | — |
| 5 | tabelle cache (`dropdownOptionsCache`, `productsCache`) | — |
| 6 | `typologyPrices` con chiave `tipologicoId` | — |
| 7 | `typologyPrices` con chiave `attraversamento` (sostituisce v6) | **upgrade: `clear()` distruttivo** della tabella |
| 8 | `sals` | — |
| 9 | `typologyPrices` con chiave composta `[attraversamento+tipologicoId]` | — |
| 10 | `projectCachePrefs` (pin offline) | — |
| 11 | `structureEntries` | — |
| **12** (homeserver) | `authCache` (PBKDF2 + AES-GCM) | vedi §14.8 |
| **13** (homeserver) | `realtimeState` (cursor SSE + rate-limit auth offline) | vedi §14.7 |

### 3.5 Helper standard
- `generateId()`: UUID con fallback Safari.
- `now()`: `Date.now()`.
- `initializeDatabase()`: `db.open()` + bootstrap `metadata.lastSync = 0`, `metadata.currentUser = null` se assenti.
- `clearDatabase()`: transazione rw che svuota TUTTE le tabelle dati (preserva `metadata`). Nella versione homeserver preserva anche `authCache` (per non perdere credenziali offline).
- `getDatabaseStats()`: conteggio righe per tabella + somma `blob.size` per `photos`, `floorPlans`, `standaloneMaps` → ritorna anche MB formattati.

---

## 4. Shell applicativa e navigazione

`src/App.tsx` (~840 LOC) — single-component router con `useState<View>`, **nessun react-router**.

### 4.1 Macchina a stati delle viste
```ts
type View =
  | 'login' | 'passwordReset' | 'tabs'
  | 'projectForm' | 'projectEdit'
  | 'mapping' | 'structure'
  | 'projectDetail'
  | 'standaloneEditor' | 'floorPlanEditor';
```

`tabs` è il contenitore principale con **4 tab** (gestiti da `BottomTabBar`, `TabId = 'dashboard'|'projects'|'maps'|'settings'`):
- **dashboard** → `Dashboard`
- **projects** → `ProjectList`
- **maps** → `MapsOverview`
- **settings** → `SettingsPage`

### 4.2 Viste lazy-loaded (`React.lazy`)
Per tenere basso il bundle iniziale, importano librerie pesanti (jsPDF, pdf-lib, pdfjs-dist, xlsx):
- `ProjectForm`, `ProjectDetail`
- `MappingWizard`, `StructureWizard`
- `MapsOverview`, `SettingsPage`
- `StandaloneFloorPlanEditor`, `FloorPlanEditor`

Wrapped da `<Suspense>` + `<ErrorBoundary>`.

### 4.3 Stati globali in `App`
- `isInitialized`, `currentUser`, `currentView`, `activeTab`
- Stati di routing/passaggio dati: `selectedProject`, `currentMappingProject`, `currentStructureProject`, `viewingProject`, `editingMappingEntry`, `editingStructureEntry`, `mappingWizardKey`, `structureWizardKey`, `editing*EntryInitialStep`
- Stati editor planimetrie: `editorFloorPlan`, `editorImageUrl`, `editorProject`, `editorInitialPoints`, `editorUnmappedEntries`
- `isOnline`, `swRegistration`, `syncStats`, `syncProgress`

### 4.4 Lifecycle all'avvio (`useEffect` init)
1. **`enforceForcedMigrationIfNeeded()`** — se la `FORCED_RESET_VERSION` è obsoleta in localStorage, esegue **wipe totale**:
   - `supabase.auth.signOut`
   - `clearServiceWorkerRegistrations()` (unregister tutti i SW)
   - `clearBrowserCaches()` (delete tutte le `caches`)
   - `clearIndexedDbDatabases()` (delete TUTTI i DB incluso `MappingDatabase`)
   - `localStorage.clear()` + `sessionStorage.clear()`
   - aggiorna versione + `location.reload()`
   - Doppia esecuzione prevenuta via `sessionStorage[FORCED_RESET_RUNNING_KEY]`.
2. `initializeDatabase()` (apre Dexie + bootstrap metadata).
3. `initializeMockUsers()` (no-op retrocompat).
4. **Deep-link auth**: parsing `window.location.hash` (`#type=recovery|signup&access_token=...`).
   - `recovery` o `pathname === '/reset-password'` → `currentView = 'passwordReset'`.
   - `signup` con `access_token` → attendi 1s + cleanup history + alert.
5. `getCurrentUser()` → se sessione valida, `currentView = 'tabs'`.
6. Se `isSupabaseConfigured()`: `startAutoSync(60000)` (auto-sync ogni 60s).
7. `updateSyncStats()` + `setIsInitialized(true)`.

### 4.5 Listener globali registrati
| Evento | Handler |
|--------|---------|
| `popstate` | Ripristina `View` + `TabId` da `event.state`; reset stati cantiere quando si torna a `tabs` |
| `online` | `lockedSync()` + aggiorna stats |
| `offline` | `setIsOnline(false)` |
| `onSyncComplete` (custom) | Aggiorna `syncStats` |
| SW message `BACKGROUND_SYNC` | `lockedSync()` |
| Background Sync API `sync.register('sync-queue')` | Quando online + pending > 0 |
| `swUpdate` (CustomEvent) | Mostra `UpdateNotification` con il `ServiceWorkerRegistration` |

### 4.6 History API integrata
Ogni cambio di `View` o `TabId` fa `window.history.pushState({view, tab}, '', ...)` per supportare il **tasto back hardware Android**. Il `popstate` ripristina lo stato. Se `history.state` è null all'avvio, fa un `replaceState` per inizializzarlo.

### 4.7 Handler principali
- `handleLogin(user)`, `handleLogout()` — auth.
- `handleManualSync()` — apre barra di progresso 6 step + `manualSync({onPhotoDecisionNeeded, onProgress})`; callback foto via `window.confirm("Sincronizzare anche le foto?")`. Auto-dismiss progresso dopo 4s.
- `handleClearAndSync()` — conferma + `clearAndSync()` + `window.location.reload()`.
- `handleCreateProject/EditProject/ViewProject/DeleteProject` — CRUD progetto.
- `handleEnterMapping/Structure` — apre wizard.
- `handle*Saved` — bump `*WizardKey` (forza remount per pulizia stato), reset `editingEntry`/`editingStep`.
- `handleAddMappingFromDetail/handleEditMappingFromDetail` (analoghi per structure) — passaggio dati da ProjectDetail al wizard.
- `handleOpenFloorPlanEditor(project, floorPlan)`:
  1. Se online + Supabase configurato, check remoto `updated_at` per warning "modificato da altro utente" (tolleranza 5s per clock skew).
  2. `ensureFloorPlanAsset(id, 'full')` (idratazione lazy del blob da Storage).
  3. Calcola `editorImageUrl` (blob URL o remoteUrl); revoca eventuale precedente.
  4. Carica `getFloorPlanPoints(floorPlanId)` + `getMappingEntriesForProject` + `getPhotosForMappings`.
  5. Calcola label di ogni punto via `buildMappingLabel(m, photoCount)`: `[`P{floor}\_S{room}\_Int{intervention}\_NN-MM`, `Tip. n1 - n2 - n3`]`. Multi-foto → suffisso `_01-NN`.
  6. Costruisce `canvasPoints[]` (mappa DB→canvas) e `unmappedEntries[]` (entry del piano corrente non ancora posizionate).
  7. `setCurrentView('floorPlanEditor')`.
- `handleBackFromFloorPlanEditor` — revoca blob URL + reset stati editor.
- `handleOpenStandaloneEditor` — apre editor standalone (senza progetto).
- `handleTabChange(tab)` — switch tab + se non in `tabs`, ritorna a `tabs`.

### 4.8 `onSave` del FloorPlanEditor (logica embedded in `App.tsx`)
Persistenza diff dei punti:
1. `initialIds = Set(editorInitialPoints.map(p=>p.id))`, `currentPointIdSet = Set(points.map(p=>p.id))`.
2. **Eliminazione**: per ogni `id` in `editorInitialPoints` non più in `currentPointIdSet` → `deleteFloorPlanPoint(id)`.
3. **Insert/Update**: per ogni `point` in `points`:
   - se `!initialIds.has(point.id)` → `createFloorPlanPoint(floorPlanId, mappingEntryId, type, pointX, pointY, labelX, labelY, userId, {perimeterPoints, customText, eiRating, metadata: {labelText, labelBackgroundColor, labelTextColor}})`.
   - altrimenti → `updateFloorPlanPoint(point.id, {...})`.
4. `updateFloorPlan(id, {gridEnabled, gridConfig, metadata: {...prev, cartiglio}})`.
5. **Riconciliazione**: `getFloorPlanPoints(floorPlanId)` → ricostruisce `reconciledPoints[]` → `setEditorInitialPoints` (per allineare gli ID generati lato DB).

### 4.9 `onOpenMappingEntry` (callback dall'editor)
Cleanup stato editor + revoca blob URL + `getMappingEntry(id)`:
- Se trovato MappingEntry → apre `MappingWizard` con `editingEntry` + `initialStep=1`.
- Altrimenti `getStructureEntry(id)` → apre `StructureWizard` con `initialStep=1`.

---

## 5. Autenticazione

### 5.1 UI (`src/components/Login.tsx`)
- Stato `mode: 'login' | 'signup' | 'forgot'`.
- **Validazioni** (hook `useEffect` su input):
  - `validateEmail`: **solo dominio `@opifiresafe.com`** in signup; errore in `emailError`.
  - `validateUsername`: 3-20 caratteri, `[A-Za-z0-9_]`; errore in `usernameError`.
  - `validatePasswordStrength`: score 0-4 + feedback visivo (`getPasswordStrengthLabel`, `getPasswordStrengthColor`).
- Indicatore connessione Supabase (`isSupabaseConfigured()` → 🟢/🔴).
- `showPassword` toggle (occhiolino).
- Submit signup disabilitato se `!passwordStrength.isValid || emailError || usernameError`.
- Hint demo account in offline mode.

### 5.2 Logica (`src/db/auth.ts`)
**Versione Supabase**:
- `login(email, password)`:
  1. `supabase.auth.signInWithPassword`.
  2. Fetch profilo da `supabase.from('profiles').select().eq('id', user.id).single()`.
  3. Mappa profilo → `User` locale (`{id, email, username, role, createdAt}`).
  4. `db.users.put(localUser)` + `db.metadata.put({key:'currentUser', value: localUser})`.
  5. `syncFromSupabase()` (download metadati).
  6. Fallback `loginOffline` solo se esiste già una sessione Supabase valida in `localStorage`.
- `signUp(email, password, username)`:
  - `supabase.auth.signUp({email, password, options:{emailRedirectTo, data:{username, role:'user'}}})`.
  - Il profilo viene creato lato DB da trigger `on_auth_user_created` (Postgres `auth` schema → `public.profiles`).
- `getCurrentUser()`: `supabase.auth.getSession` → fetch profilo + cache; fallback `metadata.currentUser` se offline.
- `logout()`: `supabase.auth.signOut()` + azzera `metadata.currentUser`.
- `onAuthStateChange`: listener Supabase per sincronizzare stato sessione.
- Ruoli:
  - `isAdmin(user) = user.role === 'admin'`.
  - `updateUserRole(userId, role)`: update su `profiles` (solo admin).
- `getAllUsers()`: fetch da `profiles` (admin); fallback locale solo utente corrente.
- `createUser` / `deleteUser`: non implementati lato client (richiedono Admin SDK lato server/Edge Function).
- `sendPasswordResetEmail(email)` → `supabase.auth.resetPasswordForEmail`.
- `updatePassword(newPassword)` → `supabase.auth.updateUser`.

### 5.3 Migrazione forzata (`src/lib/forcedMigration.ts`)
Vedi §4.4 step 1. Triggerata da bump di `FORCED_RESET_VERSION`. Usata storicamente per forzare il wipe dopo cambi schema incompatibili.

### 5.4 Componenti correlati
- `PasswordReset.tsx`: form per impostare nuova password dopo click su email recovery (deep-link `#type=recovery`).

---

## 6. Flusso mappatura attraversamenti

### 6.1 `MappingWizard.tsx` (componente attivo, cablato in `App.tsx`)
Wizard a **3 step** (`type Step = 0 | 1 | 2`). Stato locale ricco; il salvataggio è atomico (tranne la "bozza planimetria" — vedi 6.1.4).

#### 6.1.1 Step 0 — Posizione
Campi:
- Select **Piano** (`floor`) — ordinato numericamente, ultimo piano usato salvato in `localStorage`.
- Input **Stanza** (`roomNumber`) — visibile solo se `project.useRoomNumbering`.
- Input **Intervento n.** (`interventionNumber`) — visibile solo se `project.useInterventionNumbering`.

#### 6.1.2 Step 1 — Attraversamenti
Lista mutabile di `crossings: Crossing[]`. Per ogni riga:
- **Supporto** (select da `useDropdownOptions('supporto')`).
- **Tipo supporto** (select).
- **Attraversamento** (select), con input `attraversamentoCustom` se "Altro".
- **Tipologico** (select ordinato `getSortedTypologies`, filtro `category='attraversamento'`): al cambio auto-fill supporto/tipoSupporto/attraversamento; warning se `isTypologyCoherent` rileva incoerenza.
- **Quantità** (number).
- **Diametro** — visibile solo se `needsDiametro(attraversamento)`.
- **Dimensioni** — visibile solo se `needsDimensioni(attraversamento)`.
- **Note** (textarea).
- Toggle **"In asola"** → campi `asolaB`, `asolaH` (cm) + display `calcAsolaMq(b,h)` mq (min 0,2).
- Bottoni "Aggiungi attraversamento" (pre-compila l'ultima riga, tranne `attraversamento`) e "Rimuovi" (≥1 sempre).

#### 6.1.3 Step 2 — Foto
- Input nascosti `cameraInputRef` (`capture="environment"`) e `fileInputRef`.
- `handleImageChange`: validazione + `FileReader` per anteprima + tracciamento `photoIds` (null per nuove, string per esistenti).
- Compressione **al submit** (non immediata): `imageCompression` con `maxSizeMB: 1`, `maxWidthOrHeight: 1920`, batch concorrente (concurrency 3).
- **Posizionamento su planimetria** (`handleOpenFloorPlanEditor`): apre `FloorPlanEditor` in modalità `mapping` (1 punto per entry).
- Select **EI rating** (30/60/90/120/180/240).
- Toggle **"Da completare"** (`toComplete`).

#### 6.1.4 Meccanismo bozza
Per posizionare un punto su planimetria **prima** del submit, il wizard crea una entry-bozza:
- `savedDraftEntry: MappingEntry | null` (ref `savedDraftEntryRef`).
- `finalizedRef: boolean` — true dopo salvataggio finale.
- `useEffect` di unmount: se `savedDraftEntryRef.current && !finalizedRef.current` → `deleteMappingEntry(draft.id)` (cleanup bozza orfana).

#### 6.1.5 Navigazione
- Step indicator nell'header (bottoni cliccabili per salto).
- `history.pushState({__wizardStep: step})` ad ogni cambio step → tasto back Android naviga tra step invece di chiudere il wizard.
- Footer: "Indietro" (disabilitato a step 0) / "Avanti" (diventa "Salva" a step 2).

#### 6.1.6 Salvataggio (`handleSubmit`)
1. Comprime solo foto nuove: `photoFiles.slice(initialPhotoCount)` con `imageCompression`.
2. Branch:
   - **Editing/bozza esistente**: `updateMappingEntry(id, updates, userId)` → `updateFloorPlanLabelsForMapping` (rinomina etichette puntate) → loop `removePhotoFromMapping(photoId)` per `photosToRemove` → loop `addPhotosToMapping(entryId, blob, metadata)` per le nuove.
   - **Nuova entry**: `createMappingEntry(data, photoBlobs[])`.
3. `finalizedRef.current = true` (blocca cleanup bozza in unmount).
4. Callback `onSaved()` (App fa bump key + reset state) o `onBack()`.

### 6.2 `MappingPage.tsx` (variante full-page, legacy)
Componente "monolitico scorrevole" alternativo al wizard. **NON cablato in `App.tsx`** corrente. Stessa entità + stessa logica di compressione/bozza/planimetria, ma senza step indicator (tutto su una pagina). Da valutare se rimuovere nel rewrite.

### 6.3 DB layer (`src/db/mappings.ts`, ~750 LOC)

#### CRUD principali
- **`createMappingEntry(mappingData, photoBlobs)`**:
  1. `id = generateId()`, `timestamp = now()`.
  2. Crea `MappingEntry` (version 1, synced 0, lastModified=timestamp, modifiedBy=createdBy).
  3. Per ogni blob: crea record `Photo` in `db.photos` con metadata `{width, height, size, mimeType, captureTimestamp}`.
  4. Aggiunge `SyncQueueItem {operation:'CREATE', entityType:'mapping_entry', payload: entry}`.
  5. `triggerImmediateUpload()` (debounce 2s).
- **`updateMappingEntry(id, updates, userId)`**:
  1. Incrementa `version`, aggiorna `lastModified = now()`, `modifiedBy = userId`.
  2. Upsert in `syncQueue`: cerca item pending stessa entityId → se trovato, aggiorna payload+timestamp; altrimenti insert nuovo UPDATE.
- **`deleteMappingEntry(id)`**:
  1. Cancella foto associate (`db.photos.where('mappingEntryId').equals(id).toArray()` → cancella).
  2. Cancella punti planimetria (`floorPlanPoints` con `mappingEntryId=id`) + 1 syncQueue DELETE per ogni punto (entityType `floor_plan_point`).
  3. Per foto già `uploaded:true` → syncQueue DELETE entityType `photo` con `payload.storagePath` (per cleanup remoto).
  4. Cancella `mappingEntry` + syncQueue DELETE `mapping_entry`.

#### Query
- `getMappingEntry(id)`, `getMappingEntriesForProject(projectId, {floor?, sortBy?, limit?})`.
- `getPhotosForMapping(entryId)` / `getPhotosForMappings(entryIds[])` (ritorna `Record<entryId, Photo[]>`).
- `addPhotosToMapping(entryId, blob, metadata)`, `removePhotoFromMapping(photoId)`.

#### Utility specifiche
- **`resequenceMappingInterventions(projectId)`**: per ogni gruppo `(floor, room)`, riordina cronologicamente gli `intervention` numerici progressivi e aggiorna le label dei punti via `buildFloorPlanLabel` + `updateFloorPlanLabelsForMapping`.
- **`ensurePhotoBlob(photoId)`**: idratazione lazy del blob da Storage se non presente localmente (download via `remoteUrl` o `storagePath` con signed URL).
- **`signPhotoPaths(paths: string[])`**: genera signed URL in batch (max 500/batch — limite Supabase).

#### Pattern online-first (uniforme su tutto il DB layer)
Tutte le `get*` seguono questo schema, implementato sopra `src/db/onlineFirst.ts`:
```ts
async function getEntries(projectId) {
  if (isOnlineAndConfigured()) {
    try {
      // 1. Fetch remoto
      const remote = await supabase.from('mapping_entries').select(...).eq('project_id', projectId);
      const localItems = remote.map(convertRemoteToLocalMapping);
      // 2. Calcola pending IDs (entityType 'mapping_entry', synced=0, retryCount<5)
      const pendingIds = await getPendingEntityIds('mapping_entry', f => f.payload.projectId === projectId);
      // 3. Write-through: persiste in Dexie SOLO se non pending
      await writeThroughCache(localItems, pendingIds, db.mappingEntries, mergeLocalFields, stripForPersistence);
      // 4. Overlay queue: applica DELETE/CREATE/UPDATE pending sopra i dati remoti
      return applyPendingWrites(localItems, 'mapping_entry', f => f.payload.projectId === projectId);
    } catch (err) {
      if (isAuthError(err)) throw err;
      // 5. Fallback IndexedDB
    }
  }
  return db.mappingEntries.where('projectId').equals(projectId).toArray();
}
```

Il codice esatto di `onlineFirst.ts`:
- **`getPendingEntityIds(entityType, filter?)`**: filtra `syncQueue` per `entityType + synced=0 + retryCount<5`. Se `filter` fornito, include sempre i DELETE + applica filter agli altri.
- **`applyPendingWrites(remote, entityType, filter)`**: ordina pending per `timestamp` crescente. Per ogni item: DELETE → rimuove da `resultMap`; CREATE/UPDATE → `resultMap.set(entityId, payload)`. Ritorna `Array.from(resultMap.values())`.
- **`writeThroughCache(remote, pendingIds, table, mergeLocalFields?, stripForPersistence?)`**: per ogni `remoteItem` ottiene il record esistente (se `mergeLocalFields` definito), applica merge, ritorna l'item per la UI, **e persiste in Dexie solo se `!pendingIds.has(remoteItem.id)`** (per non sovrascrivere modifiche pending).
- **`isAuthError(err)`**: `status===401 || status===403 || code==='PGRST301' || message.includes('JWT')`.

---

## 7. Flusso strutture

Vedi `StructureWizard.tsx` + `src/db/structures.ts`. Speculare a §6 ma per strutture edili.

### 7.1 Step Wizard
- **Step 0 — Posizione**: come MappingWizard (piano/stanza/intervento auto max+1 per piano).
- **Step 1 — Strutture** (lista `structures: Structure[]`):
  - Bottone "Gestisci tipologici" → apre `TypologyViewerModal` filtrato per `category='struttura'`.
  - Per card struttura:
    - Select **Tipologico** (filtro `category='struttura'`) → auto-compila campi struttura.
    - Info read-only (marca prodotti) se presente.
    - Select **Struttura** (`Parete | Soffitto | Cassonetto porta-impianto | Altro` + campo custom).
    - Select **Tipo struttura** (Flessibile / Rigido / ...).
    - Input **Base** (m) + **Altezza** (m) → display **Superficie** auto-calcolata (`base × altezza`) in badge verde.
    - Input **Lunghezza** (ml, per cassonetti).
    - Input **Note**.
    - Bottone "Rimuovi" (se ≥1).
  - Bottone "Aggiungi struttura".
- **Step 2 — Foto**: come MappingWizard ma:
  - Posizionamento su planimetria di default in modalità **`perimetro`** (poligono).
  - Toggle "Da completare".
  - Footer "Salva" disabilitato durante compressione (mostra "Compressione foto X/Y").

### 7.2 Differenze chiave da Mapping
- Oggetto: edile (pareti/soffitti) vs attraversamento (tubi/cavi).
- Geometria: `base × altezza → superficie` (mq), `lunghezza` (ml) — vs `diametro`, `quantità`, `dimensioni`.
- Tipologici: `category='struttura'` vs `'attraversamento'`.
- Punto planimetria: tipicamente **perimetro** (poligono) vs punto singolo.

### 7.3 DB layer (`src/db/structures.ts`, ~597 LOC)
CRUD `createStructureEntry`, `updateStructureEntry`, `deleteStructureEntry`, `getStructureEntry`, `getStructureEntriesForProject` — pattern identico a `mappings.ts`. Foto condivise nella stessa tabella `photos` ma con `entryType: 'structure'`.

---

## 8. Editor planimetrie

Due componenti principali (totale ~3200 LOC), il cuore grafico dell'app.

### 8.1 `FloorPlanCanvas.tsx` (~1574 LOC) — rendering imperativo
**Pipeline `render()` (ordine di disegno)**:
1. `ctx.drawImage()` — immagine scalata per `zoom`/`pan`.
2. `drawGrid()` — linee tratteggiate, applicato `offsetX/Y` + `rows`/`cols`.
3. `drawPoint()` — cerchio colorato per tipo:
   - `parete` → `#0066FF`
   - `solaio` → `#00CC66`
   - `perimetro` → `#FF6600`
   - `generico` → `#9933FF`
4. `drawConnectingLine()` — tratteggio `[3,3]` tra `pointX/Y` e bordo etichetta più vicino.
5. `drawLabel()` — rettangolo con padding 8px, font 14px, supporta `labelBackgroundColor` e `labelTextColor`; bordo colorato derivato da `EI_COLORS[eiRating]`.
6. `drawEiLegend()` — box "Legenda PPA" con riquadri colorati per ogni `eiRating` usato.
7. `drawCartiglioPreview()` — replica layout del cartiglio PDF (tavola, tipologie numerate, dati installatore, committente, locali, scala, box firma). Scaling: `baseScale * userScale * zoom`.

**Sistema di coordinate**:
- Tutto è **normalizzato `[0,1]`** rispetto all'immagine originale.
- `normalizedToCanvas(nx, ny)` → pixel canvas con `zoom`/`pan`.
- `canvasToNormalized(cx, cy)` → inversa con `clamp [0,1]`.

**Tipi di punto** (`CanvasPoint`):
```ts
{
  id: string;
  type: 'parete' | 'solaio' | 'perimetro' | 'generico';
  pointX, pointY: number;       // marker
  labelX, labelY: number;       // etichetta
  labelText: string[];          // righe di testo etichetta
  perimeterPoints?: {x,y}[];    // vertici per perimetro
  customText?: string;          // per generico
  mappingEntryId?: string;
  labelBackgroundColor?: string;
  labelTextColor?: string;
  eiRating?: 30|60|90|120|180|240;
}
```

**Hit detection** (`findPointAt(cx, cy)`):
- Priorità: prima label (rettangolo da `ctx.measureText`), poi punto (raggio 10px).

**Drag/Snap label**:
- `snapToGrid()` → aggancia `labelX/Y` alla griglia quando `gridConfig.enabled`.

**Perimetro**:
- Stato `isDrawingPerimeter` + `perimeterPoints[]`.
- Click → aggiunge vertice; preview linea fino a `currentMousePos`.
- Chiusura: doppio click o Enter → callback `onPointAdd` con `type='perimetro'`.
- Ref imperative esposte: `completePerimeter()`, `cancelPerimeter()`.

**Zoom/Pan/Touch**:
- `handleWheel()` → zoom centrato sul cursore (delta normalizzato).
- `handleTouchStart/Move/End`:
  - 1 dito → pan.
  - 2 dita → `getTouchDistance` (zoom factor) + `getTouchCenter` (pan).
- Tool 'pan' (modalità esplicita) o drag su area vuota (modalità implicita).

**Overlay interattivi**:
- **EI Legend**: draggable se `onEiLegendMove` fornito; hit test `isPointOnEiLegend`.
- **Cartiglio**: draggable con **clamp asimmetrico** (X limitato dentro l'immagine, Y può uscire dal bordo inferiore); hit test `isPointOnCartiglio`.

### 8.2 `FloorPlanEditor.tsx` (~1616 LOC) — UI e orchestrazione

**Modalità** (`mode` prop):
- `'mapping'` — collegato a `mappingEntry` (massimo 1 punto per entry).
- `'standalone'` — file libero (no progetto), export PDF.
- `'view'` — sola lettura.
- `'view-edit'` — modifica etichette, aggiunta generico/perimetro, riordino entry.

**Toolbar**:
- Navigazione: 'pan', zoom +/-, rotazione 90° (`handleRotate`).
- Strumenti: 'move', 'parete', 'solaio', 'perimetro', 'generico'.
- Azioni:
  - **Colora** (`activeTool='color-picker'`) → apre `ColorPickerModal` per multi-selezione di punti, applica `labelBackgroundColor`/`labelTextColor`.
  - Dropdown **EI** → `handleApplyEiRating` sui punti selezionati.
  - **Elimina** punto selezionato.

**Pannelli laterali**:
- **Sinistra** (`showLeftMenu`):
  - **Griglia**: toggle, righe/colonne, offset X/Y.
  - **Visualizzazione**: toggle EI Legend, toggle Cartiglio.
  - **Editor Cartiglio**: campi tavola, tipologie (visibilità per numero), committente, locali, scala.
  - **Standalone**: bottone export PDF.
- **Destra** (`showRightMenu`):
  - Lista **`unmappedEntries`**: entry del piano corrente non ancora posizionate. Click → seleziona per posizionamento.
  - Lista **punti posizionati**: checkbox multi-select.
  - Ordinamento: `'none'`, `'asc'`, `'desc'`, `'recent'`.
  - Bottone **"Riordina punti"** → `handleReorderPoints`: ordina per coordinata X crescente e rinumera gli interventi via `resequenceMappingInterventions`.

**Collegamento mappingEntry/structureEntry**:
- `UnmappedEntry { id, labelText[], type: 'parete'|'solaio' }`.
- `handleUnmappedEntryClick(entryId)` → setta `selectedUnmappedId` + tool corrispondente.
- `handlePlaceUnmappedEntry()` → click su canvas crea `CanvasPoint` con `mappingEntryId` linkato e rimuove dalla lista unmapped.
- `onOpenMappingEntry(entryId)` (callback verso App) → naviga al wizard mappatura/strutture.

**Rotazione**:
- Stato `rotation: 0|90|180|270`.
- `useEffect` su `imageUrl`/`rotation` → genera `rotatedImageUrl` via canvas temporaneo + `URL.createObjectURL`.
- Cleanup revoca object URL al smontaggio.

**Export PDF** (`handleExportPDF`):
1. Se `onExportPDFProp` (callback custom) → la chiama.
2. Altrimenti → `exportFloorPlanVectorPDF(imageBlob, exportPoints, pdfBlobBase64?, rotation?, eiLegendPosition?, buildExportCartiglio())`.
3. `buildExportCartiglio()` prepara oggetto con `positionX/Y`, `scale`, campi testo, `visibleTypologyNumbers`.

### 8.3 `src/utils/floorPlanUtils.ts` (~566 LOC)

#### Processing input
- **`processFloorPlan(file)`** orchestrazione:
  - Se PDF → `pdfToPng(file)` (PDF.js da CDN, render pagina 1 a scale 2×).
  - Se immagine → `imageToPng2x(file)` (canvas upscale 2×).
  - `generateThumbnail()` → `browser-image-compression` a max 512px.
  - Ritorna `{fullRes, thumbnail, width, height, originalFormat, pdfBlob?}`.

#### Upload Storage (versione Supabase)
- `uploadFloorPlan(projectId, floor, fullResBlob, thumbBlob, mime)` → bucket `planimetrie`, path `{projectId}/{floor}/`.
- `uploadStandaloneMap(userId, mapId, blob, ...)` → path `standalone/{userId}/{mapId}/`.
- `uploadFloorPlanPDF()` / `uploadStandaloneMapPDF()` → conserva PDF originale (signed URL via `createSignedUrl` con TTL 10 anni `315360000`).

#### Serializzazione blob
- `blobToBase64(blob)` → per IndexedDB (strip data-uri prefix).
- `base64ToBlob(base64, mimeType)` → ricostruzione Blob.

#### Utility
- `deleteFloorPlan(projectId, floor)` → rimuove fullres + thumbnail + PDF dallo storage.
- `downloadFloorPlanImage(url)` → fetch blob da URL pubblico.

---

## 9. Esportazioni (Excel, ZIP, PDF)

### 9.1 Hook orchestratore `useMappingExports.ts` (~581 LOC)
```ts
useMappingExports({project, mappingEntries, structureEntries, floorPlans, photos, currentUser})
  → { isExporting, isUpdatingLabels, handleExportExcel, handleExportZip, handleExportFloorPlan, handleUpdateAllLabels }
```

### 9.2 Export Excel (XLSX, SheetJS)
3 fogli generati con `XLSX.utils.book_new() + sheet_add_aoa`:

#### Foglio **"Mappings"**
Una riga per `crossing`. Colonne **condizionali**:
- `Piano` (solo se `project.floors.length > 1`)
- `Stanza` (solo se `project.useRoomNumbering`)
- `Intervento N.` (solo se `project.useInterventionNumbering`)
- `N. foto`, `Supporto`, `Tipo supporto`, `Attraversamento`, `Quantità`, `Diametro`, `Dimensioni`, `Tipologico`, `Note`, `Data`, `Ora`, `User`.
Se `crossings.length === 0`: una riga con campi attraversamento = `'-'`.

#### Foglio **"Tipologici"**
`Numero | Supporto | Tipo Supporto | Attraversamento | Marca Prodotto | Prodotti Selezionati`.

#### Foglio **"Strutture"**
Stessa logica gerarchica di Mappings con campi: `Struttura | Tipo struttura | Base | Altezza | Superficie (mq) | Lunghezza (ml)`.

### 9.3 Export ZIP (JSZip)
Struttura:
```
{progetto}_{data}.zip
├── {progetto}_dati.xlsx
├── Piano X/
│   ├── Stanza Y/
│   │   ├── {prefix}01.jpg
│   │   ├── {prefix}02.jpg
│   │   └── ...
├── Strutture/
│   └── Piano X/Stanza Y/...
└── Planimetrie/
    ├── Piano_-1_annotato.pdf
    ├── Piano_0_annotato.pdf
    └── ...
```
- **Naming foto**: `{prefix}{NN}.jpg`, con `prefix = generatePhotoPrefix(floor, room, intervention)` e `NN` = progressivo 2 cifre.
- **Gerarchia cartelle**: condizionale su `floors.length > 1`, `useRoomNumbering`, etc.
- **PDF planimetrie**: generati via `buildPreparedFloorPlanPdf` (preparazione asincrona) + `exportPreparedFloorPlanPdf`.

### 9.4 Export PDF planimetria vettoriale (`exportUtils.ts`, ~1044 LOC)
Costruzione tramite **`pdf-lib`**.

#### Sfondo
- **Raster**: `embedPng`/`embedJpg` dell'immagine.
- **Vettoriale**: se `pdfBlobBase64` presente, usa `embedPage` del PDF originale + `drawPage` → output completamente vettoriale.

#### Rotazione
0/90/180/270, ricalcola `CropBox` e coordinate di inserimento.

#### Annotazioni vettoriali (`_drawAnnotationsOnPage`)
- **Punti**: cerchi `drawCircle({color, opacity})`.
- **Perimetri**: path SVG con `drawSvgPath(d, {borderDashArray:[10,5]})`.
- **Etichette**: `drawRectangle` con background/text color dinamici, `drawText` per ogni riga, bordo colorato se `eiRating` (`EI_COLORS[rating]`).
- **Linee guida**: `drawLine` con `dashArray:[3,3]` dal punto (o dal perimetro più vicino calcolato con `closestPointOnPolygon`) al bordo etichetta più vicino.
- **Legenda PPA**: box opzionale (`eiLegendPosition: {x,y}`) con riquadri colorati per ogni `eiRating` usato.

#### Cartiglio (`drawCartiglio`, `buildCartiglioLayout`)
- Sezione **TAVOLA** (rettangolo con bordo rosso `#e1543c`).
- **Tipologie**: lista numerata da `typologyNumbers[]`, wrap testo + colonne prefisso/valore.
- **Info installatore**: hardcoded `CARTIGLIO_INSTALLER_LINES` (Opi Firesafe).
- **Campi liberi**: Committente, Locali.
- **Box firma**: rettangolo separato.
- **Scaling dinamico**: `scale = baseScale * userScale`.
- **Overflow detection** (`computeCartiglioOverflow`): se il cartiglio sborda sotto l'immagine, la pagina si estende verticalmente.

#### API esportate
- `buildFloorPlanVectorPDF(imageBlob, points, pdfBlobBase64?, rotation?, eiLegendPosition?, cartiglio?) → Promise<Uint8Array>`
- `exportFloorPlanVectorPDF(..., filename)` — wrapper con download automatico.

---

## 10. Contabilità e SAL

### 10.1 `CostsTab.tsx` (~1465 LOC)

#### Calcolo costi
- **Attraversamenti**: `pricePerUnit × quantità` (`unit: piece` o `sqm`).
- **Asola**:
  - `quantity` in mq parsato da `parseDimensioniMq()` (formato testuale "0,2mq"); altrimenti
  - `calcAsolaMq(asolaB, asolaH)`; altrimenti `0.2` default.
  - Usa chiave speciale `ASOLA_KEY` (separato dal prezzo dell'attraversamento principale).
- **Strutture**: `quantity = superficie` (mq), `unit` sempre `sqm`.

#### Raggruppamenti
- `GroupBy = 'floor' | 'tipologico' | 'supporto' | 'attraversamento'`.
- `grouped` Map con chiavi di gruppo.
- `groupedSummaryRows` aggrega per label primaria/secondaria/dettaglio (es. attraversamento → tipologico → piano).
- Ordinamento numerico-naturale: `Intl.Collator('it', {numeric: true})`.

#### UI tabella
- Header espandibile (`ChevronDown`) con toggle `collapsedGroups` (scope chiave `${groupBy}::${selectedSalId}::${groupKey}`).
- Colonne: *Voce* (attraversamento/asola), *Dettaglio* (tipologico), *Info* (piano/supporto), *Qta*, *UM* (pz/mq), *Prezzo unit.*, *Totale*.
- Badge **"da completare"** se `row.toComplete`.
- Footer: totale gruppo, totale SAL (`grandTotal`), cumulativo SAL precedenti (`cumulativePriorTotal` + strutture).

#### Export Excel dei costi
3 fogli: "Riepilogo", "Dettaglio", "Strutture" con formattazione valuta `#,##0.00 [$€-it-IT]` e autofilter.

### 10.2 Prezzi (`src/db/pricing.ts`)
- **Chiavi**:
  - Attraversamenti: `buildPriceConfigKey(attraversamento, tipologicoId) = "{attraversamento}::{tipologicoId}"` (o solo `attraversamento` se `tipologicoId` assente).
  - Strutture: `buildStructurePriceKey(struttura, tipologicoId) = "struttura::{struttura}::{tipologicoId}"`.
- **Operazioni**:
  - `getTypologyPrices(projectId)`: fetch Supabase → `writeThroughCache` + `applyPendingWrites`; fallback offline.
  - `upsertTypologyPrice(...)`: cerca su indice composto `[projectId+attraversamento+tipologicoId]` (o senza `tipologicoId`); UPDATE se trovato, CREATE altrimenti. Accoda syncQueue.
  - `deleteTypologyPrice(id)`: rimozione + sync.

### 10.3 SAL (`src/db/sal.ts`)
- `getSalsForProject(projectId)`: ordina per `number` crescente; online-first.
- `createSal(projectId, data)`: calcola `maxNumber+1` (lookup `getSalsForProject`), insert locale + syncQueue.
- `updateSal(id, {name?, date?, notes?})`.
- `deleteSal(id)`: **transazione `rw` su 4 tabelle** (`mappingEntries`, `structureEntries`, `sals`, `syncQueue`):
  1. Rimuove `salId` da ogni `crossing` in MappingEntry (loop + update + syncQueue UPDATE).
  2. Rimuove `salId` da ogni `structure` in StructureEntry.
  3. Cancella SAL + syncQueue DELETE.
- **Assegnazione**:
  - `assignCrossingsToSal(projectId, salId, userId, includeToComplete=false)`: itera MappingEntry, setta `crossing.salId` sui non assegnati (escludendo `toComplete` se flag false), accoda UPDATE.
  - `assignStructuresToSal`: analogo.
  - Entrambe chiamano `enqueueMappingEntryUpdate`/`enqueueStructureEntryUpdate` + `triggerImmediateUpload()`.

### 10.4 `SalTab.tsx` (~366 LOC)
- Lista SAL ordinata per data decrescente.
- Stato: `sals`, `unassignedCount` (crossings), `unassignedStructuresCount`, `toCompleteUnassignedCount`, `salItemsMap` (conteggio per SAL).
- Form creazione/modifica: `formName`, `formDate` (ISO `YYYY-MM-DD`), `formNotes`. Chiamate `createSal`/`updateSal`; date convertite in timestamp ms.
- Azioni: **Assegna** (`handleAssignCrossings` chiama entrambi `assignCrossingsToSal` + `assignStructuresToSal`; stato `assigning` per spinner), **Assegna "da completare"** (`includeToComplete=true`), **Elimina** (con conferma inline).
- Indicatori: alert giallo se elementi non contabilizzati, alert arancione per `toCompleteUnassignedCount`. Bottone disabilitato se `unassignedCount === 0 && unassignedStructuresCount === 0`.

---

## 11. Motore di sincronizzazione

### 11.1 `syncEngine.ts` (~853 LOC) — orchestratore

#### Lock & scheduling
- `acquireSyncLock()` / `releaseSyncLock()`: lock timestamp-based (timeout **3 minuti**, chiave `isSyncing` in `metadata` table).
- `lockedSync()`: wrapper atomico → `processSyncQueue()` (upload) → `syncFromSupabase()` (download). **Solo se acquisisce il lock**.
- `startAutoSync(intervalMs=30000)` / `stopAutoSync()`: timer che chiama `lockedSync()`.
- `triggerImmediateUpload()`: debounce **2s** per raggruppare modifiche ravvicinate.

#### Deduplicazione coda
`deduplicateSyncQueue()`: raggruppa per `${entityType}:${entityId}`. Regole:
- **DELETE vince su tutto** (se c'è un DELETE nel gruppo, tutto il resto si scarta).
- **CREATE+UPDATE → merge** del payload nel CREATE (mantiene operazione CREATE).
- **UPDATE multipli → solo l'ultimo** (per timestamp).
- Item deduplicati marcati `synced=1` (saltati) senza processarli.

#### Flussi
- `processSyncQueue()`: upload locale → Supabase. Retry esponenziale **max 5 tentativi**, backoff fino a **30s**. Item con `retryCount ≥ 5` → `synced=2` (fallimento permanente). Dopo successo, `clearSyncedItems()` rimuove `synced=1`.
- `syncFromSupabase()`: download metadati (progetti, entry, prezzi, planimetrie, punti, SAL, mappe standalone) **senza blob pesanti**.
- `phasedSyncFromSupabase()`: usato da `manualSync()`, 3 fasi:
  1. Dati metadata.
  2. Planimetrie (blob immagini).
  3. Foto (opzionali via callback utente).
- `manualSync({onPhotoDecisionNeeded, onProgress})`: upload poi download con callback `onProgress({step, totalSteps, phase, detail?})`; chiama `refreshDropdownCaches()`.
- `clearAndSync()`: reset completo (cancella IndexedDB tranne auth, svuota browser cache) → download full cache (inclusi blob).

#### Eventi
- `onSyncComplete(cb)` / `offSyncComplete(cb)`: registrazione listener.
- `emitSyncComplete(stats)`: notifica `SyncStats` (pendingCount, lastSyncTime, isSyncing).

#### Ordine operazioni
**SEMPRE upload prima di download** per evitare sovrascritture: locale modificato → push → pull remoto.

### 11.2 `syncUploadHandlers.ts` (~964 LOC) — outbox processor

Dispatcher `processSyncItem(item)` → switch su `entityType`.

| `entityType` | Handler | Cosa fa |
|--------------|---------|---------|
| `project` | `syncProject` | CREATE/UPDATE/DELETE su `projects`; `checkForConflicts` + `resolveProjectConflict` |
| `mapping_entry` | `syncMappingEntry` | Upsert su `mapping_entries`; post-upload accoda automaticamente le foto pending (1 syncQueue/foto non `uploaded`) |
| `structure_entry` | `syncStructureEntry` | Idem su `structure_entries` |
| `photo` | `syncPhoto` | Upload blob su Storage `photos`/{path} via `upload`; metadata upsert in tabella `photos`. Thumbnail upload separato |
| `floor_plan` | `syncFloorPlan` | Upload immagine + thumbnail + PDF via `floorPlanUtils.uploadFloorPlan*`. Pre-upload conflict check su `remoteUpdatedAt` |
| `floor_plan_point` | `syncFloorPlanPoint` | Upsert su `floor_plan_points`; risoluzione FK (`mapping_entry_id` vs `structure_entry_id`) |
| `standalone_map` | `syncStandaloneMap` | Upload blob/PDF; normalizzazione `gridConfig` + `points[]` |
| `sal` | `syncSal` | Upsert su `sals` |
| `typology_price` | `syncTypologyPrice` | Upsert su `typology_prices` |

### 11.3 `syncDownloadHandlers.ts` (~951 LOC) — puller

Funzioni per ogni tabella: `downloadProjectsFromSupabase`, `downloadMappingEntriesFromSupabase`, `downloadStructureEntriesFromSupabase`, `downloadTypologyPricesFromSupabase`, `downloadSalsFromSupabase`, `downloadFloorPlansFromSupabase`, `downloadFloorPlanPointsFromSupabase`, `downloadStandaloneMapsFromSupabase`, `downloadPhotosFromSupabase`.

**Batching**: `chunkArray(items, 150)` + `fetchRowsByIds()` per evitare URL troppo lunghi nei filtri `IN`.

**Pruning**: rimozione locale di entità non più presenti remote (es. `pruneProjectLocal`), escludendo ID in `pendingIds` (per non rimuovere CREATE pending non ancora uploadati).

**Foto**:
- `downloadPhotosFromSupabase({includeBlobs?: boolean})`:
  - `false`: scarica solo metadati.
  - `true`: `fetchStorageBlob(path)` (signed URL) o fallback `remoteUrl`.
- `updateRemotePhotosFlags()`: confronta foto locali (senza blob) vs remote; setta `hasRemotePhotos=true` su `mappingEntries` con foto remote non scaricate.

**Standalone maps**: idratazione lazy PDF (`downloadStoragePdfBase64`) + immagini. Preserva dati locali se `remoteUpdated <= localUpdated`.

### 11.4 `conflictResolution.ts` (~405 LOC)
- `ConflictResolutionStrategy = 'local-wins' | 'remote-wins' | 'last-modified-wins' | 'merge'`.
- Default: **`last-modified-wins`**.
- `checkForConflicts(entityType, entityId)`: fetch remoto + confronto versioni. Ritorna `{hasConflict, remote}`.
- `resolveProjectConflict(local, remote, strategy)` / `resolveMappingEntryConflict(...)`: applica strategia e chiama `logConflict`.
- `mergeProjects` / `mergeMappingEntries`: merge field-level (unione array `floors`, `plans`, `typologies`, `crossings`, `photos` senza duplicati).
- `logConflict()` → `db.conflictHistory.add({entityType, entityId, conflictType:'version'|'timestamp'|'both', localVersion, remoteVersion, resolvedVersion, strategy, autoResolved, userNotified})`.
- `convertRemoteToLocalProject` / `convertRemoteToLocalMapping`: mapping snake_case → camelCase.

### 11.5 `onlineFirst.ts` (~88 LOC, già citato)
Codice integrale già mostrato in §6.3.

---

## 12. Storage, PWA, service worker

### 12.1 Storage Supabase
- Bucket **`photos`** (privato): accesso in lettura via **signed URL** (`signPhotoPaths`, batch ≤500).
- Bucket **`planimetrie`** (pubblico in lettura): immagini + PDF accessibili direttamente.
- Compressione foto: ≤1MB / 1920px lato lungo via `browser-image-compression`.
- Planimetrie: raster 2× + thumbnail; PDF originale base64 (`pdfBlobBase64`) + `pdfUrl` per export vettoriale.

### 12.2 Service Worker (`public/service-worker.js`)
- Registrato in `src/serviceWorkerRegistration.ts`.
- Strategie cache (deducibili da pattern PWA standard): network-first per API, cache-first per asset statici versionati.
- Bump della versione SW → forza nuovo install → `UpdateNotification` mostra "Aggiorna Ora" → click → `clearAndSync()` (wipe + redownload) → reload.

### 12.3 PWA install
- Manifest standard CRA.
- `safe-area-inset` CSS per notch iOS/Android.
- `BottomTabBar` con padding bottom per safe area.

### 12.4 CSP
Definita in `vercel.json`. Ogni nuovo origin (script/connect-src) va aggiunto qui. **Importante per homeserver**: cambierà il `connect-src` per puntare al dominio Cloudflare del homeserver invece di Supabase.

---

## 13. Sicurezza e RLS (versione Supabase)

`supabase/schema.sql` (1043 righe) definisce:
- 12 tabelle: `profiles`, `projects`, `mapping_entries`, `structure_entries`, `photos`, `floor_plans`, `floor_plan_points`, `dropdown_options`, `products`, `sals`, `typology_prices`, `standalone_maps`.
- Trigger `update_*_updated_at` su ogni tabella.
- Trigger `update_projects_last_modified` (sincronizza `last_modified` con `updated_at`).
- Trigger `on_auth_user_created` (crea profilo all'avvenuta registrazione).
- Funzione helper `public.is_admin()` (controlla `profiles.role`).

### Pattern RLS per tabella
- **profiles**: utenti vedono/modificano il proprio profilo. Admin vede tutti.
- **projects**:
  - SELECT: `owner_id = auth.uid()` OR `accessible_users @> auth.uid()` OR admin.
  - INSERT: owner = `auth.uid()` OR admin.
  - UPDATE/DELETE: owner OR (UPDATE su accessibili) OR admin.
- **mapping_entries / structure_entries / photos / floor_plans / floor_plan_points / sals / typology_prices**: accesso derivato dalla tabella `projects` (verifica owner/accessible) + override admin.
- **standalone_maps**: per-utente (`auth.uid() = user_id`) + admin.
- **dropdown_options / products**: lettura per autenticati, scrittura admin.

### Storage policies (`storage-policies.sql`)
- Bucket `photos`: 4 policy (upload/view/update/delete) basate su accessibilità mapping entry derivata dal path (`{mapping_entry_id}/...`).
- Bucket `planimetrie`: read pubblico per autenticati, scrittura limitata.

---

## 14. Migrazione homeserver — cosa è stato fatto

> Branch `feature/migration-sprint6` (NON pushato secondo memoria progetto; cutover completato 2026-05-18, hardening in commit `885fa27d`+`b04a494c`). +21316 inserzioni, −1257 delezioni su 101 file. Memorie correlate: `project_homeserver_completion`, `project_homeserver_prod`, `project_hono_wildcard_bug`, `project_builder_uuid_cast`.

### 14.1 Stack server (`opimappa-server/`)

#### Docker Compose
| Servizio | Image | Porte / Volumi | Note |
|----------|-------|----------------|------|
| `postgres` | `postgres:17.4-alpine` | volume `/opt/opimappa/data/postgres` | healthcheck `pg_isready`, rete interna `opimappa_net` |
| `minio` | `minio/minio:RELEASE.2025-04-08...` | console `127.0.0.1:9001`, volume `/opt/opimappa/data/minio` | rete interna |
| `api` | build da `Dockerfile` | rete interna | healthcheck `curl :3000/health`, `read_only:true`, `tmpfs: /tmp` |
| `caddy` | `caddy:2.8.4-alpine` | `127.0.0.1:8080`, volumi config/data/logs/web (`/opt/opimappa/...`) | `read_only:true`, depends_on api healthy |
| `cloudflared` | `cloudflare/cloudflared:2025.4.0` | tunnel via `${TUNNEL_TOKEN}` | `read_only:true`, `cap_drop:[ALL]`, rete interna |

#### Caddyfile (reverse proxy)
- `auto_https off` (TLS terminata su Cloudflare edge).
- `:80` listener.
- `handle /api/events/stream` → proxy `api:3000` con `flush_interval -1` + `timeout 0` (SSE long-lived).
- `handle /api/*` → proxy `api:3000` (X-Real-IP, X-Forwarded-For).
- `handle *` → root `/srv/web`, `try_files` con SPA fallback, cache immutabile per `/static/*`, no-cache per `index.html` e `service-worker.js`.
- Headers: HSTS, CSP, X-Frame-Options, Referrer-Policy.

#### Postgres
- Versione 17.4 alpine. Volume bind-mounted.
- Estensioni richieste (deducibili): `uuid-ossp`, `pgcrypto`.

#### MinIO
- S3-compatible. Path style obbligatorio (`forcePathStyle: true`).
- Bucket attesi: `photos`, `planimetrie` (stesse policy semantiche di Supabase Storage).

### 14.2 Schema DB (Drizzle `opimappa-server/api/src/db/schema.ts`)

#### Schema better-auth (autorità identità)
- **`user`**: `id` (text PK), `name`, `email` (unique), `emailVerified`, `image`, `createdAt`, `updatedAt`, `role`, `banned`, `banReason`, `banExpires`.
- **`session`**: `id`, `expiresAt`, `token` (unique), `createdAt`, `updatedAt`, `ipAddress`, `userAgent`, `userId` (FK→user.id), `activeOrganizationId`, `impersonatedBy`.
- **`account`**: `id`, `accountId`, `providerId`, `userId` (FK), `accessToken`, `refreshToken`, `idToken`, `accessTokenExpiresAt`, `refreshTokenExpiresAt`, `scope`, `password`, `createdAt`, `updatedAt`.
- **`verification`**: `id`, `identifier`, `value`, `expiresAt`, `createdAt`, `updatedAt`.

**Differenze vs Supabase Auth**: schema completamente custom, NON estende `auth.users`. Aggiunge campi `ban*`/`role` su user, `impersonatedBy`/`activeOrganizationId` su session, password hashata in `account`.

#### Schema applicativo
Stesso delle 12 tabelle Supabase (vedi §13) — `projects`, `mapping_entries`, `structure_entries`, `photos`, `floor_plans`, `floor_plan_points`, `sals`, `typology_prices`, `standalone_maps`, `dropdown_options`, `products`. **Più**: tabella `change_log` (vedi §14.6).

#### Connessione (`db/client.ts`)
Driver `postgres` (postgres-js) + `drizzle-orm/postgres-js`. Env `DATABASE_URL` required. Export `sql` (client raw) + `db` (Drizzle).

### 14.3 API REST (emulazione PostgREST)

#### `index.ts` (entrypoint Hono)
- Porta: `process.env.PORT ?? 3000`.
- Middleware stack (ordine):
  1. Logger Pino (`method`, `path`, `status`, `durationMs`).
  2. `validateEmailDomain` (blocca email non-`@opifiresafe.com` su `POST /api/auth/sign-in/email`, `sign-up/email`, `admin/create-user`).
  3. `loginRateLimit` (rate limit IP+email; sleep esponenziale dopo 3 fail; Turnstile dopo 10 fail).
  4. `auditLog` (su `/api/auth/*`).
  5. Auth handler: `app.all('/api/auth/*', c => auth.handler(c.req.raw))` (delega a better-auth).
  6. `requireUser` (su `/api/*` escludendo `/api/auth/*`) → popola `c.get('user')` + `c.get('sessionId')`.
- Route mounting:
  - `app.route('/api', tables)` → CRUD entità.
  - `app.route('/api', sseRoute)` → realtime SSE.
  - `app.route('/api', changesRoute)` → realtime polling.
  - `app.route('/api/storage', storageRoute)` → storage.
  - `app.route('/api/storage', presignRoute)` → presigned URL.
- Endpoint fissi:
  - `GET /health` → `{ok: true}`.
  - `GET /api/me` → `{id, email, role}` (richiede auth).
- Background: `initListener()` → connessione Postgres `LISTEN opimappa_changes`.

#### CRUD `routes/tables.ts` + `crud.ts`
Base path `/api/:tableName` con `:tableName ∈ TABLE_SCHEMA` (whitelist).

Metodi generati per ogni tabella (esclusa `profiles` da scrittura):
| Metodo | Endpoint | Note |
|--------|----------|------|
| GET | `/api/:tableName` | Lista con query PostgREST |
| POST | `/api/:tableName` | Create (201) |
| PATCH | `/api/:tableName` | Update; **richiede filtro selettivo `id=eq.` o `id=in.`** |
| DELETE | `/api/:tableName` | Delete; **richiede filtro selettivo** |
| PUT | `/api/:tableName` | Upsert (insert se id nuovo, update se esistente; su update non-admin verifica proprietà) |

**Guardie**:
- `adminWriteGuard(tableName, handler)`: su `dropdown_options`/`products` ritorna 403 se non admin.
- `sanitizeBody(tableName, input)`: filtra `writableCols` (esclude `readOnly` come `*_storage_path`), aggiunge `id` (UUIDv4), `created_at`, `updated_at`.
- `sanitizePatchBody`: idem ma esclude `id`, aggiorna solo `updated_at`.
- `ensureScopedMutationAllowed(tableName, body, userId, role)`: pre-mutazione verifica che `project_id` (o parent via FK) sia accessibile (403 altrimenti).
- `hasSelectiveIdFilter(filters)`: valida PATCH/DELETE per impedire mass-update/delete.
- `withOriginatorTransaction(c, work)`: wrap in transazione con `SET LOCAL opimappa.originator_session = <sessionId>` (audit trail + suppression eco realtime).
- **Coercizione owner**: su `projects` / `standalone_maps` forza `owner_id` / `user_id = user.id` in POST e in INSERT del PUT.

**Risposta**: mutazioni con `RETURNING *`, formato `{data: [...], error: null}` (`return=representation`).

#### Esempi URL
```
GET    /api/mapping_entries?select=id,room,floor&project_id=eq.<uuid>&order=last_modified.desc&limit=50
GET    /api/mapping_entries?select=*,project!inner(title)&project.owner_id=eq.<uuid>
PATCH  /api/mapping_entries?id=eq.<uuid>          body: {"room":"Kitchen"}
DELETE /api/mapping_entries?id=in.(uuid1,uuid2)
PUT    /api/projects                              body: {"id":"uuid","title":"X"}    (upsert)
```

#### Query layer (`query/parser.ts` + `builder.ts` + `schema.ts`)
- `parseQuery(tableName, params)` → `QueryPlan {select, filters, order, limit, offset, countMode, headMode}`.
- **Select** (`parseSelect`):
  - `select=*` → tutte le colonne.
  - `select=col1,col2` → specifiche.
  - `select=rel!inner(cols)` / `!left` → join (es. `project!inner(title)`).
- **Filtri** (`parseFilters`): sintassi `colonna=operatore.valore`.
  - Operatori: `eq`, `neq`, `in`, `gte`, `lte`, `gt`, `lt`, `is`, `like`, `ilike`.
  - `in`: lista `(uuid1,uuid2)`.
  - `is`: `null`, `not.null`, `true`, `false`.
  - Join filter: `rel.col=op.value` (es. `project.title=eq.Foo`).
- **Ordinamento** (`parseOrder`):
  - `order=col.asc` / `col.desc` / `.nullsfirst` / `.nullslast`.
  - Default stabilità: se `limit`/`offset` senza `order` → `ORDER BY id ASC` auto.
- **Paginazione & count**: `limit=N` (max 1000), `offset=N`, `count=exact` (totalCount in risposta), `head=true` (solo count, righe vuote).
- **Builder** (`builder.ts`):
  - `quoteIdent(id)`: valida `[a-z_][a-z0-9_]*`, wrappa in `"..."`.
  - `addFilter(filter, build)`:
    - `in` → `col = ANY(ARRAY[$1,$2]::uuid[])` (cast tipo appropriato — vedi [[project_builder_uuid_cast]]).
    - `is` → `IS NULL` / `IS NOT NULL` / `IS TRUE` / `IS FALSE`.
    - Altri → `col OP $N`.
  - `buildWhere`: combina `addScope` (RLS) + filtri client.
  - `executeQuery`: `SELECT ... WHERE ... ORDER BY ... LIMIT ... OFFSET ...` o `COUNT(*)` se `countMode`.

#### Autorizzazione (`query/scope.ts`)
`addScope(tableName, userId, role, whereClauses, values)` inietta condizioni WHERE:

| Categoria | Tabelle | Condizione |
|-----------|---------|------------|
| Admin | qualsiasi | nessun filtro |
| `GLOBAL_TABLES` | `dropdown_options`, `products` | nessun filtro (in lettura) |
| `USER_ID_TABLES` | `standalone_maps` | `user_id = $userId` |
| `PROJECT_SCOPED_TABLES` | `mapping_entries`, `structure_entries`, `floor_plans`, `sals`, `typology_prices` | `project_id IN (SELECT id FROM projects WHERE owner_id = $userId OR (accessible_users)::jsonb ? $userId)` |
| (speciali) | `floor_plan_points` | scope via `floor_plan_id` → `floor_plans` → `projects` |
| (duali) | `photos` | scope via `mapping_entry_id` OR `structure_entry_id` (entrambi i percorsi verificano accesso progetto) |
| (radice) | `projects` | `owner_id = $userId OR (accessible_users)::jsonb ? $userId` |

`ensureScopedMutationAllowed` (in `crud.ts`): pre-INSERT/UPDATE verifica che il `project_id` (o parent) sia nello scope (previene FK injection a progetti altrui).

### 14.4 Auth server (`auth/config.ts` + `auth/middleware.ts`)
- **better-auth** + `drizzleAdapter(pg)` + `admin` plugin.
- Cookie: `__Host-opimappa-*` (Secure, SameSite Lax, Path `/`).
- Sessione: 30 giorni (`expiresIn: 2592000`), refresh ogni 24h (`updateAge`).
- `auth.api.getSession({headers})`: verifica firma/claims, estrae `user.id`, `email`, `role`.
- `requireUser` middleware: protezione route; setta `Context Variables` `user` e `sessionId`.
- `loginRateLimit`: rate limit per IP+email; sleep esponenziale dopo 3 tentativi; **Turnstile verification dopo 10 fail**.
- `auditLog`: logging su tabella `auth_audit_log` (`userId`, `event`, `ip`, `userAgent`, `success`).
- `validateEmailDomain`: enforce `@opifiresafe.com` su sign-in/sign-up/admin-create.

### 14.5 Storage server (`storage/minioClient.ts` + `presign.ts` + `signedUrl.ts`)
- `getMinioClient()`: istanza `S3Client` con `forcePathStyle: true`.
- Costanti: `BUCKET_PHOTOS`, `BUCKET_PLANIMETRIE`, set `VALID_BUCKETS`.
- **`POST /api/storage/upload-presigned`**:
  - Detection client Tailscale (CIDR `100.64.0.0/10`): ritorna **presigned PUT diretto** su MinIO (TTL max 24h) via `getSignedUrl(s3, new PutObjectCommand(...))`.
  - Client esterni: ritorna **endpoint proxy** `/api/storage/proxy-upload` con chunk size 5MB.
- **`POST /api/storage/proxy-upload`**: upload server-side per client esterni (max 50MB), `PutObjectCommand` diretto a MinIO.
- **`POST /api/storage/sign-read`** / **`/sign-one`**: presigned GET per download. `getSignedReadUrl(bucket, storagePath, ttlSec)`.
- ACL: `userCanAccessStoragePath(bucket, key, userId, role)` → verifica permessi (deriva dal `mapping_entry_id`/`structure_entry_id`/`project_id` nel path) PRIMA di generare URL.

### 14.6 Realtime SSE (`realtime/*`)

#### Backbone Postgres
- Tabella **`change_log`**: `seq BIGSERIAL`, `table_name`, `row_id`, `op` (`INSERT|UPDATE|DELETE`), `project_id`, `user_id`, `originator` (session id), timestamps.
- Trigger su tutte le tabelle applicative → INSERT in `change_log` + `pg_notify('opimappa_changes', NEW.seq::text)`.

#### `listener.ts`
- `initListener()`: connessione `postgres.js` con `LISTEN opimappa_changes`; payload = `seq` (bigint).
- `drainUntil(targetSeq)`: consumo batch da `change_log` da `lastNotifiedSeq+1` a `targetSeq` (guard concorrenza `draining`).
- `subscribe(fn)` / `subscribeSystem(fn)`: callback su righe o eventi sistema (`reconnected`, `connection_lost`).

#### `sseRoute.ts`: `GET /api/events/stream?sinceSeq=&tabId=`
- **Max 5 SSE per sessione** (`MAX_SSE_PER_SESSION`) con eviction oldest.
- **Echo suppression**: salta righe dove `originator == sessionId` (evita rimbalzare modifiche al client che le ha fatte).
- **Replay storico**: `sinceSeq` → query `change_log` dal seq richiesto.
- **Heartbeat** ogni 30s (keep-alive Caddy/Cloudflare).

#### `changesRoute.ts`
- `GET /api/changes?sinceSeq=`: REST polling fallback; **cursor expired check** → 410 se `sinceSeq < min_seq` del log (compactato).
- `GET /api/changes/head` → `{currentSeq}` (ultimo `lastNotifiedSeq`).
- Filtro `canSee` su ogni riga.

#### `visibility.ts`: `canSee(userId, role, row)`
- Admin: `true`.
- `project_id` null + tabella in `GLOBAL_TABLES`: `true` (dropdown_options).
- `project_id` null + `user_id` match: `true` (righe utente).
- `project_id` esistente: verifica `owner_id` o `(accessible_users)::jsonb ? userId`.

#### `projectCascade.ts` (server-side)
Stub: cascade effettiva gestita da FK Postgres (lato server) + da `handleProjectDeleteLocal` su Dexie (lato client, vedi §14.7).

### 14.7 Client shim (frontend → homeserver)

#### `src/lib/homeserver.ts` (85 LOC)
```ts
isHomeserverConfigured(): boolean = true                       // sempre true (same-origin)
apiFetch(path, init?): Promise<Response>                       // fetch con credentials:'include'
apiFetchJson<T>(path, init?): Promise<T>                       // guardia content-type + retry 502/503/504
ApiResponseError(status, url, message)
ApiNonJsonResponseError(status, contentType, url, bodySnippet) // evita SyntaxError quando Cloudflare cache restituisce HTML
RETRY_DELAYS_MS = [200, 500, 1000]                              // backoff esponenziale transient
```

#### `src/lib/storageShim.ts` (185 LOC) — **drop-in di `supabase.storage.from()`**
`apiStorageFrom(bucket)` ritorna oggetto con:
- `getPublicUrl(path)` → `{data: {publicUrl: '/api/storage/proxy/{bucket}/{key}'}}`.
- `createSignedUrl(path, ttl)` → `POST /api/storage/sign-one {bucket, path, ttl}` → `{data: {signedUrl}}`.
- `createSignedUrls(paths, ttl)` → Promise.all di `sign-one`, gestione fallimento totale vs parziale.
- `download(path)` → `GET /api/storage/proxy/{bucket}/{path}` → `{data: Blob}`.
- `remove(paths)` → `DELETE /api/storage/remove {bucket, paths}`.
- `upload(path, body, options?)`:
  1. `POST /api/storage/upload-presigned {bucket, key:path, ttl:3600}` → `{url, direct}`.
  2. Se `direct === true` (Tailscale) → **PUT diretto** all'URL MinIO presigned.
  3. Altrimenti (esterno) → **POST proxy** con `bucket`/`key` come query params.

`resolveBucketAndKey(defaultBucket, path)` gestisce prefissi legacy (`photos/xxx`, `planimetrie/yyy`).

#### `src/realtime/eventStream.ts` (205 LOC) — client SSE
- **`tabId`**: per-tab via `sessionStorage` (isolamento tra tab del browser).
- **`appliedSeq`**: cursore persistito in Dexie `realtimeState` (sopravvive ai refresh). BigInt.
- Connessione: `new EventSource('/api/events/stream?sinceSeq={appliedSeq}&tabId={tabId}', {withCredentials:true})`.
- Listener: `'change'`, `'system'`, `onerror` → reconnect (2s).
- **Deduplicazione**: `pendingByKey = Map<'{table}:{rowId}', ChangeLogRow>` + flush 50ms (riduce work duplicato su modifiche ravvicinate stesso oggetto).
- `applyEvent(ev)`:
  1. Chiama tutti i listener registrati.
  2. Se `ev.seq > appliedSeq` → aggiorna in memoria + persiste in Dexie.
- **`catchUp()`** dopo riconnessione: `GET /api/changes?sinceSeq={appliedSeq}` → se **410** → `handleCursorExpired()`.
- **`handleCursorExpired()`**: `GET /api/changes/head` → set `appliedSeq = currentSeq` + emette evento sintetico `__resync__` ai listener (trigger full reload).
- API pubblica: `eventStream.init()` (carica cursor da Dexie), `start()`, `stop()`, `subscribe(fn)`, `unsubscribe(fn)`.

#### `src/realtime/projectCascade.ts`
`handleProjectDeleteLocal(ev)`: se `ev.table_name === 'projects' && ev.op === 'DELETE'`:
- Transazione `rw` su 8 tabelle Dexie.
- Cancella in cascata: `photos` (via `mappingEntryId` anyOf), `floorPlanPoints` (via `floorPlanId` anyOf), `mappingEntries`, `structureEntries`, `floorPlans`, `sals`, `typologyPrices`, `projects`.

### 14.8 Auth client (`src/db/auth.ts` riscritto, +622 righe diff)

| Vecchio (Supabase) | Nuovo (homeserver) |
|--------------------|--------------------|
| `supabase.auth.signInWithPassword` + fetch `profiles` | `apiFetch('/api/auth/sign-in/email', POST)` (better-auth) |
| `supabase.auth.signUp` | **throw Error** (registrazione disabilitata, solo admin) |
| `supabase.auth.signOut` | `apiFetch('/api/auth/sign-out', POST)` |
| `supabase.auth.getSession` | `apiFetch('/api/auth/get-session')` |
| `supabase.auth.onAuthStateChange` | **stub** `{unsubscribe: () => {}}` (no realtime auth state) |
| `supabase.auth.resetPasswordForEmail` / `updateUser` | **stub** con errore "non disponibile" |
| `supabase.from('profiles')` (admin CRUD) | `apiFetch('/api/auth/admin/list-users')`, `/set-role`, `/remove-user` |
| Offline: sessione Supabase in localStorage | **PBKDF2 600k iterazioni + AES-GCM** con TTL 7 giorni in `db.authCache`: `saveOfflineAuth`, `loginOffline`, `deriveKey`. Rate-limit in `db.realtimeState` chiave `offline_fails_<email>` |

### 14.9 `src/lib/supabase.ts` riscritto (-61 righe nette)
- Client `createClient` con env vars **rimosso**.
- Replaced da **Proxy** che **throw** su qualsiasi accesso → guida lo sviluppatore a usare `apiFetch` invece.
- `isSupabaseConfigured()` ritorna **sempre `false`**.
- Mantiene solo `interface Database` per import type-only (struttura tabelle).

### 14.10 `src/db/onlineFirst.ts` modificato
- `isSupabaseConfigured()` → `isHomeserverConfigured()`.
- Aggiunge `shouldFallbackToIndexedDb(err)` per distinguere retry 5xx/offline (true) vs 4xx (false → propaga).

### 14.11 `src/db/database.ts` modificato (schema +v12/+v13)

#### v12 — `authCache`
```ts
authCache: 'id, email, ...'    // id PK, email index
// Campi: salt, iv, ciphertext, createdAt, expiresAt
```
PBKDF2 (600k iterazioni) + AES-GCM per cifrare credenziali con la password utente come chiave.

#### v13 — `realtimeState`
```ts
realtimeState: 'key, value'    // key PK
```
Usato per:
- `appliedSeq` → cursore SSE persistente.
- `offline_fails_<email>` → contatore rate-limit auth offline.

#### `clearDatabase()` modificato
**Preserva** `authCache` e `metadata` (sopravvivono ai reset sync → utente non perde credenziali offline).

### 14.12 Sync layer riscritto

#### `syncEngine.ts` (+227)
- `supabase.auth.getSession()` → `apiFetchJson('/api/me')` (verifica auth attivo).
- Gestisce `ApiResponseError`/`ApiNonJsonResponseError` come 401.
- `isSupabaseConfigured()` → `isHomeserverConfigured()` (log "Supabase" → "homeserver").
- `syncFromSupabase()` (nome legacy preservato): rimosso fetch `profiles`, ruolo admin ora viene da `/api/me`.
- **Integrazione SSE** in `clearAndSync()`:
  - `eventStream.stop()` prima del reset cache.
  - `eventStream.init()` + `eventStream.start()` dopo il re-download (riconnessione SSE).

#### `syncUploadHandlers.ts` (+415)
Sostituzione 1:1:
- `supabase.from(table).upsert(payload)` → `apiFetch('/api/{table}', {method:'PUT', body: JSON.stringify(payload)})`.
- `supabase.from(table).delete().eq('id', id)` → `apiFetch('/api/{table}?id=eq.{id}', {method:'DELETE'})`.
- `supabase.storage.from('photos').upload/remove` → `apiStorageFrom('photos').upload/remove`.
- `getPublicUrl` → `apiStorageFrom().getPublicUrl()`.
- Conflict check pre-upload (`floor_plans`): `apiFetch('/api/floor_plans?id=eq.{id}')` → parsing array (vuoto = not found).

Endpoint usati: `/api/{projects,mapping_entries,structure_entries,floor_plans,floor_plan_points,standalone_maps,sals,typology_prices,photos}`.

#### `syncDownloadHandlers.ts` (+236)
- `supabase.from(table).select().in(col, batch)` → `apiFetch('/api/{table}?{col}=in.{val1,val2}&limit=1000&offset={off}')` con loop paginato (`fetchRowsPaged`).
- `SUPABASE_IN_BATCH_SIZE` → `REMOTE_IN_BATCH_SIZE`.
- Aggiunto `SYNC_FETCH_LIMIT = 1000` per paginazione.
- Filtro client-side su `owner_id`/`accessible_users` (per progetti) → rimosso: ora **scope server-side** (`fetchRowsPaged('/api/projects')`).
- `supabase.storage.from(bucket).download()` → `apiStorageFrom(bucket).download()`.
- Supporto URL `/api/storage/` + legacy `/storage/v1/object/`.

#### `conflictResolution.ts` (+39)
- `supabase.from(t).select().eq().single()` con check `PGRST116` (not found) → `apiFetch('/api/{t}?id=eq.{id}')` con check `res.status === 404` OR `data[0]` vuoto.

### 14.13 `src/db/floorPlans.ts`, `mappings.ts`, `structures.ts`, `utils/floorPlanUtils.ts`

#### Pattern uniforme di sostituzione
```
isOnlineAndConfigured()                              -> isHomeserverOnline()
supabase.from(t).select(c).eq(col,v).limit(N)        -> apiFetchJson('/api/{t}?{col}=eq.{v}&select={c}&limit=N&offset=...')
supabase.from(t).select(c, {count:'exact', head:true}) -> apiFetch('/api/{t}?{col}=in.{batch}&count=exact&head=true')
supabase.storage.from(b).createSignedUrls(paths, ttl) -> apiStorageFrom(b).createSignedUrls(paths, ttl)
supabase.storage.from(b).download(path)              -> apiStorageFrom(b).download(path)
supabase.storage.from(b).upload(path, blob, opts)    -> apiStorageFrom(b).upload(path, blob, opts)
supabase.storage.from(b).remove(paths)               -> apiStorageFrom(b).remove(paths)
getPublicUrl(path)                                   -> synthUrl('*_storage_path')  // costruisce '/api/storage/proxy/{bucket}/{key}' con fallback legacy
isAuthError(err)                                     -> !shouldFallbackToIndexedDb(err)
```

#### Specificità
- `mappings.ts`: filtro `floor` ora **client-side** (PostgREST scope-layer non lo applica perché non in `addScope`).
- `floorPlanUtils.ts`: upload bucket `planimetrie` via `apiStorageFrom`; PDF originale con TTL **10 anni** (`315360000`) preservato.

### 14.14 Migrazione dati (`scripts/migrate-supabase-to-homeserver.ts`)

- **Source**: Supabase Admin API (per `auth.users`) + PostgREST (tabelle applicative).
- **Target**: Postgres homeserver (schema better-auth + applicativo).
- **Auth users**:
  - Stesso UUID (preserva identità).
  - `name` da `raw_user_meta_data`.
  - Ruolo mappato: `service_role` → `admin`.
  - `banned_until` → `banned` boolean.
  - Password: scrypt temporanea (hash scrypt) — gli utenti devono fare password reset.
- **Tabelle applicative**: `projects`, `mapping_entries`, `structure_entries`, `typology_prices`, `floor_plans`, `floor_plan_points`, `photos`, `standalone_maps`, `sals`, `dropdown_options`, `products`.
- **Ordine**: utenti prima, poi tabelle in sequenza (rispetta FK).
- **Strategia**: UPSERT batch 200, filtra solo colonne esistenti nel target, `ON CONFLICT DO NOTHING`.
- **Storage**: NON migra binari nello stesso script. Script separato `migrate-storage-urls.ts` (+ `forward-storage-copy.ts`) per copiare blob Supabase Storage → MinIO + riscrivere URL nei record DB.

### 14.15 Mappa veloce "PRIMA → DOPO" per file frontend

| File | Cosa cambia |
|------|-------------|
| `src/lib/supabase.ts` | Da client live → Proxy throwing + `isSupabaseConfigured()=false` |
| `src/lib/homeserver.ts` (**nuovo**) | apiFetch/apiFetchJson, retry 502/503/504, content-type guard |
| `src/lib/storageShim.ts` (**nuovo**) | Drop-in di `supabase.storage` su endpoint `/api/storage/*` |
| `src/realtime/eventStream.ts` (**nuovo**) | SSE client con cursor persistente Dexie |
| `src/realtime/projectCascade.ts` (**nuovo**) | Cascade delete locale su evento DELETE progetto |
| `src/db/auth.ts` | better-auth via apiFetch; signUp disabled; offline auth PBKDF2+AES-GCM |
| `src/db/database.ts` | +v12 authCache, +v13 realtimeState; clearDatabase preserva auth |
| `src/db/onlineFirst.ts` | isHomeserverConfigured + shouldFallbackToIndexedDb |
| `src/db/mappings.ts` | supabase.from/storage → apiFetch/apiStorageFrom + pagination |
| `src/db/structures.ts` | idem |
| `src/db/floorPlans.ts` | idem + `synthUrl` per URL asset |
| `src/db/pricing.ts` | idem |
| `src/db/sal.ts` | idem |
| `src/db/dropdownOptions.ts` | idem |
| `src/sync/syncEngine.ts` | `/api/me` per session; integrazione eventStream in clearAndSync |
| `src/sync/syncUploadHandlers.ts` | Tutti gli upload via apiFetch + apiStorageFrom |
| `src/sync/syncDownloadHandlers.ts` | Tutti i download via apiFetch paginato |
| `src/sync/conflictResolution.ts` | check 404 + parsing array invece di `.single()` |
| `src/utils/floorPlanUtils.ts` | Upload planimetrie/PDF via apiStorageFrom |
| `src/lib/forcedMigration.ts` | Versione bumped per forzare wipe pre-cutover |
| `src/components/Login.tsx` | UI minore (rimozione signup button?) |
| `src/components/SettingsPage.tsx` | UI sync + gestione utenti via admin endpoints |
| `public/service-worker.js` | Cache strategy aggiornata per `/api/*` |
| `vercel.json` | CSP `connect-src` aggiornato (verso il dominio Cloudflare homeserver) |

### 14.16 Test aggiunti
- `src/lib/__tests__/storageShim.test.ts` (~352 righe)
- `src/realtime/__tests__/projectCascade.test.ts` (~315 righe)
- `opimappa-server/api/test/`: `isolation.test.ts`, `query-builder.test.ts`, `query-parser.test.ts`, `realtime-visibility.test.ts`

---

## 15. Debito tecnico e invarianti

### 15.1 Debito tecnico riscontrato (priorità per il rewrite)

| Area | Problema | Azione consigliata |
|------|----------|--------------------|
| `App.tsx` (~840 LOC) | God-component: routing + sync + history + persistenza punti planimetria | Router dedicato; store/context per sync; hook history; sposta `onSave` del FloorPlanEditor in un hook dedicato (`useFloorPlanPersistence`) |
| `FloorPlanCanvas.tsx` + `FloorPlanEditor.tsx` (~3200 LOC) | Canvas imperativo, logica rendering mista a input/hit-test/persistenza | Separare: `renderer` (puro), `inputController` (gesture), `documentModel` (punti/cartiglio/griglia immutabili), `coordSystem` (normalizzato/canvas) |
| Schema Dexie (v1→v13) | Versioni incrementali con cambi-chiave incompatibili e `clear()` distruttivi (v7) | Schema pulito v1 nel rewrite + migrazione one-shot dai dati esistenti |
| Accoppiamento Supabase residuo | Anche dopo migrazione homeserver, nomi delle funzioni (`syncFromSupabase`, `downloadXFromSupabase`, `convertRemoteToLocal*`) preservati | Rinominare per chiarezza (`syncFromRemote`, `downloadXFromHomeserver`) |
| `MappingPage.tsx` vs `MappingWizard.tsx` | Duplicazione: page legacy non cablata | Eliminare `MappingPage` |
| PDF.js da CDN | Dipendenza esterna runtime; problemi offline + CSP | Bundle locale o self-hosted sul homeserver |
| `signPhotoPaths` con limite 500/batch | Hardcoded Supabase limit | Configurabile o eliminato se MinIO non ha lo stesso limite |
| `MappingEntry.photos` come array embedded + tabella `photos` separata | Duplicazione (metadata + entità) | Considerare normalizzazione completa (solo tabella `photos`) |
| `floor` come stringa | Sort numerico richiede `Intl.Collator` ovunque | Tipo `floor: number` con label di display separata |
| Cartiglio hardcoded `CARTIGLIO_INSTALLER_LINES` | Solo Opi Firesafe | Spostare in config progetto o profilo organizzazione |
| Cache strategy SW | Non documentata | Esplicitare per ogni endpoint |
| Test coverage | Solo `App.test.tsx` + tests nuovi homeserver | Aggiungere unit per `mappings.ts`, `syncEngine`, `conflictResolution`, `FloorPlanCanvas` (gesture, coordinate) |

### 15.2 Invarianti da NON rompere nel rewrite

1. **Funzionamento 100% offline** + sincronizzazione bidirezionale al ritorno della connessione.
2. **Coordinate planimetria normalizzate `[0,1]`** — qualsiasi cambio rompe la compatibilità retroattiva dei punti salvati.
3. **Coda outbox `syncQueue`** come unica via di scrittura remota — mai bypassare.
4. **Ordine sync: upload SEMPRE prima del download** — pena perdita dati locali.
5. **`last-modified-wins` + log conflitti** per entità versionate (`projects`, `mapping_entries`).
6. **Foto su bucket privato → signed URL** (versione Supabase: limite 500/batch; versione homeserver: `sign-one` per path).
7. **Asola minimo 0,2 mq** — vincolo di business.
8. **Tipologici con `category` per distinguere attraversamento/struttura** — niente unione delle liste.
9. **Booleani indicizzati come `0|1` su Dexie** — pena query silenziosamente vuote.
10. **`finalizedRef` nel wizard** — qualsiasi bozza non finalizzata DEVE essere cancellata in unmount.
11. **Echo suppression realtime** (homeserver): `originator == sessionId` → skip (evita doppia applicazione).
12. **Dominio email `@opifiresafe.com`** — vincolo di sicurezza sia su client (`Login.tsx`) sia su server (`validateEmailDomain` middleware).

---

## 16. Revisione critica esterna

> Sezione scritta assumendo che il revisore **non conosca l'app** e veda il documento + il codice per la prima volta.

### 16.1 Punti forti del documento
- Inventario delle entità e schema versioning completi e referenziabili (§3.4).
- Diagramma testuale delle viste e flusso `onSave` (§4) ricostruisce bene l'intero ciclo di vita di un punto su planimetria.
- §11 sul sync rende esplicito l'ordine upload→download e le regole di deduplica (DELETE vince), che sono dettagli facili da sbagliare se non documentati.
- §14 mappa file-per-file il passaggio Supabase→homeserver con i path API reali — utile sia per il rewrite sia per troubleshooting.
- Lista invarianti finale (§15.2) è azionabile: ogni voce è verificabile.

### 16.2 Lacune / cose poco chiare per chi non conosce l'app

1. **Manca un glossario** dei termini di dominio: cosa è un "attraversamento" vs una "sigillatura"? Cosa significa "in asola" e perché ha un minimo di 0,2 mq? Cosa è la "classificazione EI"? Senza questo, un nuovo dev non capisce il dominio business. **Azione**: aggiungere §0 "Glossario di dominio".
2. **Diagramma del flusso utente end-to-end** mancante. Un operatore tipico fa: login → seleziona progetto → entra in cantiere → fotografa attraversamento → posiziona punto → torna → export → consegna PDF. Senza una vista d'insieme grafica, le sezioni 6-9 sembrano scollegate.
3. **§4.8 (`onSave` editor)**: la descrizione è precisa ma non spiega *perché* la persistenza viene fatta in `App.tsx` invece che dentro `FloorPlanEditor`. È debito tecnico o c'è un motivo (es. evitare re-mount sui re-render)? **Azione**: aggiungere "Razionale" alla nota.
4. **Foto remote-only** (`hasRemotePhotos`): descritto sparso, ma manca un paragrafo dedicato. Cosa succede quando l'utente apre una entry con foto remote? L'UI mostra placeholder? Scarica automaticamente? Mostra "tap per scaricare"? Non c'è risposta.
5. **Conflitti**: §11.4 elenca le strategie ma non dice mai *cosa vede l'utente* quando c'è un conflitto. `userNotified: boolean` è in `ConflictHistory` ma il flusso UI non è descritto.
6. **Realtime SSE (homeserver)**: dopo aver mappato l'infrastruttura precisamente (§14.6, §14.7), manca l'**integrazione**: chi chiama `eventStream.subscribe(...)` nel frontend? Chi applica i `ChangeLogRow` ai dati Dexie? La cascade su DELETE progetto sì (`projectCascade`), ma INSERT/UPDATE? Sospetto che ci sia un wiring in `App.tsx` o in un init dedicato che il doc non cattura. **Azione**: trovare il caller di `eventStream.subscribe` nel branch e documentarlo.
7. **Auth offline PBKDF2** (§14.8): l'algoritmo è descritto (600k iter, AES-GCM, TTL 7d). Manca: cosa succede al primo login online dopo TTL scaduto? Si chiede di nuovo la password? E se l'utente cambia password sul server, come si invalida la cache offline?
8. **`change_log` server-side**: §14.6 lo cita ma non c'è lo schema. Quante colonne? Indici? È mai compactato? La retention non è documentata. Il `410 cursor_expired` lato client implica una compaction lato server, ma quando/come?
9. **Differenza Mapping vs Structure foto**: condividono la stessa tabella Dexie `photos` con `entryType` discriminator. Su Postgres, lato Supabase la tabella `photos` ha solo `mapping_entry_id`, mentre lo schema homeserver e gli handler usano sia `mapping_entry_id` che `structure_entry_id` (campo duale in `addScope` e in `structures.ts` query). C'è una migration aggiuntiva nello schema che il doc non cita. **Azione**: verificare ed esplicitare in §3.2 / §13.
10. **Worker Kimi e il flag UTF-8**: la patch fatta a `scripts/ai-workers/ask-worker.py` (sys.stdout.reconfigure) è documentata nei commit ma non rilevante qui — ma il fatto che ci siano script worker IO-bound non è citato nel doc, è una scelta architetturale per `CLAUDE.md`/`AGENTS.md`. Forse non serve qui, ma vale citare in §15 come pattern operativo del team.

### 16.3 Problemi / bug potenziali individuabili dal doc

#### Severità: ALTA
- **B1 — Race condition sul `finalizedRef` del wizard**: se l'utente naviga via prima che `updateMappingEntry` finisca, l'unmount può sparare PRIMA che `finalizedRef.current = true` venga settato (è dentro `handleSubmit`, dopo l'await). Conseguenza: la bozza esistente viene cancellata sotto i piedi del salvataggio in corso → potenziale data loss. *Verifica*: leggere `MappingWizard.tsx` per confermare l'ordine async.
- **B2 — `clearAndSync` + SSE race**: nel branch homeserver `clearAndSync` chiama `eventStream.stop()` prima del reset e `start()` dopo. Se durante la finestra arrivano eventi remoti (es. altro utente modifica), li perdiamo. L'`eventStream` su `start()` riprende da `appliedSeq` persistito in Dexie, che è stato resettato dal `clearAndSync`? Se sì, non recupera (cursor = 0 = inizio storia). Se no, vede eventi già applicati. **Azione**: tracciare `clearDatabase()` e verificare se `realtimeState` viene preservato (probabilmente sì, come `authCache`, ma il doc non lo dice).
- **B3 — `withOriginatorTransaction` rinunciato in alcune route?**: la suppression eco realtime si basa su `originator == sessionId`. Se una route mutante dimentica il wrap, l'utente vede rimbalzare le sue stesse modifiche. **Azione**: grep su tutte le mutate per verificare copertura uniforme.
- **B4 — `sign-one` 500-batch**: nello shim `createSignedUrls` itera con `Promise.all` su tutti i paths senza chunking. Se l'utente apre una entry con 200 foto, sono 200 fetch concorrenti → rischio Cloudflare throttle / connection pool exhaustion. Versione Supabase aveva `signPhotoPaths` con batch ≤500 ma usava una singola request batch. **Azione**: introdurre `p-limit` o chunk a 10-20.

#### Severità: MEDIA
- **B5 — Coordinate normalizzate vs rotazione**: la rotazione 0/90/180/270 in `FloorPlanEditor` genera `rotatedImageUrl` ma le coordinate dei punti restano `[0,1]` riferite all'**immagine originale**. Quando esporto il PDF con rotazione 90°, devo trasformare le coordinate? Il doc dice "ricalcolo CropBox" ma non "ricalcolo punti". Se i punti non vengono ruotati anche loro, finiranno in posizione errata.
- **B6 — `last-modified-wins` con clock skew**: `handleOpenFloorPlanEditor` ha tolleranza 5s per `clock skew`, ma `conflictResolution` no. Due utenti su dispositivi con clock disallineati di 10s avranno regolarmente il dispositivo "indietro" che perde le sue modifiche.
- **B7 — `assignCrossingsToSal` non transazionale**: itera tutte le `MappingEntry` con UPDATE + syncQueue. Se l'utente chiude la tab a metà, alcune entry hanno `salId` settato e altre no, e la coda è parzialmente accodata. Riapertura: vede SAL "parzialmente assegnato" senza modo di sapere quali entry mancano.
- **B8 — Cascade delete su DELETE progetto solo client-side**: `projectCascade.ts` cancella su Dexie 8 tabelle. Lato server è "FK Postgres" (`ON DELETE CASCADE`). Cosa succede se il client riceve l'evento ma non riesce a completare la transazione (es. quota IndexedDB esaurita)? Resta con dati orfani fino al `clearAndSync` successivo.
- **B9 — `Crossing.id` generato con `Date.now()` invece di UUID**: il worker su `MappingWizard` ha rilevato "id autogenerato con `Date.now()`". Se l'utente aggiunge 2 crossing nello stesso ms (improbabile ma possibile su dispositivi lenti che bloccano la UI), collisione di ID. **Azione**: usare `generateId()`.
- **B10 — Photo metadata duplicato**: `MappingEntry.photos[].id` e `Photo.id` devono restare in sync. Se la sync remota crea nuove righe `photos` con id server, ma `MappingEntry.photos[]` ha gli ID locali, mismatch.

#### Severità: BASSA
- **B11 — `archived` non utilizzato in molte query**: il flag c'è (Dexie index v2) ma il doc non dice mai dove filtri "non archiviati" per default. Probabilmente in `ProjectList`. Se altre query non filtrano, progetti archiviati appaiono dove non dovrebbero.
- **B12 — Tipologico con `Date.now()` come `number`?**: non chiaro come è generato il progressivo. Se è max+1, e l'utente crea progetto offline, sync, e nel frattempo un altro utente ha creato altri tipologici, il `number` può collidere lato server.
- **B13 — `validateEmailDomain` hardcoded**: cambio dominio aziendale = ricompilazione e redeploy. Spostare in env var.
- **B14 — `BUCKET_PHOTOS`/`BUCKET_PLANIMETRIE` constants**: idem, hardcoded sia server che client (`storageShim` parsa `'photos'`/`'planimetrie'` come prefissi noti).

### 16.4 Miglioramenti suggeriti

#### Architetturali
1. **Introdurre un layer `RemoteRepo<T>` astratto** (interface) con implementazioni `SupabaseRemoteRepo` / `HomeserverRemoteRepo`. Tutto il codice in `db/*.ts` consuma l'interfaccia. Cambio backend = swap di una singola istanza, non grep & replace su 12 file.
2. **`AuthProvider` interface** speculare per auth (login, getCurrentUser, logout, onAuthStateChange).
3. **`BlobStore` interface** per storage (upload, download, getSignedUrl, remove, getPublicUrl).
4. **Event bus interno**: invece di `onSyncComplete` ad hoc, usare un mini-bus con tipi forti (`emit('sync:complete', stats)`).
5. **Spostare `Crossing[]` da JSONB embedded a tabella separata**: query analitiche, indici, e migrazioni diventano enormemente più semplici. Costo: join in più. Beneficio: SAL assignments performanti.
6. **Realtime first-class**: invece di "sync ogni 60s + manuale", usare SSE come fonte primaria, riducendo polling. Il backbone server c'è già (§14.6).

#### Qualità
7. **Test E2E per il wizard** (Playwright): coprire scenari draft-orphan, conflict, photo decision, offline→online.
8. **CI gate**: build + test + ESLint + type-check + size budget.
9. **Source maps + Sentry** (o equivalente self-hosted) per error tracking client.
10. **Logging strutturato** lato client (es. `pino` browser): tracciare ogni sync, conflict, error con `userId` + `sessionId` + `entityId`.

#### UX
11. **Conflict resolution UI**: quando `userNotified=false` e il log conflict si accumula, l'utente non sa nulla. Mostrare badge sulla `Dashboard` con "X modifiche risolte automaticamente. Rivedi" → modal con diff.
12. **Foto remote-only**: indicatore visibile (es. icona cloud) con tap-to-download per evitare confusione.
13. **Stato della coda sync**: oltre al `pendingCount`, mostrare l'elenco delle operazioni in modal "Modifiche in attesa" (debug e fiducia utente).
14. **Editor planimetrie**: undo/redo (manca completamente).
15. **Dark mode**: l'app è solo light. Cantiere all'aperto = brutto da leggere al sole.

#### Performance
16. **Code-splitting più aggressivo**: `pdf-lib` e `pdfjs-dist` sono megabytes. Caricare solo on-demand al click "Export PDF" / "Apri planimetria".
17. **Web Worker per la compressione foto**: `browser-image-compression` blocca il main thread. Già supporta workers, ma il codice attuale potrebbe non usarli.
18. **IndexedDB cleanup periodico**: blob orfani (`Photo` senza MappingEntry parent) restano. Aggiungere job di GC.
19. **Pre-fetch SSE catch-up**: al login, fetch `currentSeq` e parti da lì → meno eventi storici da scaricare.

#### Sicurezza
20. **CSP più strict**: nel branch homeserver, `script-src` dovrebbe escludere `'unsafe-inline'` e `'unsafe-eval'` (PDF.js richiede `eval` in alcune build → workaround necessario).
21. **Audit log esposto in admin UI**: c'è `auth_audit_log` table ma nessuna UI per consultarla.
22. **Rate limit anche su `/api/storage/upload-presigned`**: utente malicious può flooderare presigned URL.
23. **Validazione lato server di `metadata` JSONB**: oggi accetta qualsiasi shape → rischio JSON bomb.

### 16.5 Verdetto del revisore
Il documento è **denso e accurato** per descrivere l'app esistente; copre tutti i flussi principali con il livello di dettaglio necessario a una riscrittura. Le sezioni 11 (sync) e 14 (homeserver) sono le più solide.

Le **lacune principali** sono nell'integrazione realtime SSE (mai chiamato `subscribe` nel doc) e nei flussi UI di conflict resolution e foto remote-only — sono i pezzi che oggi probabilmente "funzionano per caso" o "non si vedono mai" e che il rewrite deve esplicitamente decidere.

Le **azioni concrete suggerite prima del rewrite** sono:
1. Verificare e documentare il caller di `eventStream.subscribe(...)` nel branch homeserver.
2. Disegnare la UX di conflict resolution e foto-remote-only (oggi assente o invisibile).
3. Decidere se mantenere `Crossing[]` embedded o normalizzarlo (impatto su SAL e contabilità).
4. Astrarre `RemoteRepo`/`AuthProvider`/`BlobStore` prima di toccare la UI — riduce rischio di rotture.
5. Aggiungere test E2E sul wizard (scenario di data-loss più critico).

---

---

## 14.17 Wiring SSE nel frontend (post-review)

Trovato in `feature/migration-sprint6:src/App.tsx`. Esistono **due caller** di `eventStream.subscribe`, entrambi in un `useEffect` con deps `[isInitialized, currentUser]`:

```ts
useEffect(() => {
  if (!isInitialized || !currentUser) return;
  let active = true;

  const handleStaleView = async (ev: ChangeLogRow) => {
    if (ev.table_name !== 'projects' || ev.op !== 'DELETE') return;
    const deletedId = ev.row_id;
    const isStale =
      viewingProjectRef.current?.id === deletedId ||
      currentMappingProjectRef.current?.id === deletedId ||
      currentStructureProjectRef.current?.id === deletedId ||
      editorProjectRef.current?.id === deletedId ||
      selectedProjectRef.current?.id === deletedId;
    if (!isStale) return;
    setCurrentView('tabs');
    setViewingProject(null); setCurrentMappingProject(null); setCurrentStructureProject(null);
    setEditorProject(null); setSelectedProject(null);
    setEditorFloorPlan(null); setEditorImageUrl(null);
    setEditingMappingEntry(undefined); setEditingStructureEntry(undefined);
    window.history.replaceState({ view: 'tabs', tab: activeTab }, '', window.location.pathname);
  };

  const run = async () => {
    await eventStream.init();
    if (!active) return;
    eventStream.subscribe(handleProjectDeleteLocal);  // cascade Dexie
    eventStream.subscribe(handleStaleView);            // UI guard
    eventStream.start();
  };
  run();
  return () => {
    active = false;
    eventStream.unsubscribe(handleProjectDeleteLocal);
    eventStream.unsubscribe(handleStaleView);
    eventStream.stop();
  };
}, [isInitialized, currentUser]);
```

### 14.17.1 Cosa fa il realtime OGGI
| Evento | Azione |
|--------|--------|
| `projects` DELETE | (1) `handleProjectDeleteLocal` → cascade Dexie su 8 tabelle. (2) `handleStaleView` → se il progetto eliminato è quello visualizzato/editato (verifica via 5 ref), torna a `tabs` + azzera tutti gli stati + `history.replaceState` per evitare back-button stale. |
| `projects` INSERT/UPDATE | **Niente** (nessun listener registrato). |
| Qualsiasi altra tabella (`mapping_entries`, `floor_plans`, `photos`, ecc.) | **Niente** (nessun listener). |

### 14.17.2 Implicazione fondamentale
Il sistema realtime SSE è **invalidation-only**, non **data-application**. L'infrastruttura server (change_log, LISTEN/NOTIFY, sseRoute con replay, visibility filter, dedup client) è completa e robusta, ma il **frontend la usa solo per scenari di pulizia/sicurezza**:
- Cascade locale dei dati orfani su DELETE.
- Evitare che l'utente continui a editare un progetto che non esiste più sul server.

**Per vedere modifiche remote di altri utenti** (es. collega aggiunge mappature al progetto condiviso), il client continua a dipendere da:
1. **`startAutoSync(60000)`** — polling completo ogni 60s.
2. **`manualSync()`** — bottone esplicito.
3. **`handleOnline`** — al ritorno dalla connessione.

### 14.17.3 Refs collaterali
Per evitare stale closure nel listener, esistono 5 `useRef` mirror degli stati progetto:
```ts
const viewingProjectRef = useRef(viewingProject);
const currentMappingProjectRef = useRef(currentMappingProject);
const currentStructureProjectRef = useRef(currentStructureProject);
const editorProjectRef = useRef(editorProject);
const selectedProjectRef = useRef(selectedProject);
// useEffect separati sincronizzano *.current = ...
```

### 14.17.4 Interazione con `clearAndSync`
In `sync/syncEngine.ts` la `clearAndSync()` chiama esplicitamente:
- `eventStream.stop()` PRIMA del reset cache (evita eventi durante il wipe).
- `eventStream.init()` + `eventStream.start()` DOPO il redownload.

Durante questa finestra (~secondi-minuti) gli eventi remoti vengono **persi**: il cursor `appliedSeq` in `realtimeState` non viene aggiornato. Vedi fix B2 in §17.

---

## 17. Fix proposti per i bug della review

Per ogni bug della §16.3 fornisco: **dove** (file + funzione), **root cause** preciso, **fix** con snippet di codice o cambio architetturale.

### 17.1 ALTA — Race condition `finalizedRef` (B1) — ✅ FATTO (sprint6, 2026-06-03)

> Claim `finalizedRef.current = true` PRIMA delle await + guardia re-entrancy + release su errore, in `MappingWizard.tsx` e `StructureWizard.tsx`.

**Dove**: `src/components/MappingWizard.tsx` + `src/components/StructureWizard.tsx`, funzione `handleSubmit` e `useEffect` di unmount.

**Root cause**: `finalizedRef.current = true` viene settato DOPO `await updateMappingEntry(...)`. Se l'utente naviga durante l'await, l'unmount cleanup vede `finalizedRef.current === false` e cancella la bozza in parallelo al save → data loss.

**Fix** — claim atomico prima delle await + revert su errore:
```ts
const handleSubmit = async () => {
  if (finalizedRef.current) return; // re-entrancy guard
  finalizedRef.current = true;       // CLAIM PRIMA delle await
  setIsSubmitting(true);
  try {
    const compressed = await Promise.all(photoFiles.slice(initialPhotoCount).map(compress));
    if (editingEntry || savedDraftEntry) {
      await updateMappingEntry(id, updates, currentUser.id);
      // ... resto operazioni ...
    } else {
      await createMappingEntry(data, compressed);
    }
    onSaved();
  } catch (err) {
    finalizedRef.current = false; // RELEASE su errore — permette cleanup retry
    setIsSubmitting(false);
    throw err;
  }
};

// Cleanup unmount invariato
useEffect(() => () => {
  if (savedDraftEntryRef.current && !finalizedRef.current) {
    deleteMappingEntry(savedDraftEntryRef.current.id).catch(console.warn);
  }
}, []);
```

Alternativa più robusta: persistere `finalized: boolean` sul record `MappingEntry` stesso (boolean campo Dexie indicizzato `0|1`). Il cleanup interroga lo stato persistito invece che la ref in memoria. Sopravvive a refresh durante il salvataggio.

---

### 17.2 ALTA — `clearAndSync` + SSE race (B2) — ✅ FATTO (sprint6, 2026-06-03)

> Dopo il redownload, `clearAndSync` salta il cursore SSE al `currentSeq` di `/api/changes/head` (come `handleCursorExpired`). `appliedSeq='0'` resta come fallback sicuro se la fetch fallisce (replay idempotente, nessuna perdita).

**Dove**: `src/sync/syncEngine.ts` `clearAndSync()` + `src/db/database.ts` `clearDatabase()`.

**Root cause**: tra `eventStream.stop()` e `eventStream.start()` gli eventi remoti vengono persi. Inoltre `clearDatabase()` potrebbe wipare `realtimeState.appliedSeq` (da verificare): se sì, al restart il client tenta replay dall'inizio e riprocessa eventi già consolidati nel redownload.

**Fix** — saltare al cursor di head dopo il redownload completo:
```ts
// src/sync/syncEngine.ts
export async function clearAndSync(): Promise<void> {
  eventStream.stop();
  await clearDatabase(); // deve preservare authCache + metadata; NON realtimeState (lo ricostruiamo subito)
  await phasedSyncFromSupabase({ /* ... */ });

  // SCONNETTI dal passato: lo snapshot appena scaricato include già tutti gli eventi <= currentSeq
  const { currentSeq } = await apiFetchJson<{ currentSeq: string }>('/api/changes/head');
  await db.realtimeState.put({ key: 'appliedSeq', value: currentSeq });

  await eventStream.init();   // ora init() legge currentSeq, non 0
  eventStream.start();        // SSE riparte da currentSeq → solo eventi nuovi
}
```

E in `clearDatabase()`: esplicitare la lista preservata:
```ts
// preserva: metadata, authCache, realtimeState (verrà sovrascritto da clearAndSync)
```

---

### 17.3 ALTA — `withOriginatorTransaction` copertura incompleta (B3) — ✅ FATTO (sprint6, 2026-06-03)

> **Deviazione dalla proposta**: NIENTE middleware unico. Con postgres.js `set_config(...true)` è transaction-local e un middleware che wrappa `next()` non può iniettare `tx` negli handler → li lascerebbe silenziosamente scoperti. Audit: tutti e 4 i verbi mutanti (POST/PUT/PATCH/DELETE) già wrappano `withOriginatorTransaction`; `storage.ts` scrive solo su MinIO (no change_log). Aggiunto: guard che lancia se `sessionId` manca (evita originator NULL → echo loop) + test di regressione `test/originator-coverage.test.ts` (verifica per ogni verbo `originator_session = sessionId`).

**Dove**: `opimappa-server/api/src/routes/crud.ts` — ogni handler che muta.

**Root cause**: deve essere applicato MANUALMENTE a ogni handler. Una svista = riga in `change_log` con `originator NULL` → echo non soppresso → client vede rimbalzare la sua modifica.

**Fix architetturale** — middleware unico che wrappa tutte le mutazioni:
```ts
// crud.ts
import { withOriginatorTransaction } from './audit';

function originatorMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(c.req.method)) {
      return withOriginatorTransaction(c, () => next());
    }
    return next();
  };
}

// index.ts — applica una volta sola alla route group mutante
const mutating = new Hono();
mutating.use('*', originatorMiddleware());
mutating.route('/', tables);
app.route('/api', mutating);
```

**Test di regressione**: aggiungere a `realtime-visibility.test.ts` un test che invia un POST e verifica che la riga `change_log` corrispondente abbia `originator NOT NULL` e uguale al `session.id` richiedente.

---

### 17.4 ALTA — `createSignedUrls` senza chunking (B4) — ✅ FATTO (sprint6, 2026-06-03)

> Scelto il **fix lato client** (più piccolo e autocontenuto, niente nuovo endpoint server): helper `mapWithConcurrency` in `src/lib/storageShim.ts` esegue le chiamate `sign-one` con pool a concorrenza 10 (`SIGN_CONCURRENCY`), preservando l'ordine dei risultati. L'endpoint batch `sign-many` resta come ottimizzazione futura opzionale.


**Dove**: `src/lib/storageShim.ts`.

**Root cause**: `Promise.all(paths.map(...))` su N path → N fetch concorrenti verso `/api/storage/sign-one`. Per N=200 = 200 connessioni concorrenti, potenziale throttle Cloudflare/Caddy e socket exhaustion.

**Fix lato client** — concorrenza limitata:
```ts
async function pLimit<T>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
    }
  }));
  return results;
}

async createSignedUrls(paths, ttlSec) {
  const results = await pLimit(paths, 10, p => signOneCall(p, ttlSec));
  // ... resto invariato ...
}
```

**Fix lato server (preferibile)** — endpoint batch `/api/storage/sign-many`:
```ts
// opimappa-server/api/src/storage/presign.ts
storage.post('/sign-many', requireUser, async (c) => {
  const { bucket, paths, ttl } = await c.req.json<{bucket: string, paths: string[], ttl: number}>();
  if (paths.length > 500) return c.json({error: 'max 500 paths per batch'}, 400);
  const user = c.get('user');
  const results = await Promise.all(paths.map(async (path) => {
    const allowed = await userCanAccessStoragePath(bucket, path, user.id, user.role);
    if (!allowed) return { path, signedUrl: null, error: 'forbidden' };
    const signedUrl = await getSignedReadUrl(bucket, path, ttl);
    return { path, signedUrl, error: null };
  }));
  return c.json({ data: results });
});
```
Riduce N fetch a 1.

---

### 17.5 MEDIA — Coordinate punti vs rotazione (B5)

**Dove**: `src/utils/exportUtils.ts` → `buildFloorPlanVectorPDF` / `_drawAnnotationsOnPage`.

**Root cause**: coordinate `[0,1]` riferite a immagine ORIGINALE. Con `rotation ∈ {90,180,270}` si ricalcola solo CropBox immagine, NON le coordinate dei punti → punti renderizzati nelle posizioni sbagliate.

**Fix** — applicare rotazione affine ai punti prima del draw:
```ts
type Pt = { x: number; y: number };

function rotateNormalized(p: Pt, rotation: 0|90|180|270): Pt {
  switch (rotation) {
    case 0:   return { x: p.x, y: p.y };
    case 90:  return { x: p.y, y: 1 - p.x };
    case 180: return { x: 1 - p.x, y: 1 - p.y };
    case 270: return { x: 1 - p.y, y: p.x };
  }
}

function rotatePoint(point: CanvasPoint, rotation: 0|90|180|270): CanvasPoint {
  const p = rotateNormalized({ x: point.pointX, y: point.pointY }, rotation);
  const l = rotateNormalized({ x: point.labelX,  y: point.labelY  }, rotation);
  return {
    ...point,
    pointX: p.x, pointY: p.y,
    labelX: l.x, labelY: l.y,
    perimeterPoints: point.perimeterPoints?.map(v => rotateNormalized(v, rotation)),
  };
}

// In buildFloorPlanVectorPDF
const exportPoints = rotation === 0 ? points : points.map(p => rotatePoint(p, rotation));
_drawAnnotationsOnPage(page, exportPoints, /*...*/);
```

**Test**: snapshot test del PDF generato per rotation 0/90/180/270 (confrontare bytes o convertire a PNG e fare pixel-diff su `pixelmatch`).

---

### 17.6 MEDIA — `last-modified-wins` vulnerabile a clock skew (B6)

**Dove**: `src/sync/conflictResolution.ts` → `resolveProjectConflict` / `resolveMappingEntryConflict`.

**Root cause**: confronto puro su `lastModified`. Due client con clock disallineati di 10s → quello "indietro" perde sempre le sue modifiche, anche se semanticamente più recenti.

**Fix** — preferenza per `version` (logical clock) con `lastModified` come tiebreaker:
```ts
type Resolution = 'local' | 'remote';

function resolveByVersionThenTime(local: Entity, remote: Entity, toleranceMs = 5000): Resolution {
  // 1. Logical clock primary
  if ((local.version ?? 0) > (remote.version ?? 0)) return 'local';
  if ((remote.version ?? 0) > (local.version ?? 0)) return 'remote';

  // 2. Stesso version: tiebreaker su lastModified con tolleranza
  const diff = (local.lastModified ?? 0) - (remote.lastModified ?? 0);
  if (Math.abs(diff) < toleranceMs) {
    // entro la tolleranza: preferenza per il LOCALE (utente sta editando ora)
    return 'local';
  }
  return diff > 0 ? 'local' : 'remote';
}
```

**Lato server**: enforcement `NEW.version = OLD.version + 1` via trigger:
```sql
CREATE OR REPLACE FUNCTION bump_version()
RETURNS TRIGGER AS $$
BEGIN
  NEW.version := COALESCE(OLD.version, 0) + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER projects_bump_version
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION bump_version();
-- idem mapping_entries
```

In più: enforce optimistic locking. UPDATE con `WHERE id = $1 AND version = $2` (where $2 = client's known version); 0 rows updated → 409 Conflict → client riceve, fa refetch, rimerge.

---

### 17.7 MEDIA — `assignCrossingsToSal` non transazionale (B7) — ✅ GIÀ FATTO (verificato sprint6, 2026-06-03)

> Nessuna modifica necessaria: `assignCrossingsToSal`, `assignStructuresToSal` e l'unassign sono già in transazione Dexie atomica `('rw', [entries, syncQueue])` con put+enqueue dentro e `triggerImmediateUpload()` fuori. Implementazione migliore della proposta (dedup nella coda invece di bulkPut cieco).

**Dove**: `src/db/sal.ts` → `assignCrossingsToSal`, `assignStructuresToSal`.

**Root cause**: loop sequenziale con `updateMappingEntry` (che fa write singola su Dexie + enqueue). Tab chiusa a metà → stato inconsistente.

**Fix** — transazione Dexie atomica + UPDATE batch via `bulkPut`:
```ts
export async function assignCrossingsToSal(
  projectId: string,
  salId: string,
  userId: string,
  includeToComplete = false
): Promise<{ updatedCount: number }> {
  return db.transaction('rw', [db.mappingEntries, db.syncQueue], async () => {
    const entries = await db.mappingEntries
      .where('projectId').equals(projectId)
      .toArray();

    const modified: MappingEntry[] = [];
    for (const entry of entries) {
      const newCrossings = entry.crossings.map(c => {
        if (c.salId) return c;                                     // già assegnato
        if (c.toComplete && !includeToComplete) return c;          // escluso
        return { ...c, salId };
      });
      const changed = newCrossings.some((c, i) => c.salId !== entry.crossings[i].salId);
      if (!changed) continue;
      modified.push({
        ...entry,
        crossings: newCrossings,
        version: (entry.version ?? 0) + 1,
        lastModified: now(),
        modifiedBy: userId,
        synced: 0,
      });
    }

    if (modified.length > 0) {
      await db.mappingEntries.bulkPut(modified);
      // 1 syncQueue per ognuna (dedup farà merge in sync)
      const queueItems = modified.map(m => ({
        id: generateId(),
        operation: 'UPDATE' as const,
        entityType: 'mapping_entry' as const,
        entityId: m.id,
        payload: m,
        timestamp: now(),
        retryCount: 0,
        synced: 0 as const,
      }));
      await db.syncQueue.bulkPut(queueItems);
    }
    return { updatedCount: modified.length };
  }).then(result => {
    triggerImmediateUpload(); // fuori dalla transazione
    return result;
  });
}
```

Dexie garantisce atomicità: o tutte le modifiche vengono persistite, o nessuna.

---

### 17.8 MEDIA — Cascade DELETE fallibile su quota IndexedDB (B8) — ✅ FATTO (sprint6, 2026-06-03)

> Implementato in `src/realtime/projectCascade.ts`: transazione cascade estratta in `runProjectCascade()`; `handleProjectDeleteLocal` la avvolge in try/catch e, su errore (es. `QuotaExceededError`), persiste un marker `pendingCascade:<id>` in `db.metadata` (best-effort, non rilancia se anche il marker fallisce) poi rilancia per il log di eventStream. Nuova `drainPendingCascades()` ritenta i marker al boot (max 5 tentativi, poi lascia il marker per il prossimo `clearAndSync`); agganciata in `App.tsx` dopo `eventStream.init()`. Test: `projectCascade.drain.test.ts` (drain ok / persist+rethrow su fail / incremento attempts).


**Dove**: `src/realtime/projectCascade.ts` → `handleProjectDeleteLocal`.

**Root cause**: transazione su 8 tabelle può fallire (`QuotaExceededError` o lock contesa). Errore swallowed dal try/catch del subscriber → progetto resta in DB locale anche se server-side è eliminato.

**Fix** — error handling esplicito + retry persistente:
```ts
export async function handleProjectDeleteLocal(ev: ChangeLogRow): Promise<void> {
  if (ev.table_name !== 'projects' || ev.op !== 'DELETE') return;
  const projectId = ev.row_id;

  try {
    await db.transaction('rw', [
      db.projects, db.mappingEntries, db.structureEntries, db.photos,
      db.floorPlans, db.floorPlanPoints, db.sals, db.typologyPrices,
    ], async () => {
      // ... cascade come oggi ...
    });
  } catch (err: any) {
    console.error('[projectCascade] failed', err);
    // Marca per retry differito
    await db.metadata.put({
      key: `pendingCascade:${projectId}`,
      value: {
        projectId,
        attempts: 0,
        lastError: String(err?.message || err),
        scheduledAt: Date.now(),
      },
    });
    throw err; // notifica EventStream
  }
}

// In initializeDatabase() — drain dei cascade pendenti al boot
export async function drainPendingCascades(): Promise<void> {
  const items = await db.metadata.where('key').startsWith('pendingCascade:').toArray();
  for (const item of items) {
    try {
      await handleProjectDeleteLocal({
        table_name: 'projects', op: 'DELETE',
        row_id: item.value.projectId,
        seq: '0', project_id: null, user_id: null, originator: null,
      });
      await db.metadata.delete(item.key);
    } catch {
      const attempts = item.value.attempts + 1;
      if (attempts >= 5) {
        // Allerta utente nel prossimo SettingsPage render
        console.error(`[cascade] giving up on ${item.value.projectId} after 5 attempts`);
      } else {
        await db.metadata.put({ ...item, value: { ...item.value, attempts } });
      }
    }
  }
}
```

---

### 17.9 MEDIA — `Crossing.id` da `Date.now()` invece di UUID (B9) — ✅ FATTO (sprint6, 2026-06-03)

> Sostituiti tutti i generatori di id basati su `Date.now()` per crossing/sigillature/strutture con `generateId()` (UUID) in `MappingWizard.tsx`, `MappingPage.tsx`, `StructureWizard.tsx`. Elimina l'intera classe di collisioni (anche i `${Date.now()}-${index}` batch-safe sono stati uniformati). `ProjectForm`/`TypologyViewerModal` (entità diverse) fuori scope.


**Dove**: `src/components/MappingWizard.tsx` `handleAddCrossing` (e simili).

**Root cause**: collisione possibile su dispositivi lenti / loop sincroni veloci.

**Fix** — banale:
```ts
import { generateId } from '../db';

const newCrossing: Crossing = {
  id: generateId(),                  // era Date.now().toString()
  supporto: lastCrossing?.supporto ?? '',
  // ...
};
```

**ESLint custom rule** opzionale: vietare `Date.now().toString()` in contesti che diventano ID (controllo nome variabile `id` o suffisso `Id`).

---

### 17.10 MEDIA — Photo metadata duplicato (B10) — ✅ FATTO via alternativa pragmatica (sprint6, 2026-06-03)

> Scelta l'**alternativa pragmatica** (no migration v14): nuovo `buildPhotoMetadataFromTable(entryId)` in `mappings.ts` ricostruisce l'array `photos` embedded dalla tabella `photos` (fonte di verità). Entrambi i payload di upload (mapping + structure) lo usano invece di `entry.photos` → drift eliminato all'upload. Lo schema `photos: PhotoMetadata[]` resta intatto; la migration `photoIds` v14 resta opzionale per uno Sprint dedicato.

**Dove**: `MappingEntry.photos[]` (array embedded) vs tabella `photos` separata.

**Root cause**: i due array vanno tenuti in sync manualmente nei sync handler. Su upload, il server assegna `id`, ma l'array embedded ha l'ID locale. Risultato: l'array embedded può divergere dalla tabella.

**Fix architetturale** (v14 Dexie + migration) — rendere `MappingEntry.photos` un array di soli ID:
```ts
// PRIMA
interface MappingEntry {
  photos: PhotoMetadata[];  // duplica id, remoteUrl, timestamp, size
}

// DOPO
interface MappingEntry {
  photoIds: string[];       // solo riferimenti
}
```

**Migration v14**:
```ts
this.version(14).stores({
  // ... stessi indici ...
}).upgrade(async tx => {
  await tx.table('mappingEntries').toCollection().modify((e: any) => {
    e.photoIds = Array.isArray(e.photos) ? e.photos.map((p: any) => p.id) : [];
    delete e.photos;
  });
  await tx.table('structureEntries').toCollection().modify((e: any) => {
    e.photoIds = Array.isArray(e.photos) ? e.photos.map((p: any) => p.id) : [];
    delete e.photos;
  });
});
```

Lettura: `getPhotosForMapping(entryId)` resta uguale (query tabella `photos.where('mappingEntryId').equals(entryId)`).

**Lato server (Postgres)**: la colonna JSONB `photos` su `mapping_entries`/`structure_entries` può restare per back-compat, ma il sync handler la rebuilda da `photos` table prima dell'upload (o la rimuove del tutto in una migrazione successiva).

**Alternativa pragmatica** (meno invasiva): mantenere `photos: PhotoMetadata[]` ma fare in modo che il sync handler **ricarichi sempre da tabella photos** prima di costruire il payload upload — eliminando la possibilità di drift.

---

### 17.11 BASSA — `archived` non filtrato ovunque (B11)

**Dove**: `src/db/projects.ts` + tutte le query `db.projects.*`.

**Root cause**: il filtro `archived === 0` è manuale → ovunque dimenticato, progetti archiviati appaiono.

**Fix** — wrapper centralizzato:
```ts
// src/db/projects.ts
type ProjectQueryOptions = {
  includeArchived?: boolean;
  ownerId?: string;
};

export function queryProjects(opts: ProjectQueryOptions = {}) {
  let q = db.projects.toCollection();
  if (!opts.includeArchived) q = q.filter(p => p.archived === 0);
  if (opts.ownerId) q = q.filter(p => p.ownerId === opts.ownerId);
  return q;
}

// USO ovunque
const active = await queryProjects().toArray();
const all = await queryProjects({ includeArchived: true }).toArray();
```

**ESLint rule custom**: vietare `db.projects.toArray()` diretto fuori da `src/db/projects.ts` — forza l'uso del wrapper.

---

### 17.12 BASSA — Tipologico `number` collision tra utenti (B12)

**Dove**: `src/components/ProjectForm.tsx` editor tipologici + sync handler `syncProject`.

**Root cause**: `number` calcolato client-side come `max+1` sull'array embedded. Due utenti che editano lo stesso progetto offline → entrambi creano un Typology con `number = 3` → al merge, due tipologici con stesso numero (UX confusa, ma non rotta perché PK è `id` UUID).

**Fix** — normalizzazione in tabella separata + UNIQUE constraint:
```sql
CREATE TABLE typologies (
  id            UUID PRIMARY KEY,
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  number        INTEGER NOT NULL,
  category      TEXT NOT NULL CHECK (category IN ('attraversamento','struttura')),
  supporto      TEXT,
  -- ... altri campi ...
  UNIQUE (project_id, number)
);
CREATE INDEX idx_typologies_project ON typologies(project_id);
```

Lato server, trigger di assegnazione automatica del number:
```sql
CREATE OR REPLACE FUNCTION assign_typology_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.number IS NULL THEN
    NEW.number := COALESCE(
      (SELECT MAX(number) FROM typologies WHERE project_id = NEW.project_id), 0
    ) + 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

Tentativi di INSERT con `number` colliso → 23505 unique violation → client gestisce con retry+1.

**Fix minimale (no rewrite)**: lasciare embedded, ma al merge dei conflitti **rinumerare** automaticamente i tipologici remoti con numeri collisi (max(local, remote)+1) e propagare il nuovo number nei `Crossing.tipologicoId` (che è UUID, immune al rename).

---

### 17.13 BASSA — `validateEmailDomain` hardcoded (B13)

**Dove**: `opimappa-server/api/src/index.ts` middleware `validateEmailDomain`.

**Fix** — env var:
```ts
// .env
ALLOWED_EMAIL_DOMAINS=@opifiresafe.com,@partnera.com

// middleware
const ALLOWED_DOMAINS = (process.env.ALLOWED_EMAIL_DOMAINS ?? '@opifiresafe.com')
  .split(',')
  .map(s => s.trim().toLowerCase())
  .filter(Boolean);

export function validateEmailDomain(): MiddlewareHandler {
  return async (c, next) => {
    const body = await c.req.json().catch(() => null);
    const email = String(body?.email ?? '').toLowerCase();
    if (!email || !ALLOWED_DOMAINS.some(d => email.endsWith(d))) {
      return c.json({ error: 'email domain not allowed' }, 403);
    }
    return next();
  };
}
```

E sul client (`Login.tsx`): fetch da `/api/config` la lista domini ammessi (vedi B14).

---

### 17.14 BASSA — `BUCKET_PHOTOS`/`PLANIMETRIE` hardcoded client+server (B14)

**Dove**: `opimappa-server/api/src/storage/minioClient.ts` (server) + `src/lib/storageShim.ts` (client, prefissi `'photos'`/`'planimetrie'`).

**Fix** — endpoint `/api/config` espone configurazione runtime:
```ts
// server
app.get('/api/config', (c) => c.json({
  buckets: {
    photos: BUCKET_PHOTOS,
    planimetrie: BUCKET_PLANIMETRIE,
  },
  auth: {
    allowedDomains: ALLOWED_DOMAINS,
  },
  features: {
    realtime: true,
    offlineAuth: true,
  },
}));
```

```ts
// client — un singolo bootstrap
let runtimeConfig: RuntimeConfig | null = null;
export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  if (runtimeConfig) return runtimeConfig;
  runtimeConfig = await apiFetchJson<RuntimeConfig>('/api/config');
  return runtimeConfig;
}
// chiamato in initializeDatabase() prima di qualsiasi altra cosa
```

`storageShim.ts` userà `runtimeConfig.buckets.*` invece dei letterali. Cambio bucket name = solo restart server, niente rebuild client.

---

### 17.15 Riepilogo priorità

| ID | Severità | Effort | Impatto |
|----|----------|--------|---------|
| B1 (finalizedRef) | ALTA | basso (~30 LOC) | previene data-loss bozze |
| B2 (clearAndSync+SSE) | ALTA | basso (~20 LOC) | previene perdita eventi realtime |
| B3 (originator wrap) | ALTA | medio (refactor middleware) | previene echo loop SSE |
| B4 (sign-many) | ALTA | medio (server endpoint + client refactor) | scalabilità foto/planimetrie |
| B5 (rotazione punti) | MEDIA | basso (~40 LOC + test) | correttezza export PDF |
| B6 (clock skew) | MEDIA | alto (trigger SQL + optimistic locking) | correttezza conflict resolution |
| B7 (assignSal tx) | MEDIA | medio (refactor a transazione+bulk) | atomicità contabilità |
| B8 (cascade quota) | MEDIA | basso (~50 LOC) | resilienza GC locale |
| B9 (Crossing UUID) | MEDIA | banale (1 LOC) | igiene ID |
| B10 (photo dup) | MEDIA | alto (schema v14 + migration) | sorgente unica verità foto |
| B11 (archived) | BASSA | basso (wrapper + ESLint) | UX progetti archiviati |
| B12 (typology #) | BASSA | alto (normalizzazione tabella) | merge conflitti tipologici |
| B13 (email domain) | BASSA | banale (env var) | flessibilità multi-tenant |
| B14 (bucket names) | BASSA | basso (config endpoint) | flessibilità deploy |

**Roadmap suggerita** (in 3 sprint da ~1 settimana):
- **Sprint 1 — Data safety**: B1 + B9 + B7 + B8 (tutto sul wizard/SAL/cascade, basso rischio rotture). ✅ Chiuso 2026-06-03 su `feature/migration-sprint6`: fatti B1, B2, B3, B7 (già ok), B10 (alternativa pragmatica), **B8 (cascade retry + drain)**, **B9 (Crossing.id UUID)**. Tutto Sprint 1 completato.
- **Sprint 2 — Realtime correctness**: B2 + B3 + B4 (sync engine + SSE + storage shim/server endpoint). ✅ Chiuso 2026-06-03: B2/B3 (sprint6), **B4 (chunking client, concorrenza 10)**.
- **Sprint 3 — Correctness export/conflict**: B5 + B6 + B11 + B13 + B14 (export PDF + conflict resolution + config). Lasciare B10 e B12 a un Sprint 4 dedicato a refactor schema.

---

*Fine documento. Generato analizzando `src/` (~36k LOC) su `master`, `opimappa-server/` (Hono/Drizzle/Postgres/MinIO/Caddy) e `src/{lib,realtime,sync,db}` modificati su `feature/migration-sprint6` (+21316/-1257). Diff totali analizzati: 3717 righe. Schema autoritativo: `supabase/schema.sql` (1043 righe). Wiring SSE: 2 listener (`handleProjectDeleteLocal`, `handleStaleView`) — invalidation-only, no data-application.*
