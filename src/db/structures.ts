import { db, generateId, now, StructureEntry, Photo, PhotoMetadata, SyncQueueItem } from './database';
import { triggerImmediateUpload } from '../sync/syncEngine';
import { supabase } from '../lib/supabase';
import {
  applyPendingWrites,
  getPendingEntityIds,
  isAuthError,
  isOnlineAndConfigured,
  writeThroughCache,
} from './onlineFirst';

function compareInterventionValues(a?: string, b?: string): number {
  const valueA = (a || '').trim();
  const valueB = (b || '').trim();
  const numA = Number(valueA);
  const numB = Number(valueB);
  const aIsNum = valueA !== '' && Number.isFinite(numA);
  const bIsNum = valueB !== '' && Number.isFinite(numB);

  if (aIsNum && bIsNum) {
    return numA - numB;
  }
  return valueA.localeCompare(valueB, 'it', { numeric: true, sensitivity: 'base' });
}

function buildFloorPlanLabel(entry: StructureEntry): string[] {
  const parts: string[] = [];
  if (entry.floor) parts.push(`P${entry.floor}`);
  if (entry.room) parts.push(`S${entry.room}`);
  if (entry.intervention) parts.push(`Int${entry.intervention}`);
  return [parts.length > 0 ? parts.join('_') : 'Struttura'];
}

async function upsertPendingSyncItem(
  entityType: SyncQueueItem['entityType'],
  entityId: string,
  payload: unknown
): Promise<void> {
  const existingSyncItem = await db.syncQueue
    .where('entityType')
    .equals(entityType)
    .and((item) => item.entityId === entityId && item.synced === 0 && item.operation !== 'DELETE')
    .first();

  if (existingSyncItem) {
    await db.syncQueue.update(existingSyncItem.id, {
      payload,
      timestamp: now(),
    });
    return;
  }

  await db.syncQueue.add({
    id: generateId(),
    operation: 'UPDATE',
    entityType,
    entityId,
    payload,
    timestamp: now(),
    retryCount: 0,
    synced: 0,
  });
}

