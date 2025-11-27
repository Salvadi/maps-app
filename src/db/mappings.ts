import { db, generateId, now, MappingEntry, Photo, SyncQueueItem } from './database';

/**
 * Create a new mapping entry with photos
 */
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
    synced: false,
    photos: [] // Will be populated below
  };

  try {
    // Store photos
    const photoMetadata = [];
    for (const blob of photoBlobs) {
      const photoId = generateId();
      const photo: Photo = {
        id: photoId,
        blob,
        mappingEntryId: entry.id,
        metadata: {
          width: 0, // Will be set after compression
          height: 0,
          size: blob.size,
          mimeType: blob.type,
          captureTimestamp: now()
        },
        uploaded: false
      };

      await db.photos.add(photo);

      photoMetadata.push({
        id: photoId,
        localBlobId: photoId,
        timestamp: now(),
        size: blob.size,
        compressed: false
      });
    }

    entry.photos = photoMetadata;

    // Add mapping entry
    await db.mappingEntries.add(entry);

    // Add to sync queue
    const syncItem: SyncQueueItem = {
      id: generateId(),
      operation: 'CREATE',
      entityType: 'mapping',
      entityId: entry.id,
      payload: entry,
      timestamp: now(),
      retryCount: 0,
      synced: false
    };
    await db.syncQueue.add(syncItem);

    console.log('Mapping entry created:', entry.id);
    return entry;
  } catch (error) {
    console.error('Failed to create mapping entry:', error);
    throw error;
  }
}

/**
 * Get a mapping entry by ID
 */
export async function getMappingEntry(id: string): Promise<MappingEntry | undefined> {
  return await db.mappingEntries.get(id);
}

/**
 * Get all mapping entries for a project
 */
export async function getMappingEntriesForProject(
  projectId: string,
  options?: {
    floor?: string;
    sortBy?: 'timestamp' | 'floor';
    limit?: number;
  }
): Promise<MappingEntry[]> {
  let query = db.mappingEntries.where('projectId').equals(projectId);

  if (options?.floor) {
    query = query.and(entry => entry.floor === options.floor);
  }

  let results = await query.toArray();

  if (options?.sortBy === 'timestamp') {
    results.sort((a, b) => b.timestamp - a.timestamp);
  } else if (options?.sortBy === 'floor') {
    results.sort((a, b) => a.floor.localeCompare(b.floor));
  }

  if (options?.limit) {
    results = results.slice(0, options.limit);
  }

  return results;
}

/**
 * Update a mapping entry
 */
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
    synced: false
  };

  try {
    await db.mappingEntries.put(updatedEntry);

    // Add to sync queue
    const syncItem: SyncQueueItem = {
      id: generateId(),
      operation: 'UPDATE',
      entityType: 'mapping',
      entityId: id,
      payload: updatedEntry,
      timestamp: now(),
      retryCount: 0,
      synced: false
    };
    await db.syncQueue.add(syncItem);

    console.log('Mapping entry updated:', id);
    return updatedEntry;
  } catch (error) {
    console.error('Failed to update mapping entry:', error);
    throw error;
  }
}

/**
 * Delete a mapping entry and associated photos
 */
export async function deleteMappingEntry(id: string): Promise<void> {
  try {
    // Delete photos
    await db.photos.where('mappingEntryId').equals(id).delete();

    // Delete mapping entry
    await db.mappingEntries.delete(id);

    // Add to sync queue
    const syncItem: SyncQueueItem = {
      id: generateId(),
      operation: 'DELETE',
      entityType: 'mapping',
      entityId: id,
      payload: { id },
      timestamp: now(),
      retryCount: 0,
      synced: false
    };
    await db.syncQueue.add(syncItem);

    console.log('Mapping entry deleted:', id);
  } catch (error) {
    console.error('Failed to delete mapping entry:', error);
    throw error;
  }
}

/**
 * Get photos for a mapping entry
 */
export async function getPhotosForMapping(mappingEntryId: string): Promise<Photo[]> {
  return await db.photos
    .where('mappingEntryId')
    .equals(mappingEntryId)
    .toArray();
}

/**
 * Add photos to an existing mapping entry
 */
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
        captureTimestamp: now()
      },
      uploaded: false
    };

    await db.photos.add(photo);

    newPhotoMetadata.push({
      id: photoId,
      localBlobId: photoId,
      timestamp: now(),
      size: blob.size,
      compressed: false
    });
  }

  const updatedPhotos = [...entry.photos, ...newPhotoMetadata];
  return await updateMappingEntry(mappingEntryId, { photos: updatedPhotos }, userId);
}

/**
 * Remove a photo from a mapping entry
 */
export async function removePhotoFromMapping(
  mappingEntryId: string,
  photoId: string,
  userId: string
): Promise<MappingEntry> {
  const entry = await db.mappingEntries.get(mappingEntryId);
  if (!entry) {
    throw new Error(`Mapping entry not found: ${mappingEntryId}`);
  }

  // Delete photo blob
  await db.photos.delete(photoId);

  // Update mapping entry
  const updatedPhotos = entry.photos.filter(p => p.id !== photoId);
  return await updateMappingEntry(mappingEntryId, { photos: updatedPhotos }, userId);
}

/**
 * Get unsynced mapping entries
 */
export async function getUnsyncedMappings(): Promise<MappingEntry[]> {
  return await db.mappingEntries
    .where('synced')
    .equals(0)
    .toArray();
}

/**
 * Mark mapping entry as synced
 */
export async function markMappingSynced(id: string): Promise<void> {
  await db.mappingEntries.update(id, { synced: true });
}

/**
 * Get mapping entries count for a project
 */
export async function getMappingCountForProject(projectId: string): Promise<number> {
  return await db.mappingEntries
    .where('projectId')
    .equals(projectId)
    .count();
}

/**
 * Get total photos count for a project
 */
export async function getPhotoCountForProject(projectId: string): Promise<number> {
  const entries = await db.mappingEntries
    .where('projectId')
    .equals(projectId)
    .toArray();

  return entries.reduce((sum, entry) => sum + entry.photos.length, 0);
}
