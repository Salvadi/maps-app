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

  console.log(`🔄 Processing ${pendingItems.length} sync queue items as user ${session.user.id}...`);

  let processedCount = 0;
  let failedCount = 0;
  const errors: Array<{ item: SyncQueueItem; error: string }> = [];

  // Process items sequentially to maintain order
  for (const item of pendingItems) {
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

      console.error(`❌ Failed to sync ${item.entityType} ${item.operation}:`, errorMessage);

      // Continue processing other items even if one fails
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

  return result;
}

async function processSyncItem(item: SyncQueueItem): Promise<void> {
  switch (item.entityType) {
    case 'project':
      await syncProject(item);
      break;

    case 'mapping_entry':
      await syncMappingEntry(item);
      break;

    case 'photo':
      await syncPhoto(item);
      break;

    case 'floor_plan':
      await syncFloorPlan(item);
      break;

    case 'floor_plan_point':
      await syncFloorPlanPoint(item);
      break;

    case 'standalone_map':
      await syncStandaloneMap(item);
      break;

    default:
      throw new Error(`Unknown entity type: ${item.entityType}`);
  }
}


/**
 * Process a single sync queue item
 */
async function syncProject(item: SyncQueueItem): Promise<void> {
  let project = item.payload as Project;

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  // =========================
  // CREATE
  // =========================
  if (item.operation === 'CREATE') {
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
      archived: project.archived,
      // NOTE: syncEnabled is NOT synced - it's a per-device preference
      created_at: new Date(project.createdAt).toISOString(),
      updated_at: new Date(project.updatedAt).toISOString(),
      version: project.version || 1, // Add version for conflict detection
      last_modified: project.lastModified || project.updatedAt, // Add lastModified
      synced: 1
    };

    const { error } = await supabase
      .from('projects')
      .insert(supabaseProject);

    if (error) throw new Error(error.message);
  }

  // =========================
  // UPDATE
  // =========================
  if (item.operation === 'UPDATE') {
    // Check for conflicts before updating
    const { hasConflict, remote } = await checkForConflicts('project', project.id);

    if (hasConflict && remote) {
      console.log(`⚠️  Conflict detected for project ${project.id}`);

      // Resolve conflict using last-modified-wins strategy
      project = await resolveProjectConflict(project, remote, 'last-modified-wins');

      // Update local database with resolved version
      await db.projects.put(project);
      console.log(`✅ Conflict resolved for project ${project.id}`);
    }

    const supabaseProject = {
      title: project.title,
      client: project.client,
      address: project.address,
      notes: project.notes,
      floors: project.floors,
      plans: project.plans,
      use_room_numbering: project.useRoomNumbering,
      use_intervention_numbering: project.useInterventionNumbering,
      typologies: project.typologies,
      accessible_users: project.accessibleUsers,
      archived: project.archived,
      // NOTE: syncEnabled is NOT synced - it's a per-device preference
      updated_at: new Date(project.updatedAt).toISOString(),
      version: project.version || 1, // Add version for conflict detection
      last_modified: project.lastModified || project.updatedAt, // Add lastModified
      synced: 1
    };

    const { error } = await supabase
      .from('projects')
      .update(supabaseProject)
      .eq('id', project.id);

    if (error) throw new Error(error.message);
  }

  // =========================
  // DELETE
  // =========================
  if (item.operation === 'DELETE') {
    const { error } = await supabase
      .from('projects')
      .delete()
      .eq('id', project.id);

    if (error) throw new Error(error.message);
  }

  // Mark local as synced
  await db.projects.update(project.id, { synced: 1 });
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
      room: entry.room || null,
      intervention: entry.intervention || null,
      crossings: entry.crossings,
      timestamp: entry.timestamp,
      last_modified: entry.lastModified,
      version: entry.version,
      created_by: entry.createdBy,
      modified_by: entry.modifiedBy,
      photos: entry.photos,
      synced: 1,
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
    await db.mappingEntries.update(entry.id, { synced: 1 });

    // Sync photos associated with this mapping entry
    const photos = await db.photos
      .where('mappingEntryId')
      .equals(entry.id)
      .toArray();

    for (const photo of photos) {
      if (!photo.uploaded) {
        // Add photo to sync queue if not already uploaded
        const photoSyncItem: SyncQueueItem = {
          id: `${entry.id}-photo-${photo.id}`,
          operation: 'CREATE',
          entityType: 'photo',
          entityId: photo.id,
          payload: photo,
          timestamp: Date.now(),
          retryCount: 0,
          synced: 0
        };

        // Check if this photo sync item already exists
        const existingPhotoSync = await db.syncQueue.get(photoSyncItem.id);
        if (!existingPhotoSync) {
          await db.syncQueue.add(photoSyncItem);
          console.log(`📸 Added photo ${photo.id} to sync queue`);
        }
      }
    }
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
    // Use photoMeta from sync queue payload instead of querying database
    // (photo was already deleted locally in removePhotoFromMapping)
    const fileName = `${photoMeta.mappingEntryId}/${photoMeta.id}.jpg`;

    // Delete from storage
    const { error: storageError } = await supabase.storage
      .from('photos')
      .remove([fileName]);

    if (storageError) {
      console.warn(`Failed to delete photo from storage: ${storageError.message}`);
      // Continue with metadata deletion even if storage deletion fails
    } else {
      console.log(`🗑️ Deleted photo from storage: ${fileName}`);
    }

    // Delete metadata from database
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
 * Sync floor plan to Supabase
 */