async function resequenceProjectInterventions(projectId: string): Promise<void> {
  const entries = await db.structureEntries.where('projectId').equals(projectId).toArray();
  if (entries.length === 0) return;

  const groups = new Map<string, StructureEntry[]>();
  for (const entry of entries) {
    const key = `${entry.floor || ''}__${entry.room || ''}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(entry);
  }

  let hasChanges = false;

  for (const groupEntries of Array.from(groups.values())) {
    groupEntries.sort((a, b) => {
      const byIntervention = compareInterventionValues(a.intervention, b.intervention);
      if (byIntervention !== 0) return byIntervention;
      return a.timestamp - b.timestamp;
    });

    for (let index = 0; index < groupEntries.length; index += 1) {
      const entry = groupEntries[index];
      const nextIntervention = String(index + 1);
      if ((entry.intervention || '') === nextIntervention) continue;

      const updatedEntry: StructureEntry = {
        ...entry,
        intervention: nextIntervention,
        lastModified: now(),
        version: entry.version + 1,
        synced: 0,
      };

      await db.structureEntries.put(updatedEntry);
      await upsertPendingSyncItem('structure_entry', updatedEntry.id, updatedEntry);

      const linkedPoints = await db.floorPlanPoints
        .filter((point) => point.mappingEntryId === updatedEntry.id || point.structureEntryId === updatedEntry.id)
        .toArray();

      for (const point of linkedPoints) {
        const updatedPoint = {
          ...point,
          metadata: {
            ...point.metadata,
            labelText: buildFloorPlanLabel(updatedEntry),
          },
          updatedAt: now(),
          synced: 0 as const,
        };
        await db.floorPlanPoints.put(updatedPoint);
        await upsertPendingSyncItem('floor_plan_point', updatedPoint.id, updatedPoint);
      }

      hasChanges = true;
    }
  }

  if (hasChanges) {
    triggerImmediateUpload();
  }
}

export function convertRemoteToLocalStructure(remote: any): StructureEntry {
  return {
    id: remote.id,
    projectId: remote.project_id,
    floor: remote.floor,
    room: remote.room || undefined,
    intervention: remote.intervention || undefined,
    photos: remote.photos || [],
    structures: remote.structures || [],
    toComplete: remote.to_complete || false,
    timestamp: typeof remote.timestamp === 'number' ? remote.timestamp : new Date(remote.timestamp).getTime(),
    createdBy: remote.created_by,
    lastModified: typeof remote.last_modified === 'number' ? remote.last_modified : new Date(remote.last_modified).getTime(),
    modifiedBy: remote.modified_by,
    version: remote.version || 1,
    synced: 1,
  };
}

export async function createStructureEntry(
  entryData: Omit<StructureEntry, 'id' | 'timestamp' | 'lastModified' | 'version' | 'synced' | 'photos' | 'modifiedBy'>,
  photoBlobs: Blob[]
): Promise<StructureEntry> {
  const entry: StructureEntry = {
    ...entryData,
    id: generateId(),
    timestamp: now(),
    lastModified: now(),
    modifiedBy: entryData.createdBy,
    version: 1,
    synced: 0,
    photos: [],
  };

  try {
    const photoMetadata: PhotoMetadata[] = [];
    for (const blob of photoBlobs) {
      const photoId = generateId();
      const photo: Photo = {
        id: photoId,
        blob,
        mappingEntryId: entry.id,
        entryType: 'structure',
        metadata: {
          width: 0,
          height: 0,
          size: blob.size,
          mimeType: blob.type,
          captureTimestamp: now(),
        },
        uploaded: false,
      };

      await db.photos.add(photo);

      photoMetadata.push({
        id: photoId,
        localBlobId: photoId,
        timestamp: now(),
        size: blob.size,
        compressed: false,
      });
    }

    entry.photos = photoMetadata;
    await db.structureEntries.add(entry);

    const syncItem: SyncQueueItem = {
      id: generateId(),
      operation: 'CREATE',
      entityType: 'structure_entry',
      entityId: entry.id,
      payload: entry,
      timestamp: now(),
      retryCount: 0,
      synced: 0,
    };
    await db.syncQueue.add(syncItem);
    triggerImmediateUpload();

    return entry;
  } catch (error) {
    console.error('Failed to create structure entry:', error);
    throw error;
  }
}

export async function getStructureEntry(id: string): Promise<StructureEntry | undefined> {
  return db.structureEntries.get(id);
}

export async function getStructureEntriesForProject(
  projectId: string,
  options?: {
    floor?: string;
    sortBy?: 'timestamp' | 'floor';
    limit?: number;
  }
): Promise<StructureEntry[]> {
  if (isOnlineAndConfigured()) {
    try {
      let query = supabase
        .from('structure_entries')
        .select('*')
        .eq('project_id', projectId);

      if (options?.floor) {
        query = query.eq('floor', options.floor);
      }

      const { data, error } = await query;
      if (error) {
        throw error;
      }

      const remoteEntries: StructureEntry[] = (data || []).map(convertRemoteToLocalStructure);
      const pendingIds = await getPendingEntityIds(
        'structure_entry',
        (item) => (item.payload as StructureEntry)?.projectId === projectId
      );
      const cached: StructureEntry[] = await writeThroughCache<StructureEntry>(
        remoteEntries,
        pendingIds,
        db.structureEntries
      );
      let results = await applyPendingWrites<StructureEntry>(
        cached,
        'structure_entry',
        (item) => (item.payload as StructureEntry)?.projectId === projectId
      );

      if (options?.sortBy === 'timestamp') {
        results.sort((a, b) => b.timestamp - a.timestamp);
      } else if (options?.sortBy === 'floor') {
        results.sort((a, b) => a.floor.localeCompare(b.floor, 'it', { numeric: true }));
      } else {
        results.sort((a, b) => b.timestamp - a.timestamp);
      }

      if (options?.limit) {
        results = results.slice(0, options.limit);
      }

      return results;
    } catch (err) {
      if (isAuthError(err)) {
        throw err;
      }
      console.warn('[online-first] getStructureEntriesForProject fallback to IndexedDB', err);
    }
  }

  let query = db.structureEntries.where('projectId').equals(projectId);

  if (options?.floor) {
    query = query.and((entry) => entry.floor === options.floor);
  }

  let results = await query.toArray();

  if (options?.sortBy === 'timestamp') {
    results.sort((a, b) => b.timestamp - a.timestamp);
  } else if (options?.sortBy === 'floor') {
    results.sort((a, b) => a.floor.localeCompare(b.floor, 'it', { numeric: true }));
  } else {
    results.sort((a, b) => b.timestamp - a.timestamp);
  }

  if (options?.limit) {
    results = results.slice(0, options.limit);
  }

  return results;
}

export async function updateStructureEntry(
  id: string,
  updates: Partial<Omit<StructureEntry, 'id' | 'timestamp' | 'projectId'>>,
  userId: string
): Promise<StructureEntry> {
  const entry = await db.structureEntries.get(id);
  if (!entry) {
    throw new Error(`Structure entry not found: ${id}`);
  }

  const updatedEntry: StructureEntry = {
    ...entry,
    ...updates,
    lastModified: now(),
    modifiedBy: userId,
    version: entry.version + 1,
    synced: 0,
  };

  try {
    await db.structureEntries.put(updatedEntry);

    const existingSyncItem = await db.syncQueue
      .where('entityType')
      .equals('structure_entry')
      .and((item) => item.entityId === id && item.synced === 0 && item.operation !== 'DELETE')
      .first();

    if (existingSyncItem) {
      await db.syncQueue.update(existingSyncItem.id, {
        payload: updatedEntry,
        timestamp: now(),
      });
    } else {
      const syncItem: SyncQueueItem = {
        id: generateId(),
        operation: 'UPDATE',
        entityType: 'structure_entry',
        entityId: id,
        payload: updatedEntry,
        timestamp: now(),
        retryCount: 0,
        synced: 0,
      };
      await db.syncQueue.add(syncItem);
    }

    triggerImmediateUpload();

    return updatedEntry;
  } catch (error) {
    console.error('Failed to update structure entry:', error);
    throw error;
  }
}

export async function deleteStructureEntry(id: string): Promise<void> {
  try {
    const entry = await db.structureEntries.get(id);
    const photos = await db.photos.where('mappingEntryId').equals(id).toArray();
    await db.photos.where('mappingEntryId').equals(id).delete();

    const orphanedPoints = await db.floorPlanPoints
      .where('mappingEntryId').equals(id)
      .toArray();
    const orphanedPointsByStructure = await db.floorPlanPoints
      .filter((p) => p.structureEntryId === id)
      .toArray();
    const allOrphanedPoints = [...orphanedPoints, ...orphanedPointsByStructure];

    for (const point of allOrphanedPoints) {
      await db.floorPlanPoints.delete(point.id);
      await db.syncQueue.add({
        id: generateId(),
        operation: 'DELETE',
        entityType: 'floor_plan_point',
        entityId: point.id,
        payload: { id: point.id },
        timestamp: now(),
        retryCount: 0,
        synced: 0,
      });
    }

    await db.structureEntries.delete(id);

    const syncItem: SyncQueueItem = {
      id: generateId(),
      operation: 'DELETE',
      entityType: 'structure_entry',
      entityId: id,
      payload: { id },
      timestamp: now(),
      retryCount: 0,
      synced: 0,
    };
    await db.syncQueue.add(syncItem);

    for (const photo of photos) {
      if (!photo.uploaded) continue;
      await db.syncQueue.add({
        id: generateId(),
        operation: 'DELETE',
        entityType: 'photo',
        entityId: photo.id,
        payload: {
          id: photo.id,
          mappingEntryId: photo.mappingEntryId,
          storagePath: photo.storagePath,
          thumbnailStoragePath: photo.thumbnailStoragePath,
        },
        timestamp: now(),
        retryCount: 0,
        synced: 0,
      });
    }

    if (entry?.projectId) {
      await resequenceProjectInterventions(entry.projectId);
    }

    triggerImmediateUpload();
  } catch (error) {
    console.error('Failed to delete structure entry:', error);
    throw error;
  }
}

export async function getPhotosForStructure(structureEntryId: string): Promise<Photo[]> {
  if (isOnlineAndConfigured()) {
    try {
      const { data, error } = await supabase
        .from('photos')
        .select('*')
        .eq('structure_entry_id', structureEntryId);

      if (error) throw error;

      const rows = data || [];
      const localPhotos = (await db.photos.where('mappingEntryId').equals(structureEntryId).toArray())
        .filter((p) => p.entryType === 'structure');
      const localById = new Map(localPhotos.map((p) => [p.id, p]));

      const remotePhotos: Photo[] = rows.map((row: any) => ({
        id: row.id,
        mappingEntryId: structureEntryId,
        entryType: 'structure' as const,
        blob: localById.get(row.id)?.blob,
        thumbnailBlob: localById.get(row.id)?.thumbnailBlob,
        metadata: row.metadata || localById.get(row.id)?.metadata || {
          width: 0, height: 0, size: 0, mimeType: 'image/jpeg', captureTimestamp: now(),
        },
        uploaded: true,
        remoteUrl: row.url ?? undefined,
        thumbnailRemoteUrl: row.thumbnail_url ?? undefined,
        storagePath: row.storage_path ?? undefined,
        thumbnailStoragePath: row.thumbnail_storage_path ?? undefined,
      }));

      return remotePhotos;
    } catch (err) {
      if (isAuthError(err)) throw err;
      console.warn('[getPhotosForStructure] fallback to IndexedDB', err);
    }
  }

  return (await db.photos.where('mappingEntryId').equals(structureEntryId).toArray())
    .filter((p) => p.entryType === 'structure');
}

export async function addPhotosToStructure(
  structureEntryId: string,
  photoBlobs: Blob[],
  userId: string
): Promise<StructureEntry> {
  const entry = await db.structureEntries.get(structureEntryId);
  if (!entry) {
    throw new Error(`Structure entry not found: ${structureEntryId}`);
  }

  const newPhotoMetadata: PhotoMetadata[] = [];
  for (const blob of photoBlobs) {
    const photoId = generateId();
    const photo: Photo = {
      id: photoId,
      blob,
      mappingEntryId: structureEntryId,
      entryType: 'structure',
      metadata: {
        width: 0,
        height: 0,
        size: blob.size,
        mimeType: blob.type,
        captureTimestamp: now(),
      },
      uploaded: false,
    };

    await db.photos.add(photo);

    newPhotoMetadata.push({
      id: photoId,
      localBlobId: photoId,
      timestamp: now(),
      size: blob.size,
      compressed: false,
    });
  }

  const updatedPhotos = [...entry.photos, ...newPhotoMetadata];
  return updateStructureEntry(structureEntryId, { photos: updatedPhotos }, userId);
}

export async function removePhotoFromStructure(
  structureEntryId: string,
  photoId: string,
  userId: string
): Promise<StructureEntry> {
  const entry = await db.structureEntries.get(structureEntryId);
  if (!entry) {
    throw new Error(`Structure entry not found: ${structureEntryId}`);
  }

  const photo = await db.photos.get(photoId);
  await db.photos.delete(photoId);

  if (photo) {
    const syncItem: SyncQueueItem = {
      id: generateId(),
      operation: 'DELETE',
      entityType: 'photo',
      entityId: photoId,
      payload: {
        id: photo.id,
        mappingEntryId: photo.mappingEntryId,
        storagePath: photo.storagePath,
        thumbnailStoragePath: photo.thumbnailStoragePath,
      },
      timestamp: now(),
      retryCount: 0,
      synced: 0,
    };
    await db.syncQueue.add(syncItem);
    triggerImmediateUpload();
  }

  const updatedPhotos = entry.photos.filter((pm) => pm.id !== photoId);
  return updateStructureEntry(structureEntryId, { photos: updatedPhotos }, userId);
}

export async function getStructureCountForProject(projectId: string): Promise<number> {
  return db.structureEntries.where('projectId').equals(projectId).count();
}
