import { db, Project, MappingEntry, Photo, SyncQueueItem } from '../db/database';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { checkForConflicts, resolveProjectConflict, resolveMappingEntryConflict } from './conflictResolution';

/**
 * Sync Engine for Phase 3
 *
 * Processes the local sync queue and uploads changes to Supabase
 * Handles projects, mapping entries, and photos
 */

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

  // Get all unsynced items, ordered by timestamp
  const pendingItems = await db.syncQueue
    .where('synced')
    .equals(0)
    .sortBy('timestamp');

  if (pendingItems.length === 0) {
    console.log('✅ Sync queue empty');
    return {
      success: true,
      processedCount: 0,
      failedCount: 0,
      errors: []
    };
  }

  console.log(`🔄 Processing ${pendingItems.length} sync queue items...`);

  let processedCount = 0;
  let failedCount = 0;
  const errors: Array<{ item: SyncQueueItem; error: string }> = [];

  // Process items sequentially to maintain order
  for (const item of pendingItems) {
    try {
      await processSyncItem(item);

      // Mark as synced
      await db.syncQueue.update(item.id, { synced: true });
      processedCount++;

      console.log(`✅ Synced ${item.entityType} ${item.operation}:`, item.entityId);
    } catch (err) {
      failedCount++;
      const errorMessage = err instanceof Error ? err.message : String(err);
      errors.push({ item, error: errorMessage });

      console.error(`❌ Failed to sync ${item.entityType} ${item.operation}:`, errorMessage);

      // Continue processing other items even if one fails
    }
  }

  // Update last sync time
  await db.metadata.put({ key: 'lastSyncTime', value: Date.now() });

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

  return result;
}

/**
 * Process a single sync queue item
 */
async function processSyncItem(item: SyncQueueItem): Promise<void> {
  switch (item.entityType) {
    case 'project':
      await syncProject(item);
      break;
    case 'mapping':
      await syncMappingEntry(item);
      break;
    case 'photo':
      await syncPhoto(item);
      break;
    default:
      throw new Error(`Unknown entity type: ${item.entityType}`);
  }
}

/**
 * Sync a project to Supabase
 */
async function syncProject(item: SyncQueueItem): Promise<void> {
  let project = item.payload as Project;

  if (item.operation === 'CREATE' || item.operation === 'UPDATE') {
    // Check for conflicts before syncing
    const { hasConflict, remote } = await checkForConflicts('project', project.id);

    if (hasConflict && remote) {
      console.log(`⚠️  Conflict detected for project ${project.id}`);

      // Resolve conflict using last-modified-wins strategy
      project = await resolveProjectConflict(project, remote, 'last-modified-wins');

      // Update local database with resolved version
      await db.projects.put(project);
      console.log(`✅ Conflict resolved for project ${project.id}`);
    }

    // Convert IndexedDB format to Supabase format
    const supabaseProject = {
      id: project.id,
      title: project.title,
      client: project.client,
      address: project.address,
      notes: project.notes,
      floors: project.floors,
      plans: project.plans,
      use_room_numbering: project.useRoomNumbering,
      use_intervention_numbering: project.useInterventionNumbering,
      typologies: project.typologies,
      owner_id: project.ownerId,
      accessible_users: project.accessibleUsers,
      created_at: new Date(project.createdAt).toISOString(),
      updated_at: new Date(project.updatedAt).toISOString(),
      synced: true
    };

    // Upsert (insert or update)
    const { error } = await supabase
      .from('projects')
      .upsert(supabaseProject, {
        onConflict: 'id'
      });

    if (error) {
      throw new Error(`Supabase project upsert failed: ${error.message}`);
    }

    // Mark local project as synced
    await db.projects.update(project.id, { synced: true });
  } else if (item.operation === 'DELETE') {
    const { error } = await supabase
      .from('projects')
      .delete()
      .eq('id', project.id);

    if (error) {
      throw new Error(`Supabase project delete failed: ${error.message}`);
    }
  }
}

/**
 * Sync a mapping entry to Supabase
 */
