/**
 * @file Sync Engine - Orchestratore della sincronizzazione
 * @description Gestisce la coda di sync locale, l'event system, il lock,
 * e le operazioni di sincronizzazione bidirezionale con Supabase.
 * Le operazioni di upload specifiche per entità sono in syncUploadHandlers.ts.
 * Le operazioni di download da Supabase sono in syncDownloadHandlers.ts.
 */

import { db, SyncQueueItem } from '../db/database';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { refreshDropdownCaches } from '../db/dropdownOptions';
import { processSyncItem } from './syncUploadHandlers';
import {
  downloadProjectsFromSupabase,
  downloadMappingEntriesFromSupabase,
  downloadPhotosFromSupabase,
  downloadFloorPlansFromSupabase,
  downloadFloorPlanPointsFromSupabase,
  updateRemotePhotosFlags
} from './syncDownloadHandlers';

// ============================================
// SEZIONE: Interfacce e tipi pubblici
// Tipi di ritorno usati dalle funzioni di sincronizzazione e dai componenti UI.
// ============================================

export interface SyncResult {
  success: boolean;
  processedCount: number;
  failedCount: number;
  errors: Array<{ item: SyncQueueItem; error: string }>;
}

export interface SyncStats {
  pendingCount: number;
  lastSyncTime: number | null;
  isSyncing: boolean;
}

// ============================================
// SEZIONE: Deduplicazione coda di sync
// Elimina operazioni ridondanti sulla stessa entità prima del processing.
// Regole: UPDATE multipli → tieni solo l'ultimo; CREATE+UPDATE → tieni CREATE
// con payload aggiornato; CREATE/UPDATE+DELETE → tieni solo DELETE.
// ============================================

async function deduplicateSyncQueue(): Promise<{ before: number; after: number }> {
  const pendingItems = await db.syncQueue
    .where('synced')
    .equals(0)
    .sortBy('timestamp');

  if (pendingItems.length <= 1) {
    return { before: pendingItems.length, after: pendingItems.length };
  }

  // Group by entityType+entityId
  const groups = new Map<string, SyncQueueItem[]>();
  for (const item of pendingItems) {
    const key = `${item.entityType}:${item.entityId}`;
    const group = groups.get(key) || [];
    group.push(item);
    groups.set(key, group);
  }

  const toRemove: string[] = [];
  const groupEntries = Array.from(groups.values());

  for (const items of groupEntries) {
    if (items.length <= 1) continue;

    const hasDelete = items.some((i: SyncQueueItem) => i.operation === 'DELETE');
    const hasCreate = items.find((i: SyncQueueItem) => i.operation === 'CREATE');
    const lastItem = items[items.length - 1]; // Most recent by timestamp

    if (hasDelete) {
      // DELETE wins: remove all items except the last DELETE
      const lastDelete = [...items].reverse().find((i: SyncQueueItem) => i.operation === 'DELETE')!;
      for (const item of items) {
        if (item.id !== lastDelete.id) {
          toRemove.push(item.id);
        }
      }
    } else if (hasCreate) {
      // CREATE + UPDATEs: keep CREATE with latest payload
      const latestPayload = lastItem.payload;
      await db.syncQueue.update(hasCreate.id, { payload: latestPayload });
      for (const item of items) {
        if (item.id !== hasCreate.id) {
          toRemove.push(item.id);
        }
      }
    } else {
      // Multiple UPDATEs: keep only the last one
      for (const item of items) {
        if (item.id !== lastItem.id) {
          toRemove.push(item.id);
        }
      }
    }
  }

  if (toRemove.length > 0) {
    // Mark deduplicated items as synced so they won't be processed
    for (const id of toRemove) {
      await db.syncQueue.update(id, { synced: 1 });
    }
    console.log(`🔄 Deduplicati ${pendingItems.length} → ${pendingItems.length - toRemove.length} items nella sync queue`);
  }

  return { before: pendingItems.length, after: pendingItems.length - toRemove.length };
}

