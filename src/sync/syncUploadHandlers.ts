/**
 * @file Gestori di upload per la sincronizzazione (Upload Handlers)
 * @description Contiene i gestori per l'upload delle singole entità verso Supabase:
 * progetti, mapping entries, foto, planimetrie, punti planimetria e mappe standalone.
 * Ogni gestore gestisce CREATE, UPDATE e DELETE con conversione formato locale → remoto.
 */

import { db, Project, MappingEntry, Photo, Sal, SyncQueueItem, TypologyPrice, generateId } from '../db/database';
import { supabase } from '../lib/supabase';
import { checkForConflicts, resolveProjectConflict, resolveMappingEntryConflict } from './conflictResolution';

// ============================================
// SEZIONE: Dispatcher principale (Main Dispatcher)
// Smista l'item di sync al gestore corretto in base al tipo di entità.
// ============================================

export async function processSyncItem(item: SyncQueueItem): Promise<void> {
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

    case 'sal':
      await syncSal(item);
      break;

    case 'typology_price':
      await syncTypologyPrice(item);
      break;

    default:
      throw new Error(`Unknown entity type: ${item.entityType}`);
  }
}

// ============================================
// SEZIONE: Upload Progetti (Project Upload)
// Gestisce CREATE, UPDATE e DELETE di progetti verso Supabase.
// Include rilevamento e risoluzione conflitti per gli UPDATE.
// ============================================

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
      archived: Boolean(project.archived),
      // NOTE: syncEnabled is NOT synced - it's a per-device preference
      created_at: new Date(project.createdAt).toISOString(),
      updated_at: new Date(project.updatedAt).toISOString(),
      version: project.version || 1, // Add version for conflict detection
      last_modified: project.lastModified || project.updatedAt, // Add lastModified
      synced: 1
    };

    const { error } = await supabase
      .from('projects')
      .upsert(supabaseProject, { onConflict: 'id' });

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
      archived: Boolean(project.archived),
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
    return;
  }

  // Mark local as synced
  await db.projects.update(project.id, { synced: 1 });
}

// ============================================
// SEZIONE: Upload Mapping Entries (Mapping Entry Upload)
// Gestisce CREATE/UPDATE/DELETE di mapping entries verso Supabase.
// Dopo l'upsert di un'entry, aggiunge anche le foto non caricate alla coda di sync.
// ============================================

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
      to_complete: entry.toComplete || false,
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
        const photoSyncItemId = `${entry.id}-photo-${photo.id}`;
        const existingPhotoSyncItem = await db.syncQueue.get(photoSyncItemId);
        if (existingPhotoSyncItem?.synced === 2 || existingPhotoSyncItem?.synced === 0) {
          continue;
        }

        const photoSyncItem: SyncQueueItem = {
          id: photoSyncItemId,
          operation: 'CREATE',
          entityType: 'photo',
          entityId: photo.id,
          payload: photo,
          timestamp: Date.now(),
          retryCount: 0,
          synced: 0
        };

        await db.syncQueue.put(photoSyncItem);
        console.log(`📸 Added photo ${photo.id} to sync queue`);
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