async function syncFloorPlan(item: SyncQueueItem): Promise<void> {
  const floorPlan = item.payload as any; // FloorPlan type from database.ts

  if (item.operation === 'CREATE' || item.operation === 'UPDATE') {
    // Get the actual floor plan from IndexedDB (with blobs)
    const localFloorPlan = await db.floorPlans.get(floorPlan.id);

    if (!localFloorPlan) {
      throw new Error(`Floor plan not found: ${floorPlan.id}`);
    }

    // Upload blobs to Supabase Storage if not already uploaded
    let imageUrl = localFloorPlan.imageUrl;
    let thumbnailUrl = localFloorPlan.thumbnailUrl;

    if (!imageUrl && localFloorPlan.imageBlob) {
      const { uploadFloorPlan } = await import('../utils/floorPlanUtils');
      const urls = await uploadFloorPlan(
        localFloorPlan.projectId,
        localFloorPlan.floor,
        localFloorPlan.imageBlob,
        localFloorPlan.thumbnailBlob || localFloorPlan.imageBlob,
        localFloorPlan.createdBy
      );
      imageUrl = urls.fullResUrl;
      thumbnailUrl = urls.thumbnailUrl;

      // Update local record with URLs
      await db.floorPlans.update(floorPlan.id, { imageUrl, thumbnailUrl, synced: 1 });
    }

    // Create/update floor plan record in Supabase
    const { error } = await supabase
      .from('floor_plans')
      .upsert({
        id: localFloorPlan.id,
        project_id: localFloorPlan.projectId,
        floor: localFloorPlan.floor,
        image_url: imageUrl,
        thumbnail_url: thumbnailUrl,
        original_filename: localFloorPlan.originalFilename,
        original_format: localFloorPlan.originalFormat,
        width: localFloorPlan.width,
        height: localFloorPlan.height,
        metadata: localFloorPlan.metadata || {},
        created_by: localFloorPlan.createdBy,
        created_at: new Date(localFloorPlan.createdAt).toISOString(),
        updated_at: new Date(localFloorPlan.updatedAt).toISOString()
      }, {
        onConflict: 'id'
      });

    if (error) {
      throw new Error(`Supabase floor plan upsert failed: ${error.message}`);
    }
  } else if (item.operation === 'DELETE') {
    // Delete from Supabase
    const { error } = await supabase
      .from('floor_plans')
      .delete()
      .eq('id', floorPlan.id);

    if (error) {
      throw new Error(`Supabase floor plan delete failed: ${error.message}`);
    }

    // Delete from Storage if URLs exist
    if (floorPlan.imageUrl || floorPlan.thumbnailUrl) {
      const { deleteFloorPlan } = await import('../utils/floorPlanUtils');
      try {
        await deleteFloorPlan(floorPlan.imageUrl, floorPlan.thumbnailUrl);
      } catch (err) {
        console.warn('Failed to delete floor plan from storage:', err);
      }
    }
  }
}

/**
 * Sync floor plan point to Supabase
 */
async function syncFloorPlanPoint(item: SyncQueueItem): Promise<void> {
  const point = item.payload as any; // FloorPlanPoint type

  if (item.operation === 'CREATE' || item.operation === 'UPDATE') {
    const { error } = await supabase
      .from('floor_plan_points')
      .upsert({
        id: point.id,
        floor_plan_id: point.floorPlanId,
        mapping_entry_id: point.mappingEntryId,
        point_type: point.pointType,
        point_x: point.pointX,
        point_y: point.pointY,
        label_x: point.labelX,
        label_y: point.labelY,
        perimeter_points: point.perimeterPoints,
        custom_text: point.customText,
        metadata: point.metadata || {},
        created_by: point.createdBy,
        created_at: new Date(point.createdAt).toISOString(),
        updated_at: new Date(point.updatedAt).toISOString()
      }, {
        onConflict: 'id'
      });

    if (error) {
      throw new Error(`Supabase floor plan point upsert failed: ${error.message}`);
    }
  } else if (item.operation === 'DELETE') {
    const { error } = await supabase
      .from('floor_plan_points')
      .delete()
      .eq('id', point.id);

    if (error) {
      throw new Error(`Supabase floor plan point delete failed: ${error.message}`);
    }
  }
}

/**
 * Sync standalone map to Supabase
 */
