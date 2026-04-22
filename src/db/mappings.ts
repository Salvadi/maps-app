import { db, generateId, now, MappingEntry, Photo, SyncQueueItem } from './database';
import { triggerImmediateUpload } from '../sync/syncEngine';
import { supabase, type Database } from '../lib/supabase';
import {
  applyPendingWrites,
  getPendingEntityIds,
  isAuthError,
  isOnlineAndConfigured,
  writeThroughCache,
} from './onlineFirst';
import { convertRemoteToLocalMapping } from '../sync/conflictResolution';

type RemotePhotoRow = Database['public']['Tables']['photos']['Row'];
const PHOTO_SIGN_BATCH_SIZE = 500;

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

function getRemotePhotoTimestamp(metadata: any): number {
  const rawTimestamp = metadata?.captureTimestamp ?? metadata?.capture_timestamp;
  return typeof rawTimestamp === 'number' ? rawTimestamp : now();
}

function buildLocalPhotoFromRemoteRow(
  row: RemotePhotoRow,
  localPhoto: Photo | undefined,
  signedByPath: Map<string, string>,
  signedThumbByPath: Map<string, string>
): Photo {
  return {
    id: row.id,
    mappingEntryId: row.mapping_entry_id,
    blob: localPhoto?.blob,
    thumbnailBlob: localPhoto?.thumbnailBlob,
    metadata: row.metadata || localPhoto?.metadata || {
      width: 0,
      height: 0,
      size: 0,
      mimeType: 'image/jpeg',
      captureTimestamp: now(),
    },
    uploaded: true,
    remoteUrl: row.storage_path
      ? signedByPath.get(row.storage_path) ?? row.url ?? undefined
      : row.url ?? undefined,
    thumbnailRemoteUrl: row.thumbnail_storage_path
      ? signedThumbByPath.get(row.thumbnail_storage_path) ?? row.thumbnail_url ?? undefined
      : row.thumbnail_url ?? (row.storage_path ? signedByPath.get(row.storage_path) ?? row.url ?? undefined : row.url ?? undefined),
    storagePath: row.storage_path || undefined,
    thumbnailStoragePath: row.thumbnail_storage_path || undefined,
  };
}

async function signPhotoPaths(rows: RemotePhotoRow[]): Promise<{
  signedByPath: Map<string, string>;
  signedThumbByPath: Map<string, string>;
}> {
  const fullPaths = rows
    .map((row) => row.storage_path)
    .filter((path: string | null | undefined): path is string => Boolean(path));
  const thumbPaths = rows
    .map((row) => row.thumbnail_storage_path)
    .filter((path: string | null | undefined): path is string => Boolean(path));

  const signedByPath = new Map<string, string>();
  const signedThumbByPath = new Map<string, string>();

  await Promise.all([
    (async () => {
      if (fullPaths.length > 0) {
        for (const batch of chunkArray(fullPaths, PHOTO_SIGN_BATCH_SIZE)) {
          const { data, error } = await supabase.storage.from('photos').createSignedUrls(batch, 60 * 60);
          if (error) throw error;
          for (const item of data || []) {
            if (item.path && item.signedUrl) signedByPath.set(item.path, item.signedUrl);
          }
        }
      }
    })(),
    (async () => {
      if (thumbPaths.length > 0) {
        for (const batch of chunkArray(thumbPaths, PHOTO_SIGN_BATCH_SIZE)) {
          const { data, error } = await supabase.storage.from('photos').createSignedUrls(batch, 60 * 60);
          if (error) throw error;
          for (const item of data || []) {
            if (item.path && item.signedUrl) signedThumbByPath.set(item.path, item.signedUrl);
          }
        }
      }
    })(),
  ]);

  return { signedByPath, signedThumbByPath };
}