// ============================================
// SEZIONE: Upload Foto (Photo Upload)
// Gestisce upload/eliminazione di foto verso Supabase Storage.
// Per CREATE/UPDATE: carica il blob, ottiene l'URL pubblico e crea il record metadata.
// Per DELETE: rimuove il file dallo storage e il record dal database.
// ============================================

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

    // Create photo metadata record in Supabase
    const { error: metaError } = await supabase
      .from('photos')
      .upsert({
        id: photoMeta.id,
        mapping_entry_id: photoMeta.mappingEntryId,
        storage_path: fileName,
        url: null,
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
    // Use explicit storage paths from the sync queue payload because
    // the photo may already be gone from IndexedDB when DELETE runs.
    const storagePaths = [
      photoMeta.storagePath,
      photoMeta.thumbnailStoragePath,
      photoMeta.mappingEntryId ? `${photoMeta.mappingEntryId}/${photoMeta.id}.jpg` : undefined,
    ].filter((path, index, array): path is string => Boolean(path) && array.indexOf(path) === index);

    // Delete from storage
    if (storagePaths.length > 0) {
      const { error: storageError } = await supabase.storage
        .from('photos')
        .remove(storagePaths);

      if (storageError) {
        console.warn(`Failed to delete photo from storage: ${storageError.message}`);
        // Continue with metadata deletion even if storage deletion fails
      } else {
        console.log(`🗑️ Deleted photo from storage: ${storagePaths.join(', ')}`);
      }
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

// ============================================
// SEZIONE: Upload Planimetrie (Floor Plan Upload)
// Gestisce upload/eliminazione di planimetrie verso Supabase.
// Per CREATE/UPDATE: carica i blob immagine nello storage e crea il record DB.
// Per DELETE: elimina record DB e file dallo storage.
// ============================================

async function syncFloorPlan(item: SyncQueueItem): Promise<void> {
  const floorPlan = item.payload as any; // FloorPlan type from database.ts

  if (item.operation === 'CREATE' || item.operation === 'UPDATE') {
    // Get the actual floor plan from IndexedDB (with blobs)
    const localFloorPlan = await db.floorPlans.get(floorPlan.id);

    if (!localFloorPlan) {
      throw new Error(`Floor plan not found: ${floorPlan.id}`);
    }

    // --- Conflict detection ANTICIPATO: check PRIMA di qualsiasi upload asset ---
    if (localFloorPlan.remoteUpdatedAt != null) {
      try {
        const { data: remoteRecord } = await supabase
          .from('floor_plans')
          .select('updated_at')
          .eq('id', localFloorPlan.id)
          .single();

        if (remoteRecord) {
          const remoteUpdatedAt = new Date(remoteRecord.updated_at).getTime();
          // Se il remote è stato modificato dopo il nostro ultimo sync → conflitto
          if (remoteUpdatedAt > localFloorPlan.remoteUpdatedAt + 5000) {
            console.warn(
              `⚠️  CONFLICT: Floor plan ${localFloorPlan.id} was modified remotely ` +
              `(remote: ${new Date(remoteUpdatedAt).toISOString()}, ` +
              `our base: ${new Date(localFloorPlan.remoteUpdatedAt).toISOString()}). ` +
              `Skipping upload to avoid overwriting remote changes. Sync to get latest version.`
            );
            // Log conflict to conflictHistory
            await db.conflictHistory.add({
              id: generateId(),
              timestamp: Date.now(),
              entityType: 'floor_plan',
              entityId: localFloorPlan.id,
              conflictType: 'timestamp',
              localVersion: { updatedAt: localFloorPlan.updatedAt, remoteUpdatedAt: localFloorPlan.remoteUpdatedAt },
              remoteVersion: { updatedAt: remoteUpdatedAt },
              resolvedVersion: null,
              strategy: 'skip_upload_floor_plan',
              autoResolved: true,
              userNotified: false,
            });
            // Incrementa retryCount così l'item non viene skippato silenziosamente all'infinito
            await db.syncQueue.update(item.id, { retryCount: (item.retryCount ?? 0) + 1 });
            return; // Do NOT upload assets né upsert — utente deve sincronizzare prima
          }
        }
      } catch {
        // Errore di rete durante il check → procedi con upload (best-effort)
        console.warn(`⚠️  Could not check remote version for floor plan ${localFloorPlan.id}, proceeding with upload`);
      }
    }

    // Upload blobs to Supabase Storage when missing or when local assets changed.
    let imageUrl = localFloorPlan.imageUrl;
    let thumbnailUrl = localFloorPlan.thumbnailUrl;
    const previousImageUrl = localFloorPlan.imageUrl;
    const previousThumbnailUrl = localFloorPlan.thumbnailUrl;
    let pdfUrl = localFloorPlan.pdfUrl;
    const previousPdfUrl = localFloorPlan.pdfUrl;

    if ((!imageUrl || localFloorPlan.assetDirty === 1) && localFloorPlan.imageBlob) {
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
      await db.floorPlans.update(floorPlan.id, { imageUrl, thumbnailUrl, synced: 1 });
    }

    // Upload PDF originale indipendentemente dall'imageUrl (il PDF può esistere
    // anche quando le immagini sono già state caricate in un ciclo precedente)
    if ((!pdfUrl || localFloorPlan.assetDirty === 1) && localFloorPlan.pdfBlobBase64) {
      try {
        const { uploadFloorPlanPDF } = await import('../utils/floorPlanUtils');
        const binaryStr = atob(localFloorPlan.pdfBlobBase64);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
        const pdfBlob = new Blob([bytes], { type: 'application/pdf' });
        pdfUrl = await uploadFloorPlanPDF(
          localFloorPlan.projectId,
          localFloorPlan.floor,
          pdfBlob,
          localFloorPlan.createdBy
        );
        await db.floorPlans.update(floorPlan.id, { pdfUrl });
        console.log(`📄 Uploaded PDF originale for floor plan ${floorPlan.id}`);
      } catch (pdfErr) {
        console.warn(`⚠️  Failed to upload PDF for floor plan ${floorPlan.id}:`, pdfErr);
      }
    }

    if (
      (previousImageUrl && previousImageUrl !== imageUrl) ||
      (previousThumbnailUrl && previousThumbnailUrl !== thumbnailUrl) ||
      (previousPdfUrl && previousPdfUrl !== pdfUrl)
    ) {
      const { deleteFloorPlan } = await import('../utils/floorPlanUtils');
      try {
        await deleteFloorPlan(previousImageUrl, previousThumbnailUrl, previousPdfUrl);
      } catch (cleanupError) {
        console.warn(`Failed to clean previous floor plan assets for ${floorPlan.id}:`, cleanupError);
      }
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
        pdf_url: pdfUrl || null,
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

    // After successful upload, update remoteUpdatedAt to match what we just wrote
    await db.floorPlans.update(localFloorPlan.id, {
      remoteUpdatedAt: localFloorPlan.updatedAt,
      assetDirty: 0,
      synced: 1,
    });
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
    if (floorPlan.imageUrl || floorPlan.thumbnailUrl || floorPlan.pdfUrl) {
      const { deleteFloorPlan } = await import('../utils/floorPlanUtils');
      try {
        await deleteFloorPlan(floorPlan.imageUrl, floorPlan.thumbnailUrl, floorPlan.pdfUrl);
      } catch (err) {
        console.warn('Failed to delete floor plan from storage:', err);
      }
    }
  }
}

// ============================================
// SEZIONE: Upload Punti Planimetria (Floor Plan Point Upload)
// Gestisce CREATE/UPDATE/DELETE di punti sulla planimetria verso Supabase.
// ============================================

async function syncFloorPlanPoint(item: SyncQueueItem): Promise<void> {
  const point = item.payload as any; // FloorPlanPoint type

  if (item.operation === 'CREATE' || item.operation === 'UPDATE') {
    // Get latest local point data (may have remoteUpdatedAt)
    const localPoint = await db.floorPlanPoints.get(point.id);
    const effectivePoint = localPoint || point;

    // --- Conflict detection: check if remote has been modified since our last sync ---
    if (effectivePoint.remoteUpdatedAt != null) {
      try {
        const { data: remoteRecord } = await supabase
          .from('floor_plan_points')
          .select('updated_at')
          .eq('id', effectivePoint.id)
          .single();

        if (remoteRecord) {
          const remoteUpdatedAt = new Date(remoteRecord.updated_at).getTime();
          if (remoteUpdatedAt > effectivePoint.remoteUpdatedAt + 5000) {
            console.warn(
              `⚠️  CONFLICT: Floor plan point ${effectivePoint.id} was modified remotely ` +
              `(remote: ${new Date(remoteUpdatedAt).toISOString()}, ` +
              `our base: ${new Date(effectivePoint.remoteUpdatedAt).toISOString()}). ` +
              `Skipping upload to avoid overwriting remote changes.`
            );
            await db.conflictHistory.add({
              id: generateId(),
              timestamp: Date.now(),
              entityType: 'floor_plan_point',
              entityId: effectivePoint.id,
              conflictType: 'timestamp',
              localVersion: { updatedAt: effectivePoint.updatedAt, remoteUpdatedAt: effectivePoint.remoteUpdatedAt },
              remoteVersion: { updatedAt: remoteUpdatedAt },
              resolvedVersion: null,
              strategy: 'skip_upload_floor_plan_point',
              autoResolved: true,
              userNotified: false,
            });
            // Incrementa retryCount così l'item non viene skippato silenziosamente all'infinito
            await db.syncQueue.update(item.id, { retryCount: (item.retryCount ?? 0) + 1 });
            return;
          }
        }
      } catch {
        console.warn(`⚠️  Could not check remote version for floor plan point ${effectivePoint.id}, proceeding with upload`);
      }
    }

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
        ei_rating: point.eiRating ?? null,
        metadata: { ...(point.metadata || {}), ...(point.eiRating != null ? { eiRating: point.eiRating } : {}) },
        created_by: point.createdBy,
        created_at: new Date(point.createdAt).toISOString(),
        updated_at: new Date(point.updatedAt).toISOString()
      }, {
        onConflict: 'id'
      });

    if (error) {
      throw new Error(`Supabase floor plan point upsert failed: ${error.message}`);
    }

    // After successful upload, update remoteUpdatedAt
    await db.floorPlanPoints.update(point.id, {
      remoteUpdatedAt: point.updatedAt,
      synced: 1,
    });
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

// ============================================
// SEZIONE: Upload Mappe Standalone (Standalone Map Upload)
// Gestisce CREATE/UPDATE/DELETE di mappe standalone verso Supabase.
// Per CREATE/UPDATE: carica blob immagine e crea record DB.
// Per DELETE: elimina record DB e file dallo storage.
// ============================================

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

// ============================================
// SEZIONE: Upload SAL (SAL Upload)
// Gestisce CREATE/UPDATE/DELETE di SAL verso Supabase.
// ============================================

async function syncSal(item: SyncQueueItem): Promise<void> {
  const sal = item.payload as Sal;

  if (item.operation === 'CREATE' || item.operation === 'UPDATE') {
    const supabaseSal = {
      id: sal.id,
      project_id: sal.projectId,
      number: sal.number,
      name: sal.name || null,
      date: sal.date,
      notes: sal.notes || null,
      created_at: new Date(sal.createdAt).toISOString(),
      synced: true,
    };

    const { error } = await supabase
      .from('sals')
      .upsert(supabaseSal, { onConflict: 'id' });

    if (error) {
      throw new Error(`Supabase SAL upsert failed: ${error.message}`);
    }

    await db.sals.update(sal.id, { synced: 1 });
  } else if (item.operation === 'DELETE') {
    const { error } = await supabase
      .from('sals')
      .delete()
      .eq('id', sal.id);

    if (error) {
      throw new Error(`Supabase SAL delete failed: ${error.message}`);
    }
  }
}

async function syncTypologyPrice(item: SyncQueueItem): Promise<void> {
  const price = item.payload as TypologyPrice;

  if (item.operation === 'CREATE' || item.operation === 'UPDATE') {
    const { error } = await supabase
      .from('typology_prices')
      .upsert({
        id: price.id,
        project_id: price.projectId,
        attraversamento: price.attraversamento,
        tipologico_id: price.tipologicoId || null,
        price_per_unit: price.pricePerUnit,
        unit: price.unit,
        created_at: price.createdAt ? new Date(price.createdAt).toISOString() : new Date().toISOString(),
        updated_at: new Date(price.updatedAt || Date.now()).toISOString(),
      }, {
        onConflict: 'id'
      });

    if (error) {
      throw new Error(`Supabase typology price upsert failed: ${error.message}`);
    }

    await db.typologyPrices.update(price.id, {
      synced: 1,
      updatedAt: price.updatedAt || Date.now(),
    });
  } else if (item.operation === 'DELETE') {
    const { error } = await supabase
      .from('typology_prices')
      .delete()
      .eq('id', price.id);

    if (error) {
      throw new Error(`Supabase typology price delete failed: ${error.message}`);
    }
  }
}