async function syncMappingEntry(item: SyncQueueItem): Promise<void> {
  let entry = item.payload as MappingEntry;

  if (item.operation === 'CREATE' || item.operation === 'UPDATE') {
    // Check for conflicts before syncing
    const { hasConflict, remote } = await checkForConflicts('mapping', entry.id);

    if (hasConflict && remote) {
      console.log(`⚠️  Conflict detected for mapping entry ${entry.id}`);

      // Resolve conflict using last-modified-wins strategy
      entry = await resolveMappingEntryConflict(entry, remote, 'last-modified-wins');

      // Update local database with resolved version
      await db.mappingEntries.put(entry);
      console.log(`✅ Conflict resolved for mapping entry ${entry.id}`);
    }

    const supabaseEntry = {
      id: entry.id,
      project_id: entry.projectId,
      floor: entry.floor,
      room_or_intervention: entry.roomOrIntervention,
      crossings: entry.crossings,
      timestamp: entry.timestamp,
      last_modified: entry.lastModified,
      version: entry.version,
      created_by: entry.createdBy,
      modified_by: entry.modifiedBy,
      photos: entry.photos,
      synced: true,
      created_at: new Date(entry.timestamp).toISOString(),
      updated_at: new Date(entry.lastModified).toISOString()
    };

    const { error } = await supabase
      .from('mapping_entries')
      .upsert(supabaseEntry, {
        onConflict: 'id'
      });

    if (error) {
      throw new Error(`Supabase mapping entry upsert failed: ${error.message}`);
    }

    // Mark local entry as synced
    await db.mappingEntries.update(entry.id, { synced: true });
  } else if (item.operation === 'DELETE') {
    const { error } = await supabase
      .from('mapping_entries')
      .delete()
      .eq('id', entry.id);

    if (error) {
      throw new Error(`Supabase mapping entry delete failed: ${error.message}`);
    }
  }
}

/**
 * Sync a photo to Supabase Storage
 */
async function syncPhoto(item: SyncQueueItem): Promise<void> {
  const photoMeta = item.payload as Photo;

  if (item.operation === 'CREATE' || item.operation === 'UPDATE') {
    // Get the actual photo blob from IndexedDB
    const photo = await db.photos.get(photoMeta.id);

    if (!photo || !photo.blob) {
      throw new Error(`Photo blob not found: ${photoMeta.id}`);
    }

    // Upload to Supabase Storage
    const fileName = `${photoMeta.mappingEntryId}/${photoMeta.id}.jpg`;
    const { error: uploadError } = await supabase.storage
      .from('photos')
      .upload(fileName, photo.blob, {
        contentType: photo.blob.type,
        upsert: true
      });

    if (uploadError) {
      throw new Error(`Supabase photo upload failed: ${uploadError.message}`);
    }

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('photos')
      .getPublicUrl(fileName);

    // Create photo metadata record in Supabase
    const { error: metaError } = await supabase
      .from('photos')
      .upsert({
        id: photoMeta.id,
        mapping_entry_id: photoMeta.mappingEntryId,
        storage_path: fileName,
        url: publicUrl,
        metadata: photoMeta.metadata,
        uploaded: true,
        created_at: new Date(photoMeta.metadata.captureTimestamp).toISOString(),
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'id'
      });

    if (metaError) {
      throw new Error(`Supabase photo metadata upsert failed: ${metaError.message}`);
    }

    // Mark local photo as uploaded
    await db.photos.update(photoMeta.id, { uploaded: true });
  } else if (item.operation === 'DELETE') {
    // Delete from storage
    const photo = await db.photos.get(photoMeta.id);
    if (photo) {
      const fileName = `${photoMeta.mappingEntryId}/${photoMeta.id}.jpg`;
      await supabase.storage
        .from('photos')
        .remove([fileName]);
    }

    // Delete metadata
    const { error } = await supabase
      .from('photos')
      .delete()
      .eq('id', photoMeta.id);

    if (error) {
      throw new Error(`Supabase photo delete failed: ${error.message}`);
    }
  }
}

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
  const isSyncing = isSyncingMeta?.value || false;

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

/**
 * Auto-sync on interval (call this on app startup)
 */
let syncInterval: NodeJS.Timeout | null = null;

export function startAutoSync(intervalMs: number = 60000): void {
  if (syncInterval) {
    console.warn('⚠️  Auto-sync already running');
    return;
  }

  console.log(`🔄 Starting auto-sync every ${intervalMs / 1000}s`);

  // Sync immediately
  processSyncQueue().catch(err => {
    console.error('❌ Initial sync failed:', err);
  });

  // Then sync on interval
  syncInterval = setInterval(async () => {
    try {
      await processSyncQueue();
    } catch (err) {
      console.error('❌ Auto-sync failed:', err);
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

/**
 * Manual sync trigger (for UI button)
 */
export async function manualSync(): Promise<SyncResult> {
  console.log('🔄 Manual sync triggered');
  return await processSyncQueue();
}