export async function createMappingEntry(
  mappingData: Omit<MappingEntry, 'id' | 'timestamp' | 'lastModified' | 'version' | 'synced' | 'photos' | 'modifiedBy'>,
  photoBlobs: Blob[]
): Promise<MappingEntry> {
  const entry: MappingEntry = {
    ...mappingData,
    id: generateId(),
    timestamp: now(),
    lastModified: now(),
    modifiedBy: mappingData.createdBy,
    version: 1,
    synced: 0,
    photos: [],
  };

  try {
    const photoMetadata = [];
    for (const blob of photoBlobs) {
      const photoId = generateId();
      const photo: Photo = {
        id: photoId,
        blob,
        mappingEntryId: entry.id,
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
    await db.mappingEntries.add(entry);

    const syncItem: SyncQueueItem = {
      id: generateId(),
      operation: 'CREATE',
      entityType: 'mapping_entry',
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
    console.error('Failed to create mapping entry:', error);
    throw error;
  }
}

export async function getMappingEntry(id: string): Promise<MappingEntry | undefined> {
  return db.mappingEntries.get(id);
}

export async function getMappingEntriesForProject(
  projectId: string,
  options?: {
    floor?: string;
    sortBy?: 'timestamp' | 'floor';
    limit?: number;
  }
): Promise<MappingEntry[]> {
  if (isOnlineAndConfigured()) {
    try {
      let query = supabase
        .from('mapping_entries')
        .select('*')
        .eq('project_id', projectId);

      if (options?.floor) {
        query = query.eq('floor', options.floor);
      }

      const { data, error } = await query;
      if (error) {
        throw error;
      }

      const remoteEntries: MappingEntry[] = (data || []).map(convertRemoteToLocalMapping);
      const pendingIds = await getPendingEntityIds(
        'mapping_entry',
        (item) => (item.payload as MappingEntry)?.projectId === projectId
      );
      const cached: MappingEntry[] = await writeThroughCache<MappingEntry>(
        remoteEntries,
        pendingIds,
        db.mappingEntries
      );
      let results = await applyPendingWrites<MappingEntry>(
        cached,
        'mapping_entry',
        (item) => (item.payload as MappingEntry)?.projectId === projectId
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
      console.warn('[online-first] getMappingEntriesForProject fallback to IndexedDB', err);
    }
  }

  let query = db.mappingEntries.where('projectId').equals(projectId);

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

export async function updateMappingEntry(
  id: string,
  updates: Partial<Omit<MappingEntry, 'id' | 'timestamp' | 'projectId'>>,
  userId: string
): Promise<MappingEntry> {
  const entry = await db.mappingEntries.get(id);
  if (!entry) {
    throw new Error(`Mapping entry not found: ${id}`);
  }

  const updatedEntry: MappingEntry = {
    ...entry,
    ...updates,
    lastModified: now(),
    modifiedBy: userId,
    version: entry.version + 1,
    synced: 0,
  };

  try {
    await db.mappingEntries.put(updatedEntry);

    const existingSyncItem = await db.syncQueue
      .where('entityType')
      .equals('mapping_entry')
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
        entityType: 'mapping_entry',
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
    console.error('Failed to update mapping entry:', error);
    throw error;
  }
}

export async function deleteMappingEntry(id: string): Promise<void> {
  try {
    const photos = await db.photos.where('mappingEntryId').equals(id).toArray();
    await db.photos.where('mappingEntryId').equals(id).delete();

    const orphanedPoints = await db.floorPlanPoints.where('mappingEntryId').equals(id).toArray();
    for (const point of orphanedPoints) {
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

    await db.mappingEntries.delete(id);

    const syncItem: SyncQueueItem = {
      id: generateId(),
      operation: 'DELETE',
      entityType: 'mapping_entry',
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

    triggerImmediateUpload();
  } catch (error) {
    console.error('Failed to delete mapping entry:', error);
    throw error;
  }
}

export async function getPhotosForMappings(
  mappingEntryIds: string[]
): Promise<Record<string, Photo[]>> {
  if (mappingEntryIds.length === 0) {
    return {};
  }

  if (isOnlineAndConfigured()) {
    try {
      const rows: RemotePhotoRow[] = [];
      for (const batch of chunkArray(mappingEntryIds, 100)) {
        const { data, error } = await supabase
          .from('photos')
          .select('*')
          .in('mapping_entry_id', batch);

        if (error) {
          throw error;
        }

        rows.push(...((data as RemotePhotoRow[] | null) || []));
      }
      const localPhotos = await db.photos.where('mappingEntryId').anyOf(mappingEntryIds).toArray();
      const localById = new Map(localPhotos.map((photo) => [photo.id, photo]));
      const pendingPhotoIds = await getPendingEntityIds('photo');
      const pendingDeletes = await db.syncQueue
        .where('entityType')
        .equals('photo')
        .and((item) => item.synced === 0 && item.operation === 'DELETE')
        .toArray();
      const pendingDeleteIds = new Set(pendingDeletes.map((item) => item.entityId));
      const { signedByPath, signedThumbByPath } = await signPhotoPaths(rows);

      const remotePhotos = rows
        .filter((row: RemotePhotoRow) => !pendingDeleteIds.has(row.id))
        .map((row: RemotePhotoRow) =>
          buildLocalPhotoFromRemoteRow(row, localById.get(row.id), signedByPath, signedThumbByPath)
        );

      await writeThroughCache(remotePhotos, pendingPhotoIds, db.photos, undefined, (photo) => ({
        ...photo,
        remoteUrl: undefined,
        thumbnailRemoteUrl: undefined,
      }));

      const remoteIds = new Set(remotePhotos.map((photo: Photo) => photo.id));
      const mergedPhotos = [...remotePhotos];

      for (const localPhoto of localPhotos) {
        if (pendingDeleteIds.has(localPhoto.id)) {
          continue;
        }
        if (!remoteIds.has(localPhoto.id) || !localPhoto.uploaded) {
          mergedPhotos.push(localPhoto);
        }
      }

      const grouped: Record<string, Photo[]> = {};
      for (const id of mappingEntryIds) {
        grouped[id] = [];
      }

      for (const photo of mergedPhotos) {
        if (!grouped[photo.mappingEntryId]) {
          grouped[photo.mappingEntryId] = [];
        }
        grouped[photo.mappingEntryId].push(photo);
      }

      for (const id of Object.keys(grouped)) {
        grouped[id].sort((a, b) => getRemotePhotoTimestamp(a.metadata) - getRemotePhotoTimestamp(b.metadata));
      }

      return grouped;
    } catch (err) {
      if (isAuthError(err)) {
        throw err;
      }
      console.warn('[online-first] getPhotosForMappings fallback to IndexedDB', err);
    }
  }

  const localPhotos = await db.photos.where('mappingEntryId').anyOf(mappingEntryIds).toArray();
  const grouped: Record<string, Photo[]> = {};
  for (const id of mappingEntryIds) {
    grouped[id] = [];
  }
  for (const photo of localPhotos) {
    if (!grouped[photo.mappingEntryId]) {
      grouped[photo.mappingEntryId] = [];
    }
    grouped[photo.mappingEntryId].push(photo);
  }
  return grouped;
}

export async function getPhotosForMapping(mappingEntryId: string): Promise<Photo[]> {
  const grouped = await getPhotosForMappings([mappingEntryId]);
  return grouped[mappingEntryId] || [];
}

export async function ensurePhotoBlob(photoId: string): Promise<Photo | undefined> {
  const photo = await db.photos.get(photoId);
  if (!photo) {
    return undefined;
  }

  if (photo.blob || !isOnlineAndConfigured()) {
    return photo;
  }

  try {
    let blob: Blob | null = null;

    if (photo.storagePath) {
      const { data, error } = await supabase.storage.from('photos').download(photo.storagePath);
      if (error) {
        throw error;
      }
      blob = data;
    } else if (photo.remoteUrl) {
      const response = await fetch(photo.remoteUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch remote photo ${photoId}: ${response.status}`);
      }
      blob = await response.blob();
    }

    if (!blob) {
      return photo;
    }

    const updatedPhoto: Photo = {
      ...photo,
      blob,
    };
    await db.photos.put(updatedPhoto);
    return updatedPhoto;
  } catch (error) {
    console.warn(`Failed to hydrate photo blob ${photoId}`, error);
    return photo;
  }
}

export async function addPhotosToMapping(
  mappingEntryId: string,
  photoBlobs: Blob[],
  userId: string
): Promise<MappingEntry> {
  const entry = await db.mappingEntries.get(mappingEntryId);
  if (!entry) {
    throw new Error(`Mapping entry not found: ${mappingEntryId}`);
  }

  const newPhotoMetadata = [];
  for (const blob of photoBlobs) {
    const photoId = generateId();
    const photo: Photo = {
      id: photoId,
      blob,
      mappingEntryId,
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
  return updateMappingEntry(mappingEntryId, { photos: updatedPhotos }, userId);
}

export async function removePhotoFromMapping(
  mappingEntryId: string,
  photoId: string,
  userId: string
): Promise<MappingEntry> {
  const entry = await db.mappingEntries.get(mappingEntryId);
  if (!entry) {
    throw new Error(`Mapping entry not found: ${mappingEntryId}`);
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

  const updatedPhotos = entry.photos.filter((photoMeta) => photoMeta.id !== photoId);
  return updateMappingEntry(mappingEntryId, { photos: updatedPhotos }, userId);
}

export async function getUnsyncedMappings(): Promise<MappingEntry[]> {
  return db.mappingEntries.where('synced').equals(0).toArray();
}

export async function markMappingSynced(id: string): Promise<void> {
  await db.mappingEntries.update(id, { synced: 1 });
}

export async function getMappingCountForProject(projectId: string): Promise<number> {
  return db.mappingEntries.where('projectId').equals(projectId).count();
}

export async function getPhotoCountForProject(projectId: string): Promise<number> {
  if (isOnlineAndConfigured()) {
    try {
      const { count, error } = await supabase
        .from('photos')
        .select('id, mapping_entries!inner(id)', { count: 'exact', head: true })
        .eq('mapping_entries.project_id', projectId);
      if (error) throw error;
      return count ?? 0;
    } catch (err) {
      if (isAuthError(err)) throw err;
      console.warn('[getPhotoCountForProject] fallback local:', err);
    }
  }

  let total = 0;
  await db.mappingEntries
    .where('projectId')
    .equals(projectId)
    .each((entry) => {
      total += entry.photos?.length ?? 0;
    });
  return total;
}
