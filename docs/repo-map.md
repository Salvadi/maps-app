# Repo Map

Initial map generated from the current workspace.

## Root

- `package.json` - app metadata and npm scripts (`opimappa`).
- `craco.config.js` - CRA override entry.
- `tsconfig.json` - TypeScript config.
- `tailwind.config.js`, `postcss.config.js` - styling toolchain.
- `vercel.json` - Vercel deployment and CSP-related config.
- `README.md` - general project documentation.
- `CLAUDE.md` - Claude orchestration manual.
- `AGENTS.md` - Codex CLI instructions.
- `STRUTTURE_PLAN.md` - structures-related planning document.
- `CLAUDE backup con kimi2.6.md` - untracked backup/reference file.

## App Entry Points

- `src/index.tsx` - React app bootstrap and service worker registration path.
- `src/App.tsx` - main app shell, state-based routing, sync notifications, lazy views.
- `src/App.test.tsx` - top-level app test.
- `src/index.css`, `src/App.css` - global/app styles.

## Main Source Folders

- `src/components/` - UI screens and feature components.
- `src/db/` - Dexie/IndexedDB data layer.
- `src/sync/` - Supabase sync engine.
- `src/lib/` - Supabase client/types and forced migration helper.
- `src/hooks/` - reusable React hooks.
- `src/utils/` - export, floor-plan, and validation utilities.
- `src/config/` - static product/support/dropdown configuration.

## DB / Dexie Files

- `src/db/database.ts` - Dexie schema, interfaces, tables, `generateId()`, `now()`. Current schema includes versions through v11.
- `src/db/index.ts` - data-layer barrel exports.
- `src/db/onlineFirst.ts` - shared online-first helpers and pending local overlay helpers.
- `src/db/projects.ts` - project CRUD and related cascade/queue behavior.
- `src/db/mappings.ts` - mapping entries and photo access/hydration behavior.
- `src/db/floorPlans.ts` - floor plans, floor plan points, storage URL signing/download, standalone maps.
- `src/db/structures.ts` - structure entries and related photos/sync behavior.
- `src/db/sal.ts` - SAL operations.
- `src/db/pricing.ts` - typology price operations.
- `src/db/dropdownOptions.ts` - Supabase/cache/static fallback dropdown options.
- `src/db/auth.ts` - Supabase auth with offline/local fallback.
- `src/db/__tests__/sal.module.test.ts` - SAL module tests.

## Online-First Files

- `src/db/onlineFirst.ts` - core helper file.
- Online-first callers found in `src/db/floorPlans.ts`, `src/db/mappings.ts`, `src/db/pricing.ts`, `src/db/sal.ts`, `src/db/structures.ts`.
- `src/sync/syncDownloadHandlers.ts` uses `getPendingEntityIds()` to avoid overwriting local pending records.

## Sync Files

- `src/sync/syncEngine.ts` - sync queue processing, deduplication, auto/manual sync, `lockedSync`, `clearAndSync`, sync completion listeners.
- `src/sync/syncUploadHandlers.ts` - upload handlers for entity types and storage assets.
- `src/sync/syncDownloadHandlers.ts` - Supabase download handlers, remote photo/floor-plan handling.
- `src/sync/conflictResolution.ts` - conflict strategies and `checkForConflicts`.

## Supabase Files

- `src/lib/supabase.ts` - Supabase client and generated/manual `Database` type shape.
- `supabase/schema.sql` - authoritative idempotent schema and RLS policy definitions.
- `supabase/storage-policies.sql` - storage buckets and policies (`photos`, `planimetrie`).
- `supabase/STRUCTURES_MIGRATION.sql` - structures migration/reference SQL. Confirm before treating as authoritative.
- `supabase/.temp/` - local Supabase temp area.

## Storage / Photo / Planimetry Files

- `src/db/mappings.ts` - mapping photos, remote-only photo metadata, blob hydration.
- `src/db/structures.ts` - structure photos.
- `src/db/floorPlans.ts` - floor-plan image/PDF storage, signed URLs, thumbnails.
- `src/components\MappingPage.tsx`, `src/components\MappingWizard.tsx`, `src/components\StructureWizard.tsx` - photo capture/compression and point placement flows.
- `src/components\MappingEntryCard.tsx`, `src/components\PhotoPreviewModal.tsx` - photo display/preview.
- `src/components\FloorPlanEditor.tsx`, `src/components\FloorPlanCanvas.tsx`, `src/components\StandaloneFloorPlanEditor.tsx` - planimetry editing and rendering.
- `src/components\MapsOverview.tsx`, `src/components\ProjectDetail.tsx`, `src/components\ProjectForm.tsx` - floor-plan/project integrations.
- `src/utils/floorPlanExport.ts`, `src/utils/floorPlanUtils.ts`, `src/components/useMappingExports.ts` - planimetry and export helpers.

## PWA / Service Worker

- `public/service-worker.js` - custom service worker.
- `src/serviceWorkerRegistration.ts` - registration/update hooks.
- `src/components/UpdateNotification.tsx` - update prompt and local data refresh flow.
- `scripts/inject-sw-version.js` - build-time service worker version injection.
- `docs/UPDATE_SYSTEM.md` - update-flow documentation.

## Documentation

- `docs/README.md` - docs index/overview.
- `docs/CONFLICT_RESOLUTION.md` - conflict handling documentation.
- `docs/SUPABASE_SETUP.md` - Supabase setup.
- `docs/UPDATE_SYSTEM.md` - PWA update system.
- `docs/DEPLOYMENT.md` - deployment notes.
- `docs/REVIEW-FIXES.md`, `docs/plan-v4*.md`, `docs/homeserver-opimappa-plan-*.md` - planning/review docs currently present.
- `docs/ai-workflow.md` - Claude/Codex workflow.
- `docs/task-template.md` - reusable task spec.
- `docs/codex-reader-prompt.md`, `docs/codex-writer-prompt.md`, `docs/codex-reviewer-prompt.md` - reusable Codex prompts.
- `docs/claude-orchestrator-prompt.md` - reusable Claude prompt.

## Package Scripts

From `package.json`:

```json
{
  "start": "craco start",
  "build": "craco build && node scripts/inject-sw-version.js",
  "test": "craco test",
  "eject": "react-scripts eject"
}
```

## Tests

- `src/App.test.tsx`
- `src/db/__tests__/sal.module.test.ts`
- `src/utils/__tests__/exportUtils.test.ts`
- `src/components/__tests__/FloorPlanEditor.test.tsx`
- `src/components/__tests__/ProjectList.test.tsx`
- `src/components/__tests__/StandaloneFloorPlanEditor.test.tsx`

## Adjacent / Uncertain Areas

- `opimappa-server/` is present and untracked in git status. It appears to be a separate homeserver/API experiment with its own `package.json`, Docker config, Drizzle schema, routes, tests, and `node_modules`. Treat as separate unless the task explicitly includes it.
- `scripts/ai-workers/` is untracked and appears to contain older/local AI worker scripts. The new enforced workflow is Claude Code + Codex CLI.
- `supabase/STRUCTURES_MIGRATION.sql` may be historical or supplemental. Confirm against `supabase/schema.sql` before using it.
- `CLAUDE backup con kimi2.6.md` is a backup/reference file, not the active instruction file.