// ============================================
// SEZIONE: Event system per completamento sync
// Permette ai componenti React di reagire al completamento della sync
// senza polling: si registrano con onSyncComplete e ricevono i SyncStats aggiornati.
// ============================================

type SyncCompleteListener = (stats: SyncStats) => void;
const syncListeners: Set<SyncCompleteListener> = new Set();

export function onSyncComplete(cb: SyncCompleteListener): void {
  syncListeners.add(cb);
}

export function offSyncComplete(cb: SyncCompleteListener): void {
  syncListeners.delete(cb);
}

async function emitSyncComplete(): Promise<void> {
  const stats = await getSyncStats();
  syncListeners.forEach(cb => cb(stats));
}

// ============================================
// SEZIONE: Upload immediato con debounce
// Dopo una modifica locale, triggerImmediateUpload avvia l'upload con
// un ritardo di 2 secondi per raggruppare modifiche ravvicinate in un unico batch.
// ============================================

let uploadDebounceTimer: ReturnType<typeof setTimeout> | null = null;

export function triggerImmediateUpload(): void {
  if (uploadDebounceTimer) clearTimeout(uploadDebounceTimer);
  uploadDebounceTimer = setTimeout(async () => {
    try {
      if (!navigator.onLine || !isSupabaseConfigured()) return;
      const isSyncingMeta = await db.metadata.get('isSyncing');
      // Check timestamp-based lock
      const LOCK_TIMEOUT = 3 * 60 * 1000;
      if (isSyncingMeta?.value && (Date.now() - isSyncingMeta.value) < LOCK_TIMEOUT) return;
      await processSyncQueue();
    } catch (err) {
      console.error('Debounced upload failed:', err);
    }
  }, 2000);
}

// ============================================
// SEZIONE: Lock di sincronizzazione (timestamp-based)
// Previene sync concorrenti: il lock scade automaticamente dopo 3 minuti
// per evitare blocchi permanenti in caso di crash o eccezioni non gestite.
// ============================================

const SYNC_LOCK_TIMEOUT = 3 * 60 * 1000; // 3 minutes

async function acquireSyncLock(): Promise<boolean> {
  const isSyncingMeta = await db.metadata.get('isSyncing');
  if (isSyncingMeta?.value && (Date.now() - isSyncingMeta.value) < SYNC_LOCK_TIMEOUT) {
    return false; // Lock is held and not expired
  }
  await db.metadata.put({ key: 'isSyncing', value: Date.now() });
  return true;
}

async function releaseSyncLock(): Promise<void> {
  await db.metadata.put({ key: 'isSyncing', value: false });
}

// ============================================
// SEZIONE: Processing della coda di upload
// Prende tutti gli item in attesa, li deduplica, li processa in ordine
// tramite processSyncItem (da syncUploadHandlers.ts).
// Gestisce retry (max 5) e aggiorna il timestamp dell'ultima sync.
// ============================================

/**
 * Process all pending items in the sync queue
 * Returns the number of items successfully synced
 */