async function syncStandaloneMap(item: SyncQueueItem): Promise<void> {
  const map = item.payload as any; // StandaloneMap type

  if (item.operation === 'CREATE' || item.operation === 'UPDATE') {
    const localMap = await db.standaloneMaps.get(map.id);

    if (!localMap) {
      throw new Error(`Standalone map not found: ${map.id}`);
    }

    // Upload blobs to Supabase Storage if not already uploaded
    let imageUrl = localMap.imageUrl;
    let thumbnailUrl = localMap.thumbnailUrl;

    if (!imageUrl && localMap.imageBlob) {
      const { uploadStandaloneMap } = await import('../utils/floorPlanUtils');
      const urls = await uploadStandaloneMap(
        localMap.id,
        localMap.imageBlob,
        localMap.thumbnailBlob || localMap.imageBlob,
        localMap.userId
      );
      imageUrl = urls.fullResUrl;
      thumbnailUrl = urls.thumbnailUrl;

      // Update local record with URLs
      await db.standaloneMaps.update(map.id, { imageUrl, thumbnailUrl, synced: 1 });
    }

    // Create/update standalone map record in Supabase
    const { error } = await supabase
      .from('standalone_maps')
      .upsert({
        id: localMap.id,
        user_id: localMap.userId,
        name: localMap.name,
        description: localMap.description,
        image_url: imageUrl,
        thumbnail_url: thumbnailUrl,
        original_filename: localMap.originalFilename,
        width: localMap.width,
        height: localMap.height,
        points: localMap.points,
        grid_enabled: localMap.gridEnabled,
        grid_config: localMap.gridConfig,
        created_at: new Date(localMap.createdAt).toISOString(),
        updated_at: new Date(localMap.updatedAt).toISOString()
      }, {
        onConflict: 'id'
      });

    if (error) {
      throw new Error(`Supabase standalone map upsert failed: ${error.message}`);
    }
  } else if (item.operation === 'DELETE') {
    const { error } = await supabase
      .from('standalone_maps')
      .delete()
      .eq('id', map.id);

    if (error) {
      throw new Error(`Supabase standalone map delete failed: ${error.message}`);
    }

    // Delete from Storage if URLs exist
    if (map.imageUrl || map.thumbnailUrl) {
      const { deleteFloorPlan } = await import('../utils/floorPlanUtils');
      try {
        await deleteFloorPlan(map.imageUrl, map.thumbnailUrl);
      } catch (err) {
        console.warn('Failed to delete standalone map from storage:', err);
      }
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
 * Download projects from Supabase and save to IndexedDB
 * This pulls data from the server to the local database
 */
export async function downloadProjectsFromSupabase(userId: string, isAdmin: boolean = false): Promise<number> {
  if (!isSupabaseConfigured()) {
    console.warn('⚠️  Download skipped: Supabase not configured');
    return 0;
  }

  if (!navigator.onLine) {
    console.warn('⚠️  Download skipped: No internet connection');
    return 0;
  }

  console.log(`⬇️  Downloading projects from Supabase for user ${userId}${isAdmin ? ' (admin)' : ''}...`);

  try {

    // Download ALL projects and filter client-side
    // This is less efficient but more reliable than PostgREST array queries
    const { data: allProjects, error } = await supabase
      .from('projects')
      .select('*');

    if (error) {
      throw new Error(`Failed to download projects: ${error.message}`);
    }

    if (!allProjects || allProjects.length === 0) {
      console.log('✅ No projects to download');
      return 0;
    }

    // Filter projects: admins see all, regular users see only accessible
    let userProjects;
    if (isAdmin) {
      console.log('👑 Admin user: downloading all projects');
      userProjects = allProjects;
    } else {
      userProjects = allProjects.filter((p: any) =>
        p.owner_id === userId ||
        (p.accessible_users && Array.isArray(p.accessible_users) && p.accessible_users.includes(userId))
      );
    }

    if (userProjects.length === 0) {
      console.log('✅ No projects accessible to this user');
      return 0;
    }

    console.log(`📥 Found ${userProjects.length} projects for user`);

    let downloadedCount = 0;

    for (const supabaseProject of userProjects) {
      // Convert Supabase format to IndexedDB format
      const project: Project = {
        id: supabaseProject.id,
        title: supabaseProject.title,
        client: supabaseProject.client,
        address: supabaseProject.address,
        notes: supabaseProject.notes,
        floors: supabaseProject.floors,
        plans: supabaseProject.plans,
        useRoomNumbering: supabaseProject.use_room_numbering,
        useInterventionNumbering: supabaseProject.use_intervention_numbering,
        typologies: supabaseProject.typologies,
        ownerId: supabaseProject.owner_id,
        accessibleUsers: supabaseProject.accessible_users || [],
        archived: supabaseProject.archived || 0,
        syncEnabled: 0, // Always default to 0 for newly downloaded projects (per-device preference)
        createdAt: new Date(supabaseProject.created_at).getTime(),
        updatedAt: new Date(supabaseProject.updated_at).getTime(),
        version: supabaseProject.version || 1, // Add version for conflict detection
        lastModified: supabaseProject.last_modified || new Date(supabaseProject.updated_at).getTime(), // Add lastModified
        synced: 1
      };

      // Check if project exists locally
      const existingProject = await db.projects.get(project.id);

      if (existingProject) {
        // IMPORTANT: Preserve local syncEnabled preference when updating from remote
        project.syncEnabled = existingProject.syncEnabled;

        // Check for conflicts and resolve using conflict resolution strategy
        const hasConflict =
          existingProject.updatedAt !== project.updatedAt ||
          (existingProject.version || 1) !== (project.version || 1);

        if (hasConflict) {
          console.log(`⚠️  Conflict detected for project ${project.id} during download`);
          // Use conflict resolution to merge properly
          const resolved = await resolveProjectConflict(existingProject, supabaseProject, 'last-modified-wins');
          // Preserve syncEnabled preference after conflict resolution
          resolved.syncEnabled = existingProject.syncEnabled;
          await db.projects.put(resolved);
          console.log(`✅ Updated project from server with conflict resolution: ${project.title}`);
          downloadedCount++;
        } else if (project.updatedAt > existingProject.updatedAt) {
          // No conflict, just newer remote version
          await db.projects.put(project);
          console.log(`✅ Updated project from server: ${project.title}`);
          downloadedCount++;
        }
      } else {
        // New project, just add it with syncEnabled = 0
        await db.projects.put(project);
        console.log(`✅ Downloaded new project: ${project.title}`);
        downloadedCount++;
      }
    }

    console.log(`✅ Downloaded ${downloadedCount} projects from Supabase`);
    return downloadedCount;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error('❌ Failed to download projects:', errorMessage);
    throw err;
  }
}

/**
 * Download mapping entries from Supabase and save to IndexedDB
 */
export async function downloadMappingEntriesFromSupabase(userId: string, isAdmin: boolean = false): Promise<number> {
  if (!isSupabaseConfigured()) {
    console.warn('⚠️  Download skipped: Supabase not configured');
    return 0;
  }

  if (!navigator.onLine) {
    console.warn('⚠️  Download skipped: No internet connection');
    return 0;
  }

  console.log(`⬇️  Downloading mapping entries from Supabase for user ${userId}${isAdmin ? ' (admin)' : ''}...`);

  try {

    // Get all project IDs that have syncEnabled = 1 (full sync)
    let userProjects;
    if (isAdmin) {
      console.log('👑 Admin user: downloading mapping entries for all sync-enabled projects');
      userProjects = await db.projects.where('syncEnabled').equals(1).toArray();
    } else {
      // Get user's projects that have sync enabled
      const allUserProjects = await db.projects
        .where('ownerId')
        .equals(userId)
        .or('accessibleUsers')
        .equals(userId)
        .toArray();

      userProjects = allUserProjects.filter(p => p.syncEnabled === 1);
    }

    if (userProjects.length === 0) {
      console.log('✅ No sync-enabled projects found, skipping mapping entries download');
      return 0;
    }

    const projectIds = userProjects.map(p => p.id);
    console.log(`📥 Downloading mapping entries for ${projectIds.length} sync-enabled projects`);

    // Download mapping entries for these projects
    const { data: mappingEntries, error } = await supabase
      .from('mapping_entries')
      .select('*')
      .in('project_id', projectIds);

    if (error) {
      throw new Error(`Failed to download mapping entries: ${error.message}`);
    }

    if (!mappingEntries || mappingEntries.length === 0) {
      console.log('✅ No mapping entries to download');
      return 0;
    }

    let downloadedCount = 0;

    for (const supabaseEntry of mappingEntries) {
      // Convert Supabase format to IndexedDB format
      const mappingEntry: MappingEntry = {
        id: supabaseEntry.id,
        projectId: supabaseEntry.project_id,
        floor: supabaseEntry.floor,
        room: supabaseEntry.room || undefined,
        intervention: supabaseEntry.intervention || undefined,
        photos: supabaseEntry.photos || [],
        crossings: supabaseEntry.crossings || [],
        timestamp: new Date(supabaseEntry.created_at).getTime(),
        createdBy: supabaseEntry.created_by,
        lastModified: new Date(supabaseEntry.updated_at).getTime(),
        modifiedBy: supabaseEntry.modified_by,
        version: supabaseEntry.version || 1,
        synced: 1
      };

      // Check if mapping entry exists locally
      const existingEntry = await db.mappingEntries.get(mappingEntry.id);

      if (existingEntry) {
        // Check for conflicts and resolve using conflict resolution strategy
        const hasConflict =
          existingEntry.lastModified !== mappingEntry.lastModified ||
          existingEntry.version !== mappingEntry.version;

        if (hasConflict) {
          console.log(`⚠️  Conflict detected for mapping entry ${mappingEntry.id} during download`);
          // Use conflict resolution to merge properly
          const resolved = await resolveMappingEntryConflict(existingEntry, supabaseEntry, 'last-modified-wins');
          await db.mappingEntries.put(resolved);
          console.log(`✅ Updated mapping entry from server with conflict resolution: ${mappingEntry.id}`);
          downloadedCount++;
        } else if (mappingEntry.lastModified > existingEntry.lastModified) {
          // No conflict, just newer remote version
          await db.mappingEntries.put(mappingEntry);
          console.log(`✅ Updated mapping entry from server: ${mappingEntry.id}`);
          downloadedCount++;
        }
      } else {
        // New entry, just add it
        await db.mappingEntries.put(mappingEntry);
        console.log(`✅ Downloaded new mapping entry: ${mappingEntry.id}`);
        downloadedCount++;
      }
    }

    console.log(`✅ Downloaded ${downloadedCount} mapping entries from Supabase`);
    return downloadedCount;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error('❌ Failed to download mapping entries:', errorMessage);
    throw err;
  }
}

/**
 * Download photos from Supabase Storage and save to IndexedDB
 */
export async function downloadPhotosFromSupabase(userId: string, isAdmin: boolean = false): Promise<number> {
  if (!isSupabaseConfigured()) {
    console.warn('⚠️  Download skipped: Supabase not configured');
    return 0;
  }

  if (!navigator.onLine) {
    console.warn('⚠️  Download skipped: No internet connection');
    return 0;
  }

  console.log(`⬇️  Downloading photos from Supabase for user ${userId}${isAdmin ? ' (admin)' : ''}...`);

  try {

    // Get all projects with syncEnabled = 1 (full sync including photos)
    let userProjects;
    if (isAdmin) {
      console.log('👑 Admin user: downloading photos for all sync-enabled projects');
      userProjects = await db.projects.where('syncEnabled').equals(1).toArray();
    } else {
      // Get user's projects that have sync enabled
      const allUserProjects = await db.projects
        .where('ownerId')
        .equals(userId)
        .or('accessibleUsers')
        .equals(userId)
        .toArray();

      userProjects = allUserProjects.filter(p => p.syncEnabled === 1);
    }

    if (userProjects.length === 0) {
      console.log('✅ No sync-enabled projects found, skipping photos download');
      return 0;
    }

    const projectIds = userProjects.map(p => p.id);
    console.log(`📥 Downloading photos for ${projectIds.length} sync-enabled projects`);

    // Get all mapping entries for these projects
    const mappingEntries = await db.mappingEntries
      .where('projectId')
      .anyOf(projectIds)
      .toArray();

    if (mappingEntries.length === 0) {
      console.log('✅ No mapping entries found, skipping photos download');
      return 0;
    }

    const mappingEntryIds = mappingEntries.map(e => e.id);

    // Download photo metadata from Supabase
    const { data: photoMetadata, error } = await supabase
      .from('photos')
      .select('*')
      .in('mapping_entry_id', mappingEntryIds);

    if (error) {
      throw new Error(`Failed to download photo metadata: ${error.message}`);
    }

    if (!photoMetadata || photoMetadata.length === 0) {
      console.log('✅ No photos to download');
      return 0;
    }

    console.log(`📥 Found ${photoMetadata.length} photos to download`);

    let downloadedCount = 0;

    for (const photoMeta of photoMetadata) {
      try {
        // Check if photo already exists locally
        const existingPhoto = await db.photos.get(photoMeta.id);
        if (existingPhoto && existingPhoto.uploaded) {
          console.log(`⏭️  Photo ${photoMeta.id} already exists locally, skipping`);
          continue;
        }

        // Download the photo blob from Supabase Storage
        const { data: blob, error: downloadError } = await supabase.storage
          .from('photos')
          .download(photoMeta.storage_path);

        if (downloadError) {
          console.error(`❌ Failed to download photo ${photoMeta.id}:`, downloadError.message);
          continue;
        }

        if (!blob) {
          console.error(`❌ No blob returned for photo ${photoMeta.id}`);
          continue;
        }

        // Save photo to IndexedDB
        const photo: Photo = {
          id: photoMeta.id,
          blob: blob,
          mappingEntryId: photoMeta.mapping_entry_id,
          metadata: photoMeta.metadata,
          uploaded: true,
          remoteUrl: photoMeta.url
        };

        await db.photos.put(photo);
        console.log(`✅ Downloaded photo: ${photoMeta.id}`);
        downloadedCount++;
      } catch (photoErr) {
        const photoErrorMessage = photoErr instanceof Error ? photoErr.message : String(photoErr);
        console.error(`❌ Error downloading photo ${photoMeta.id}:`, photoErrorMessage);
        // Continue with next photo even if one fails
      }
    }

    console.log(`✅ Downloaded ${downloadedCount} photos from Supabase`);
    return downloadedCount;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error('❌ Failed to download photos:', errorMessage);
    throw err;
  }
}

/**
 * Download floor plans from Supabase and save to IndexedDB
 */
export async function downloadFloorPlansFromSupabase(userId: string, isAdmin: boolean = false): Promise<number> {
  if (!isSupabaseConfigured()) {
    console.warn('⚠️  Download skipped: Supabase not configured');
    return 0;
  }

  if (!navigator.onLine) {
    console.warn('⚠️  Download skipped: No internet connection');
    return 0;
  }

  console.log(`⬇️  Downloading floor plans from Supabase for user ${userId}${isAdmin ? ' (admin)' : ''}...`);

  try {
    // Get all projects with syncEnabled = 1 (full sync)
    let userProjects;
    if (isAdmin) {
      console.log('👑 Admin user: downloading floor plans for all sync-enabled projects');
      userProjects = await db.projects.where('syncEnabled').equals(1).toArray();
    } else {
      // Get user's projects that have sync enabled
      const allUserProjects = await db.projects
        .where('ownerId')
        .equals(userId)
        .or('accessibleUsers')
        .equals(userId)
        .toArray();

      userProjects = allUserProjects.filter(p => p.syncEnabled === 1);
    }

    if (userProjects.length === 0) {
      console.log('✅ No sync-enabled projects found, skipping floor plans download');
      return 0;
    }

    const projectIds = userProjects.map(p => p.id);
    console.log(`📥 Downloading floor plans for ${projectIds.length} sync-enabled projects`);

    // Download floor plans for these projects
    const { data: floorPlans, error } = await supabase
      .from('floor_plans')
      .select('*')
      .in('project_id', projectIds);

    if (error) {
      throw new Error(`Failed to download floor plans: ${error.message}`);
    }

    if (!floorPlans || floorPlans.length === 0) {
      console.log('✅ No floor plans to download');
      return 0;
    }

    console.log(`📥 Found ${floorPlans.length} floor plans to download`);

    let downloadedCount = 0;

    for (const supabaseFloorPlan of floorPlans) {
      try {
        // Check if floor plan already exists locally
        const existingFloorPlan = await db.floorPlans.get(supabaseFloorPlan.id);

        if (existingFloorPlan) {
          // Check if remote version is newer
          const remoteUpdated = new Date(supabaseFloorPlan.updated_at).getTime();
          const localUpdated = existingFloorPlan.updatedAt;

          // Skip only if up to date AND imageBlob exists
          if (remoteUpdated <= localUpdated && existingFloorPlan.imageBlob) {
            console.log(`⏭️  Floor plan ${supabaseFloorPlan.id} is up to date, skipping`);
            continue;
          }

          // If imageBlob is missing, download it even if metadata is up to date
          if (remoteUpdated <= localUpdated && !existingFloorPlan.imageBlob) {
            console.log(`📥 Floor plan ${supabaseFloorPlan.id} metadata is up to date but imageBlob is missing, downloading image...`);
          }
        }

        // Download image blobs from Supabase Storage if URLs exist
        let imageBlob = null;
        let thumbnailBlob = null;

        if (supabaseFloorPlan.image_url) {
          try {
            console.log(`📥 Attempting to download floor plan image for ${supabaseFloorPlan.id}`);
            console.log(`   Image URL: ${supabaseFloorPlan.image_url}`);

            // Extract storage path from URL
            const imageUrl = new URL(supabaseFloorPlan.image_url);
            console.log(`   Parsed URL pathname: ${imageUrl.pathname}`);

            const imagePath = imageUrl.pathname.split('/storage/v1/object/public/floor-plans/')[1];
            console.log(`   Extracted image path: ${imagePath}`);

            if (imagePath) {
              const { data: blob, error: downloadError } = await supabase.storage
                .from('floor-plans')
                .download(imagePath);

              if (!downloadError && blob) {
                imageBlob = blob;
                console.log(`✅ Successfully downloaded floor plan image for ${supabaseFloorPlan.id} (size: ${blob.size} bytes)`);
              } else {
                console.error(`❌ Failed to download floor plan image for ${supabaseFloorPlan.id}:`);
                console.error(`   Error: ${downloadError?.message || 'Unknown error'}`);
                console.error(`   Blob: ${blob}`);
              }
            } else {
              console.error(`❌ Failed to extract image path from URL for ${supabaseFloorPlan.id}`);
            }
          } catch (urlErr) {
            console.error(`❌ Failed to parse floor plan image URL for ${supabaseFloorPlan.id}:`, urlErr);
            console.error(`   URL was: ${supabaseFloorPlan.image_url}`);
          }
        } else {
          console.warn(`⚠️  No image_url for floor plan ${supabaseFloorPlan.id}`);
        }

        if (supabaseFloorPlan.thumbnail_url) {
          try {
            // Extract storage path from URL
            const thumbnailUrl = new URL(supabaseFloorPlan.thumbnail_url);
            const thumbnailPath = thumbnailUrl.pathname.split('/storage/v1/object/public/floor-plans/')[1];

            if (thumbnailPath) {
              const { data: blob, error: downloadError } = await supabase.storage
                .from('floor-plans')
                .download(thumbnailPath);

              if (!downloadError && blob) {
                thumbnailBlob = blob;
              } else {
                console.warn(`⚠️  Failed to download floor plan thumbnail for ${supabaseFloorPlan.id}: ${downloadError?.message}`);
              }
            }
          } catch (urlErr) {
            console.warn(`⚠️  Failed to parse floor plan thumbnail URL: ${urlErr}`);
          }
        }

        // Convert Supabase format to IndexedDB format
        const floorPlan = {
          id: supabaseFloorPlan.id,
          projectId: supabaseFloorPlan.project_id,
          floor: supabaseFloorPlan.floor,
          imageUrl: supabaseFloorPlan.image_url,
          thumbnailUrl: supabaseFloorPlan.thumbnail_url,
          imageBlob: imageBlob,
          thumbnailBlob: thumbnailBlob,
          originalFilename: supabaseFloorPlan.original_filename,
          originalFormat: supabaseFloorPlan.original_format,
          width: supabaseFloorPlan.width,
          height: supabaseFloorPlan.height,
          metadata: supabaseFloorPlan.metadata || {},
          createdBy: supabaseFloorPlan.created_by,
          createdAt: new Date(supabaseFloorPlan.created_at).getTime(),
          updatedAt: new Date(supabaseFloorPlan.updated_at).getTime(),
          synced: 1 as 0 | 1
        };

        // Warn if imageBlob is missing
        if (!imageBlob && supabaseFloorPlan.image_url) {
          console.warn(`⚠️  WARNING: Saving floor plan ${supabaseFloorPlan.id} with NULL imageBlob even though image_url exists!`);
          console.warn(`   This floor plan will not be viewable until the image is downloaded successfully.`);
        }

        await db.floorPlans.put(floorPlan);
        console.log(`✅ Downloaded floor plan: ${supabaseFloorPlan.id} for project ${supabaseFloorPlan.project_id}, floor ${supabaseFloorPlan.floor} (imageBlob: ${imageBlob ? 'YES' : 'NO'})`);
        downloadedCount++;
      } catch (floorPlanErr) {
        const errorMessage = floorPlanErr instanceof Error ? floorPlanErr.message : String(floorPlanErr);
        console.error(`❌ Error downloading floor plan ${supabaseFloorPlan.id}:`, errorMessage);
        // Continue with next floor plan even if one fails
      }
    }

    console.log(`✅ Downloaded ${downloadedCount} floor plans from Supabase`);
    return downloadedCount;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error('❌ Failed to download floor plans:', errorMessage);
    throw err;
  }
}

/**
 * Download floor plan points from Supabase and save to IndexedDB
 */
export async function downloadFloorPlanPointsFromSupabase(userId: string, isAdmin: boolean = false): Promise<number> {
  if (!isSupabaseConfigured()) {
    console.warn('⚠️  Download skipped: Supabase not configured');
    return 0;
  }

  if (!navigator.onLine) {
    console.warn('⚠️  Download skipped: No internet connection');
    return 0;
  }

  console.log(`⬇️  Downloading floor plan points from Supabase for user ${userId}${isAdmin ? ' (admin)' : ''}...`);

  try {
    // Get all floor plans that we have locally
    const localFloorPlans = await db.floorPlans.toArray();

    if (localFloorPlans.length === 0) {
      console.log('✅ No floor plans found locally, skipping floor plan points download');
      return 0;
    }

    const floorPlanIds = localFloorPlans.map(fp => fp.id);
    console.log(`📥 Downloading floor plan points for ${floorPlanIds.length} floor plans`);

    // Download floor plan points for these floor plans
    const { data: floorPlanPoints, error } = await supabase
      .from('floor_plan_points')
      .select('*')
      .in('floor_plan_id', floorPlanIds);

    if (error) {
      throw new Error(`Failed to download floor plan points: ${error.message}`);
    }

    if (!floorPlanPoints || floorPlanPoints.length === 0) {
      console.log('✅ No floor plan points to download');
      return 0;
    }

    console.log(`📥 Found ${floorPlanPoints.length} floor plan points to download`);

    let downloadedCount = 0;

    for (const supabasePoint of floorPlanPoints) {
      try {
        // Check if point already exists locally
        const existingPoint = await db.floorPlanPoints.get(supabasePoint.id);

        if (existingPoint) {
          // Check if remote version is newer
          const remoteUpdated = new Date(supabasePoint.updated_at).getTime();
          const localUpdated = existingPoint.updatedAt;

          if (remoteUpdated <= localUpdated) {
            console.log(`⏭️  Floor plan point ${supabasePoint.id} is up to date, skipping`);
            continue;
          }
        }

        // Convert Supabase format to IndexedDB format
        const point = {
          id: supabasePoint.id,
          floorPlanId: supabasePoint.floor_plan_id,
          mappingEntryId: supabasePoint.mapping_entry_id,
          pointType: supabasePoint.point_type,
          pointX: supabasePoint.point_x,
          pointY: supabasePoint.point_y,
          labelX: supabasePoint.label_x,
          labelY: supabasePoint.label_y,
          perimeterPoints: supabasePoint.perimeter_points,
          customText: supabasePoint.custom_text,
          metadata: supabasePoint.metadata || {},
          createdBy: supabasePoint.created_by,
          createdAt: new Date(supabasePoint.created_at).getTime(),
          updatedAt: new Date(supabasePoint.updated_at).getTime(),
          synced: 1 as 0 | 1
        };

        await db.floorPlanPoints.put(point);
        console.log(`✅ Downloaded floor plan point: ${supabasePoint.id} (${supabasePoint.point_type})`);
        downloadedCount++;
      } catch (pointErr) {
        const errorMessage = pointErr instanceof Error ? pointErr.message : String(pointErr);
        console.error(`❌ Error downloading floor plan point ${supabasePoint.id}:`, errorMessage);
        // Continue with next point even if one fails
      }
    }

    console.log(`✅ Downloaded ${downloadedCount} floor plan points from Supabase`);
    return downloadedCount;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error('❌ Failed to download floor plan points:', errorMessage);
    throw err;
  }
}

/**
 * Sync data FROM Supabase TO local IndexedDB
 * This is the "pull" operation that complements the "push" in processSyncQueue
 */
export async function syncFromSupabase(): Promise<{ projectsCount: number; entriesCount: number; photosCount: number; floorPlansCount: number; floorPlanPointsCount: number }> {
  if (!isSupabaseConfigured()) {
    console.warn('⚠️  Sync from Supabase skipped: Supabase not configured');
    return { projectsCount: 0, entriesCount: 0, photosCount: 0, floorPlansCount: 0, floorPlanPointsCount: 0 };
  }

  // Check if user is authenticated
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    console.warn('⚠️  Sync from Supabase skipped: User not authenticated');
    return { projectsCount: 0, entriesCount: 0, photosCount: 0, floorPlansCount: 0, floorPlanPointsCount: 0 };
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
    const photosCount = await downloadPhotosFromSupabase(session.user.id, isAdmin);
    const floorPlansCount = await downloadFloorPlansFromSupabase(session.user.id, isAdmin);
    const floorPlanPointsCount = await downloadFloorPlanPointsFromSupabase(session.user.id, isAdmin);

    console.log(`✅ Sync from Supabase complete: ${projectsCount} projects, ${entriesCount} entries, ${photosCount} photos, ${floorPlansCount} floor plans, ${floorPlanPointsCount} floor plan points`);

    return { projectsCount, entriesCount, photosCount, floorPlansCount, floorPlanPointsCount };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error('❌ Sync from Supabase failed:', errorMessage);
    throw err;
  }
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

  // Then sync on interval (bidirectional with lock)
  syncInterval = setInterval(async () => {
    try {
      // Check if sync is already in progress
      const isSyncingMeta = await db.metadata.get('isSyncing');
      if (isSyncingMeta?.value === true) {
        console.log('⏭️  Auto-sync skipped: sync already in progress');
        return;
      }

      // Use atomic lock for auto-sync
      await db.metadata.put({ key: 'isSyncing', value: true });
      try {
        // Upload local changes
        await processSyncQueue();
        // Download remote changes
        await syncFromSupabase();
      } finally {
        await db.metadata.put({ key: 'isSyncing', value: false });
      }
    } catch (err) {
      console.error('❌ Auto-sync failed:', err);
      // Ensure lock is released on error
      await db.metadata.put({ key: 'isSyncing', value: false });
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
 * Performs bidirectional sync with atomic lock: upload local changes and download remote changes
 */
export async function manualSync(): Promise<{
  uploadResult: SyncResult;
  downloadResult: { projectsCount: number; entriesCount: number; photosCount: number; floorPlansCount: number; floorPlanPointsCount: number }
}> {
  console.log('🔄 Manual bidirectional sync triggered');

  // Check if sync is already in progress
  const isSyncingMeta = await db.metadata.get('isSyncing');
  if (isSyncingMeta?.value === true) {
    console.warn('⚠️  Sync already in progress, skipping');
    return {
      uploadResult: { success: false, processedCount: 0, failedCount: 0, errors: [] },
      downloadResult: { projectsCount: 0, entriesCount: 0, photosCount: 0, floorPlansCount: 0, floorPlanPointsCount: 0 }
    };
  }

  // Safety timeout: force release lock after 5 minutes to prevent indefinite blocking
  const timeoutId = setTimeout(async () => {
    console.error('🚨 Sync timeout after 5 minutes - force releasing lock');
    await db.metadata.put({ key: 'isSyncing', value: false });
  }, 5 * 60 * 1000); // 5 minutes

  try {
    // Set sync lock
    await db.metadata.put({ key: 'isSyncing', value: true });

    // Upload local changes FIRST (to avoid conflicts with concurrent edits)
    const uploadResult = await processSyncQueue();

    // Download remote changes AFTER upload completes
    const downloadResult = await syncFromSupabase();

    console.log(`✅ Manual sync complete: uploaded ${uploadResult.processedCount} items, downloaded ${downloadResult.projectsCount} projects, ${downloadResult.entriesCount} entries, ${downloadResult.photosCount} photos, ${downloadResult.floorPlansCount} floor plans, and ${downloadResult.floorPlanPointsCount} floor plan points`);

    clearTimeout(timeoutId); // Cancel timeout on success
    return { uploadResult, downloadResult };
  } catch (error) {
    console.error('❌ Manual sync failed:', error);
    clearTimeout(timeoutId); // Cancel timeout on error
    throw error;
  } finally {
    // Release sync lock (always runs even if error occurs)
    await db.metadata.put({ key: 'isSyncing', value: false });
  }
}

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
