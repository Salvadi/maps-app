import { db, generateId, now, MappingEntry, Photo, PhotoMetadata, SyncQueueItem } from './database';
import { triggerImmediateUpload } from '../sync/syncEngine';
import type { Database } from '../lib/supabase';
import { apiFetchJson, isHomeserverConfigured } from '../lib/homeserver';
import { apiStorageFrom } from '../lib/storageShim';
import {
  applyPendingWrites,
  getPendingEntityIds,
  shouldFallbackToIndexedDb,
  writeThroughCache,
} from './onlineFirst';
import { convertRemoteToLocalMapping } from '../sync/conflictResolution';

type RemotePhotoRow = Database['public']['Tables']['photos']['Row'];
const PHOTO_SIGN_BATCH_SIZE = 500;

// Gate locale per le letture online-first via homeserver.
function isHomeserverOnline(): boolean {
  return navigator.onLine && isHomeserverConfigured();
}

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

function buildFloorPlanLabel(entry: MappingEntry): string[] {
  const parts: string[] = [];
  if (entry.floor) parts.push(`P${entry.floor}`);
  if (entry.room) parts.push(`S${entry.room}`);
  if (entry.intervention) parts.push(`Int${entry.intervention}`);
  return [parts.length > 0 ? parts.join('_') : 'Punto'];
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

export async function resequenceMappingInterventions(projectId: string): Promise<void> {
  const entries = await db.mappingEntries.where('projectId').equals(projectId).toArray();
  if (entries.length === 0) return;

  const groups = new Map<string, MappingEntry[]>();
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
      if ((entry.intervention || '') === nextIntervention) {
        continue;
      }

      const updatedEntry: MappingEntry = {
        ...entry,
        intervention: nextIntervention,
        lastModified: now(),
        version: entry.version + 1,
        synced: 0,
      };

      await db.mappingEntries.put(updatedEntry);
      await upsertPendingSyncItem('mapping_entry', updatedEntry.id, updatedEntry);

      const linkedPoints = await db.floorPlanPoints
        .where('mappingEntryId')
        .equals(updatedEntry.id)
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
          const { data, error } = await apiStorageFrom('photos').createSignedUrls(batch, 60 * 60);
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
          const { data, error } = await apiStorageFrom('photos').createSignedUrls(batch, 60 * 60);
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
  if (isHomeserverOnline()) {
    try {
      // Paginazione: backend hardcap limit=1000 per chiamata, loop offset per progetti >1000 entries.
      const PAGE = 1000;
      const remoteRows: Database['public']['Tables']['mapping_entries']['Row'][] = [];
      let offset = 0;
      while (true) {
        const params = new URLSearchParams({
          project_id: `eq.${projectId}`,
          select: '*',
          limit: String(PAGE),
          offset: String(offset),
        });
        const { data } = await apiFetchJson<{
          data: Database['public']['Tables']['mapping_entries']['Row'][];
        }>(`/api/mapping_entries?${params.toString()}`);
        if (!data || data.length === 0) break;
        remoteRows.push(...data);
        if (data.length < PAGE) break;
        offset += PAGE;
      }

      const remoteEntries: MappingEntry[] = remoteRows.map(convertRemoteToLocalMapping);
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

      // Filtro 'floor' applicato client-side dopo overlay dei pending locali.
      if (options?.floor) {
        results = results.filter((entry) => entry.floor === options.floor);
      }

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
      if (!shouldFallbackToIndexedDb(err)) {
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

  if (isHomeserverOnline()) {
    try {
      const rows: RemotePhotoRow[] = [];
      const PAGE = 1000;
      for (const batch of chunkArray(mappingEntryIds, 100)) {
        const idsParam = batch.join(',');
        let offset = 0;

        // Paginazione interna in caso batch produca più di 1000 foto.
        while (true) {
          const { data } = await apiFetchJson<{ data: RemotePhotoRow[] | null }>(
            `/api/photos?mapping_entry_id=in.${idsParam}&select=*&limit=${PAGE}&offset=${offset}`
          );
          const pageRows = data || [];

          if (pageRows.length === 0) {
            break;
          }

          rows.push(...pageRows);

          if (pageRows.length < PAGE) {
            break;
          }

          offset += PAGE;
        }
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
      if (!shouldFallbackToIndexedDb(err)) {
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

/**
 * B10 — Ricostruisce l'array `photos` embedded a partire dalla tabella `photos`,
 * che è l'unica fonte di verità. Va usato in fase di upload per il payload sia di
 * mapping_entries che di structure_entries: evita che la copia embedded
 * (MappingEntry.photos / StructureEntry.photos) diverga dalle righe reali quando
 * la sync remota assegna/aggiorna metadata. Le foto sono indicizzate per
 * `mappingEntryId` anche per le strutture (discriminate da entryType).
 */
export async function buildPhotoMetadataFromTable(entryId: string): Promise<PhotoMetadata[]> {
  const photos = await db.photos.where('mappingEntryId').equals(entryId).toArray();
  return photos.map((photo) => ({
    id: photo.id,
    localBlobId: photo.blob ? photo.id : undefined,
    remoteUrl: photo.remoteUrl,
    timestamp: photo.metadata?.captureTimestamp ?? now(),
    size: photo.metadata?.size ?? 0,
    compressed: false,
  }));
}

export async function ensurePhotoBlob(photoId: string): Promise<Photo | undefined> {
  const photo = await db.photos.get(photoId);
  if (!photo) {
    return undefined;
  }

  if (photo.blob || !isHomeserverOnline()) {
    return photo;
  }

  try {
    let blob: Blob | null = null;

    if (photo.storagePath) {
      const { data, error } = await apiStorageFrom('photos').download(photo.storagePath);
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
  if (isHomeserverOnline()) {
    try {
      const entries: { id: string }[] = [];
      const PAGE = 1000;
      let offset = 0;

      // Paginazione su mapping_entries perché backend hardcap 1000 per chiamata.
      while (true) {
        const { data } = await apiFetchJson<{ data: { id: string }[] | null }>(
          `/api/mapping_entries?project_id=eq.${projectId}&select=id&limit=${PAGE}&offset=${offset}`
        );
        const pageEntries = data || [];

        if (pageEntries.length === 0) {
          break;
        }

        entries.push(...pageEntries);

        if (pageEntries.length < PAGE) {
          break;
        }

        offset += PAGE;
      }

      if (entries.length === 0) return 0;

      let totalCount = 0;
      for (const batch of chunkArray(entries.map((entry) => entry.id), 100)) {
        const idsParam = batch.join(',');
        const { count } = await apiFetchJson<{ count: number }>(
          `/api/photos?mapping_entry_id=in.${idsParam}&select=id&count=exact&head=true&limit=1`
        );
        totalCount += count || 0;
      }
      return totalCount;
    } catch (err) {
      if (!shouldFallbackToIndexedDb(err)) throw err;
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