export async function processSyncQueue(): Promise<SyncResult> {
  if (!isSupabaseConfigured()) {
    console.warn('⚠️  Sync skipped: Supabase not configured');
    return {
      success: false,
      processedCount: 0,
      failedCount: 0,
      errors: [{ item: {} as SyncQueueItem, error: 'Supabase not configured' }]
    };
  }

  if (!navigator.onLine) {
    console.warn('⚠️  Sync skipped: No internet connection');
    return {
      success: false,
      processedCount: 0,
      failedCount: 0,
      errors: [{ item: {} as SyncQueueItem, error: 'No internet connection' }]
    };
  }

  // Check if user is authenticated
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    console.warn('⚠️  Sync skipped: User not authenticated');
    return {
      success: false,
      processedCount: 0,
      failedCount: 0,
      errors: [{ item: {} as SyncQueueItem, error: 'User not authenticated. Please log in to sync data.' }]
    };
  }

  // Deduplicate queue before processing
  await deduplicateSyncQueue();

  // Get all unsynced items, ordered by timestamp
  const pendingItems = await db.syncQueue
    .where('synced')
    .equals(0)
    .sortBy('timestamp');

  if (pendingItems.length === 0) {
    console.log('✅ Sync queue empty');
    await emitSyncComplete();
    return {
      success: true,
      processedCount: 0,
      failedCount: 0,
      errors: []
    };
  }

  console.log(`🔄 Processing ${pendingItems.length} sync queue items as user ${session.user.id}...`);

  let processedCount = 0;
  let failedCount = 0;
  const errors: Array<{ item: SyncQueueItem; error: string }> = [];

  const MAX_RETRIES = 5;

  // Process items sequentially to maintain order
  for (const item of pendingItems) {
    // Skip items that have exceeded retry limit
    if ((item.retryCount || 0) >= MAX_RETRIES) {
      console.warn(`⏭️ Skipping permanently failed item: ${item.entityType} ${item.entityId} (${item.retryCount} retries)`);
      continue;
    }

    try {
      await processSyncItem(item);

      // Mark as synced
      await db.syncQueue.update(item.id, { synced: 1 });
      processedCount++;

      console.log(`✅ Synced ${item.entityType} ${item.operation}:`, item.entityId);
    } catch (err) {
      failedCount++;
      const errorMessage = err instanceof Error ? err.message : String(err);
      errors.push({ item, error: errorMessage });

      // Increment retry count
      await db.syncQueue.update(item.id, {
        retryCount: (item.retryCount || 0) + 1
      });

      console.error(`❌ Failed to sync ${item.entityType} ${item.operation} (retry ${(item.retryCount || 0) + 1}/${MAX_RETRIES}):`, errorMessage);
    }
  }

  // Update last sync time
  await db.metadata.put({ key: 'lastSyncTime', value: Date.now() });

  // Clean up synced items from the queue (housekeeping)
  if (processedCount > 0) {
    const cleanedCount = await clearSyncedItems();
    if (cleanedCount > 0) {
      console.log(`🗑️  Cleaned up ${cleanedCount} synced items from queue`);
    }
  }

  const result: SyncResult = {
    success: failedCount === 0,
    processedCount,
    failedCount,
    errors
  };

  if (result.success) {
    console.log(`✅ Sync complete: ${processedCount} items synced`);
  } else {
    console.warn(`⚠️  Sync partial: ${processedCount} success, ${failedCount} failed`);
  }

  await emitSyncComplete();
  return result;
}

// ============================================
// SEZIONE: Statistiche e pulizia coda
// getSyncStats: legge stato corrente (pending count, last sync time, is syncing).
// clearSyncedItems: rimuove dalla coda gli item già sincronizzati (housekeeping).
// ============================================

/**
 * Get sync statistics
 */
export async function getSyncStats(): Promise<SyncStats> {
  const pendingCount = await db.syncQueue
    .where('synced')
    .equals(0)
    .count();

  const lastSyncMeta = await db.metadata.get('lastSyncTime');
  const lastSyncTime = lastSyncMeta?.value || null;

  const isSyncingMeta = await db.metadata.get('isSyncing');
  // Timestamp-based lock: consider active only if within timeout
  const isSyncing = isSyncingMeta?.value
    ? (Date.now() - isSyncingMeta.value) < SYNC_LOCK_TIMEOUT
    : false;

  return {
    pendingCount,
    lastSyncTime,
    isSyncing
  };
}

/**
 * Clear all synced items from the queue (housekeeping)
 */
export async function clearSyncedItems(): Promise<number> {
  const syncedItems = await db.syncQueue
    .where('synced')
    .equals(1)
    .toArray();

  await db.syncQueue.bulkDelete(syncedItems.map(item => item.id));

  console.log(`🗑️  Cleared ${syncedItems.length} synced items from queue`);
  return syncedItems.length;
}

// ============================================
// SEZIONE: Re-export funzioni download
// Le funzioni di download sono definite in syncDownloadHandlers.ts.
// Re-esportate qui per retrocompatibilità con i file che le importano da syncEngine.
// ============================================

export {
  downloadProjectsFromSupabase,
  downloadMappingEntriesFromSupabase,
  downloadPhotosFromSupabase,
  downloadFloorPlansFromSupabase,
  downloadFloorPlanPointsFromSupabase
};

// ============================================
// SEZIONE: Sync FROM Supabase (download completo)
// Scarica progetti, entries, foto, planimetrie e punti in un'unica operazione.
// Usato dall'auto-sync periodico e come base di phasedSyncFromSupabase.
// ============================================

/**
 * Sync data FROM Supabase TO local IndexedDB
 * This is the "pull" operation that complements the "push" in processSyncQueue
 */
export async function syncFromSupabase(): Promise<{ projectsCount: number; entriesCount: number; photosCount: number; photosFailedCount: number; floorPlansCount: number; floorPlanPointsCount: number }> {
  if (!isSupabaseConfigured()) {
    console.warn('⚠️  Sync from Supabase skipped: Supabase not configured');
    return { projectsCount: 0, entriesCount: 0, photosCount: 0, photosFailedCount: 0, floorPlansCount: 0, floorPlanPointsCount: 0 };
  }

  // Check if user is authenticated
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    console.warn('⚠️  Sync from Supabase skipped: User not authenticated');
    return { projectsCount: 0, entriesCount: 0, photosCount: 0, photosFailedCount: 0, floorPlansCount: 0, floorPlanPointsCount: 0 };
  }

  console.log('⬇️  Starting sync FROM Supabase...');

  try {
    // Get user profile once to check if admin
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', session.user.id)
      .single();

    if (profileError) {
      console.error('⚠️  Failed to get user profile for sync:', profileError.message);
      console.error('⚠️  Continuing with regular user permissions');
    }

    const isAdmin = profile?.role === 'admin';

    if (isAdmin) {
      console.log('👑 Admin user detected: will sync all projects');
    } else {
      console.log('👤 Regular user: will sync accessible projects only');
    }

    const projectsCount = await downloadProjectsFromSupabase(session.user.id, isAdmin);
    const entriesCount = await downloadMappingEntriesFromSupabase(session.user.id, isAdmin);
    const photosResult = await downloadPhotosFromSupabase(session.user.id, isAdmin);
    const floorPlansCount = await downloadFloorPlansFromSupabase(session.user.id, isAdmin);
    const floorPlanPointsCount = await downloadFloorPlanPointsFromSupabase(session.user.id, isAdmin);

    const photosCount = photosResult.downloaded;
    const photosFailedCount = photosResult.failed;

    console.log(`✅ Sync from Supabase complete: ${projectsCount} projects, ${entriesCount} entries, ${photosCount} photos${photosFailedCount > 0 ? ` (${photosFailedCount} failed)` : ''}, ${floorPlansCount} floor plans, ${floorPlanPointsCount} floor plan points`);

    await emitSyncComplete();
    return { projectsCount, entriesCount, photosCount, photosFailedCount, floorPlansCount, floorPlanPointsCount };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error('❌ Sync from Supabase failed:', errorMessage);
    throw err;
  }
}

// ============================================
// SEZIONE: Auto-sync periodico
// startAutoSync: avvia il timer di sync automatico bidirezionale.
// stopAutoSync: ferma il timer. Usa il lock per evitare sync concorrenti.
// ============================================

/**
 * Auto-sync on interval (call this on app startup)
 */
let syncInterval: NodeJS.Timeout | null = null;

export function startAutoSync(intervalMs: number = 30000): void {
  if (syncInterval) {
    console.warn('⚠️  Auto-sync already running');
    return;
  }

  console.log(`🔄 Starting auto-sync (bidirectional) every ${intervalMs / 1000}s`);

  // Sync immediately (both upload and download)
  Promise.all([
    processSyncQueue().catch(err => {
      console.error('❌ Initial upload sync failed:', err);
    }),
    syncFromSupabase().catch(err => {
      console.error('❌ Initial download sync failed:', err);
    })
  ]);

  // Then sync on interval (bidirectional with timestamp lock)
  syncInterval = setInterval(async () => {
    try {
      if (!await acquireSyncLock()) {
        console.log('⏭️  Auto-sync skipped: sync already in progress');
        return;
      }

      try {
        await processSyncQueue();
        await syncFromSupabase();
      } finally {
        await releaseSyncLock();
      }
    } catch (err) {
      console.error('❌ Auto-sync failed:', err);
      await releaseSyncLock();
    }
  }, intervalMs);
}

export function stopAutoSync(): void {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
    console.log('⏹️  Auto-sync stopped');
  }
}

// ============================================
// SEZIONE: Sync manuale (manualSync)
// Sync bidirezionale con lock atomico: prima upload locale, poi download remoto
// con approccio a fasi. Aggiorna anche le cache dei dropdown al completamento.
// ============================================

/**
 * Manual sync trigger (for UI button)
 * Performs bidirectional sync with atomic lock: upload local changes and download remote changes
 */
export async function manualSync(options?: {
  skipPhotos?: boolean;
  onPhotoDecisionNeeded?: () => Promise<boolean>;
}): Promise<{
  uploadResult: SyncResult;
  downloadResult: { projectsCount: number; entriesCount: number; photosCount: number; photosFailedCount: number; floorPlansCount: number; floorPlanPointsCount: number }
}> {
  console.log('🔄 Manual bidirectional sync triggered');

  if (!await acquireSyncLock()) {
    console.warn('⚠️  Sync already in progress, skipping');
    return {
      uploadResult: { success: false, processedCount: 0, failedCount: 0, errors: [] },
      downloadResult: { projectsCount: 0, entriesCount: 0, photosCount: 0, photosFailedCount: 0, floorPlansCount: 0, floorPlanPointsCount: 0 }
    };
  }

  try {
    // Upload local changes FIRST
    const uploadResult = await processSyncQueue();

    // Download remote changes with phased approach
    const downloadResult = await phasedSyncFromSupabase(options);

    // Refresh dropdown option caches
    await refreshDropdownCaches().catch(err => console.warn('Dropdown cache refresh failed:', err));

    console.log(`✅ Manual sync complete: uploaded ${uploadResult.processedCount} items, downloaded ${downloadResult.projectsCount} projects, ${downloadResult.entriesCount} entries, ${downloadResult.photosCount} photos${downloadResult.photosFailedCount > 0 ? ` (${downloadResult.photosFailedCount} failed)` : ''}, ${downloadResult.floorPlansCount} floor plans, and ${downloadResult.floorPlanPointsCount} floor plan points`);

    await emitSyncComplete();
    return { uploadResult, downloadResult };
  } catch (error) {
    console.error('❌ Manual sync failed:', error);
    throw error;
  } finally {
    await releaseSyncLock();
  }
}

// ============================================
// SEZIONE: Sync a fasi (phasedSyncFromSupabase)
// Scarica in 3 fasi: 1) dati principali, 2) planimetrie+punti, 3) foto (opzionale).
// Permette all'utente di scegliere se scaricare le foto tramite onPhotoDecisionNeeded.
// Se le foto sono saltate, aggiorna i flag hasRemotePhotos sulle mapping entries.
// ============================================

/**
 * Phased sync from Supabase: data → floor plans → photos (optional)
 * Used by manualSync to allow user choice on photo download
 */
export async function phasedSyncFromSupabase(options?: {
  skipPhotos?: boolean;
  onPhotoDecisionNeeded?: () => Promise<boolean>;
}): Promise<{ projectsCount: number; entriesCount: number; photosCount: number; photosFailedCount: number; floorPlansCount: number; floorPlanPointsCount: number }> {
  if (!isSupabaseConfigured()) {
    return { projectsCount: 0, entriesCount: 0, photosCount: 0, photosFailedCount: 0, floorPlansCount: 0, floorPlanPointsCount: 0 };
  }

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    return { projectsCount: 0, entriesCount: 0, photosCount: 0, photosFailedCount: 0, floorPlansCount: 0, floorPlanPointsCount: 0 };
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', session.user.id)
    .single();

  const isAdmin = profile?.role === 'admin';

  // Phase 1: Data (projects + mapping entries)
  console.log('📦 Fase 1: Sincronizzazione dati...');
  const projectsCount = await downloadProjectsFromSupabase(session.user.id, isAdmin);
  const entriesCount = await downloadMappingEntriesFromSupabase(session.user.id, isAdmin);

  // Phase 2: Floor plans + points
  console.log('🗺️ Fase 2: Sincronizzazione planimetrie...');
  const floorPlansCount = await downloadFloorPlansFromSupabase(session.user.id, isAdmin);
  const floorPlanPointsCount = await downloadFloorPlanPointsFromSupabase(session.user.id, isAdmin);

  // Phase 3: Photos (optional)
  let photosCount = 0;
  let photosFailedCount = 0;

  let shouldDownloadPhotos = !options?.skipPhotos;

  if (shouldDownloadPhotos && options?.onPhotoDecisionNeeded) {
    shouldDownloadPhotos = await options.onPhotoDecisionNeeded();
  }

  if (shouldDownloadPhotos) {
    console.log('📸 Fase 3: Sincronizzazione foto...');
    const photosResult = await downloadPhotosFromSupabase(session.user.id, isAdmin);
    photosCount = photosResult.downloaded;
    photosFailedCount = photosResult.failed;
  } else {
    console.log('📸 Fase 3: Foto saltate (scelta utente)');
    // Update hasRemotePhotos flags for entries that have photos on server but not locally
    await updateRemotePhotosFlags(session.user.id, isAdmin);
  }

  return { projectsCount, entriesCount, photosCount, photosFailedCount, floorPlansCount, floorPlanPointsCount };
}

// ============================================
// SEZIONE: Clear and sync
// Cancella tutti i dati locali e riscarica tutto da Supabase.
// Utile per risolvere discrepanze persistenti tra locale e remoto.
// Preserva solo i dati di autenticazione (users, currentUser metadata).
// ============================================

/**
 * Clear all local data and re-sync from Supabase
 * This is useful to resolve data discrepancies between local and remote
 */
export async function clearAndSync(): Promise<{
  downloadResult: { projectsCount: number; entriesCount: number; photosCount: number; floorPlansCount: number; floorPlanPointsCount: number }
}> {
  console.log('🗑️ Clear and sync triggered - clearing all local data...');

  if (!isSupabaseConfigured()) {
    throw new Error('Supabase not configured. Cannot sync.');
  }

  // Check if user is authenticated
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    throw new Error('User not authenticated. Please log in to sync data.');
  }

  try {
    // Clear all data from IndexedDB
    await db.projects.clear();
    await db.mappingEntries.clear();
    await db.photos.clear();
    await db.floorPlans.clear();
    await db.floorPlanPoints.clear();
    await db.standaloneMaps.clear();
    await db.syncQueue.clear();
    // Don't clear users table - keep authentication data

    // Reset metadata but keep currentUser
    const currentUserMeta = await db.metadata.get('currentUser');
    await db.metadata.clear();
    if (currentUserMeta) {
      await db.metadata.put(currentUserMeta);
    }
    await db.metadata.put({ key: 'lastSyncTime', value: 0 });

    console.log('✅ Local data cleared successfully');

    // Download fresh data from Supabase
    console.log('⬇️ Downloading fresh data from Supabase...');
    const downloadResult = await syncFromSupabase();

    console.log(`✅ Clear and sync complete: downloaded ${downloadResult.projectsCount} projects, ${downloadResult.entriesCount} entries, ${downloadResult.photosCount} photos, ${downloadResult.floorPlansCount} floor plans, and ${downloadResult.floorPlanPointsCount} floor plan points`);

    return { downloadResult };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error('❌ Clear and sync failed:', errorMessage);
    throw err;
  }
}