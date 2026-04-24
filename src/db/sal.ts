import { db, MappingEntry, StructureEntry, Sal, generateId, now, SyncQueueItem } from './database';
import { triggerImmediateUpload } from '../sync/syncEngine';
import { getMappingEntriesForProject } from './mappings';
import { getStructureEntriesForProject } from './structures';
import { supabase } from '../lib/supabase';
import {
  applyPendingWrites,
  getPendingEntityIds,
  isAuthError,
  isOnlineAndConfigured,
  writeThroughCache,
} from './onlineFirst';

function convertRemoteToLocalSal(remote: any): Sal {
  return {
    id: remote.id,
    projectId: remote.project_id,
    number: remote.number,
    name: remote.name || undefined,
    date: remote.date,
    notes: remote.notes || undefined,
    createdAt: new Date(remote.created_at).getTime(),
    synced: 1,
  };
}

async async function enqueueStructureEntryUpdate(entry: StructureEntry): Promise<void> {
  const existingSyncItem = await db.syncQueue
    .where('entityType')
    .equals('structure_entry')
    .and((item) => item.entityId === entry.id && item.synced === 0 && item.operation !== 'DELETE')
    .first();

  if (existingSyncItem) {
    await db.syncQueue.update(existingSyncItem.id, {
      payload: entry,
      timestamp: now(),
    });
    return;
  }

  await db.syncQueue.add({
    id: generateId(),
    operation: 'UPDATE',
    entityType: 'structure_entry',
    entityId: entry.id,
    payload: entry,
    timestamp: now(),
    retryCount: 0,
    synced: 0,
  });
}

async function enqueueMappingEntryUpdate(entry: MappingEntry): Promise<void> {
  const existingSyncItem = await db.syncQueue
    .where('entityType')
    .equals('mapping_entry')
    .and((item) => item.entityId === entry.id && item.synced === 0 && item.operation !== 'DELETE')
    .first();

  if (existingSyncItem) {
    await db.syncQueue.update(existingSyncItem.id, {
      payload: entry,
      timestamp: now(),
    });
    return;
  }

  await db.syncQueue.add({
    id: generateId(),
    operation: 'UPDATE',
    entityType: 'mapping_entry',
    entityId: entry.id,
    payload: entry,
    timestamp: now(),
    retryCount: 0,
    synced: 0,
  });
}

export async function getSalsForProject(projectId: string): Promise<Sal[]> {
  if (isOnlineAndConfigured()) {
    try {
      const { data, error } = await supabase
        .from('sals')
        .select('*')
        .eq('project_id', projectId)
        .order('number', { ascending: true });

      if (error) {
        throw error;
      }

      const remoteSals: Sal[] = (data || []).map(convertRemoteToLocalSal);
      const pendingIds = await getPendingEntityIds(
        'sal',
        (item) => (item.payload as Sal)?.projectId === projectId
      );
      const cached: Sal[] = await writeThroughCache<Sal>(
        remoteSals,
        pendingIds,
        db.sals
      );
      const withPending = await applyPendingWrites<Sal>(
        cached,
        'sal',
        (item) => (item.payload as Sal)?.projectId === projectId
      );

      return withPending.sort((a, b) => a.number - b.number);
    } catch (err) {
      if (isAuthError(err)) {
        throw err;
      }
      console.warn('[online-first] getSalsForProject fallback to IndexedDB', err);
    }
  }

  return db.sals.where('projectId').equals(projectId).sortBy('number');
}

export async function createSal(
  projectId: string,
  name: string | undefined,
  date: number,
  notes?: string
): Promise<Sal> {
  const existing = await db.sals.where('projectId').equals(projectId).toArray();
  const maxNumber = existing.length > 0 ? Math.max(...existing.map((sal) => sal.number)) : 0;

  const sal: Sal = {
    id: generateId(),
    projectId,
    number: maxNumber + 1,
    name,
    date,
    notes,
    createdAt: now(),
    synced: 0,
  };

  await db.sals.add(sal);

  const syncItem: SyncQueueItem = {
    id: generateId(),
    operation: 'CREATE',
    entityType: 'sal',
    entityId: sal.id,
    payload: sal,
    timestamp: now(),
    retryCount: 0,
    synced: 0,
  };
  await db.syncQueue.add(syncItem);
  triggerImmediateUpload();

  return sal;
}

export async function updateSal(
  id: string,
  updates: Partial<Pick<Sal, 'name' | 'date' | 'notes'>>
): Promise<void> {
  const existing = await db.sals.get(id);
  if (!existing) {
    throw new Error(`SAL not found: ${id}`);
  }

  await db.sals.update(id, { ...updates, synced: 0 });

  const updated = await db.sals.get(id);
  const syncItem: SyncQueueItem = {
    id: generateId(),
    operation: 'UPDATE',
    entityType: 'sal',
    entityId: id,
    payload: updated,
    timestamp: now(),
    retryCount: 0,
    synced: 0,
  };
  await db.syncQueue.add(syncItem);
  triggerImmediateUpload();
}

export async function deleteSal(
  salId: string,
  projectId: string,
  userId: string
): Promise<number> {
  const [entries, structEntries] = await Promise.all([
    getMappingEntriesForProject(projectId),
    getStructureEntriesForProject(projectId),
  ]);
  let unassignedCount = 0;

  await db.transaction('rw', [db.mappingEntries, db.structureEntries, db.sals, db.syncQueue], async () => {
    for (const entry of entries) {
      const hasSalCrossings = entry.crossings?.some((crossing) => crossing.salId === salId);
      if (!hasSalCrossings) {
        continue;
      }

      let entryUnassigned = 0;
      const updatedCrossings = entry.crossings.map((crossing) => {
        if (crossing.salId === salId) {
          entryUnassigned += 1;
          return { ...crossing, salId: undefined };
        }
        return crossing;
      });
      unassignedCount += entryUnassigned;

      const updatedEntry: MappingEntry = {
        ...entry,
        crossings: updatedCrossings,
        modifiedBy: userId,
        lastModified: now(),
        version: (entry.version ?? 0) + 1,
        synced: 0,
      };

      await db.mappingEntries.put(updatedEntry);
      await enqueueMappingEntryUpdate(updatedEntry);
    }

    for (const entry of structEntries) {
      const hasSalStructures = entry.structures?.some((s) => s.salId === salId);
      if (!hasSalStructures) {
        continue;
      }

      let entryUnassigned = 0;
      const updatedStructures = entry.structures.map((s) => {
        if (s.salId === salId) {
          entryUnassigned += 1;
          return { ...s, salId: undefined };
        }
        return s;
      });
      unassignedCount += entryUnassigned;

      const updatedEntry: StructureEntry = {
        ...entry,
        structures: updatedStructures,
        modifiedBy: userId,
        lastModified: now(),
        version: (entry.version ?? 0) + 1,
        synced: 0,
      };

      await db.structureEntries.put(updatedEntry);
      await enqueueStructureEntryUpdate(updatedEntry);
    }

    const sal = await db.sals.get(salId);
    await db.sals.delete(salId);

    const syncItem: SyncQueueItem = {
      id: generateId(),
      operation: 'DELETE',
      entityType: 'sal',
      entityId: salId,
      payload: sal || { id: salId, projectId },
      timestamp: now(),
      retryCount: 0,
      synced: 0,
    };
    await db.syncQueue.add(syncItem);
  });

  triggerImmediateUpload();

  return unassignedCount;
}

export async function assignCrossingsToSal(
  projectId: string,
  salId: string,
  userId: string,
  includeToComplete = false
): Promise<number> {
  const entries = await getMappingEntriesForProject(projectId);
  let assignedCount = 0;

  await db.transaction('rw', [db.mappingEntries, db.syncQueue], async () => {
    for (const entry of entries) {
      if (!includeToComplete && entry.toComplete) {
        continue;
      }

      const hasUnassigned = entry.crossings?.some((crossing) => !crossing.salId);
      if (!hasUnassigned) {
        continue;
      }

      let entryAssigned = 0;
      const updatedCrossings = entry.crossings.map((crossing) => {
        if (!crossing.salId) {
          entryAssigned += 1;
          return { ...crossing, salId };
        }
        return crossing;
      });

      assignedCount += entryAssigned;

      const updatedEntry: MappingEntry = {
        ...entry,
        crossings: updatedCrossings,
        modifiedBy: userId,
        lastModified: now(),
        version: (entry.version ?? 0) + 1,
        synced: 0,
      };

      await db.mappingEntries.put(updatedEntry);
      await enqueueMappingEntryUpdate(updatedEntry);
    }
  });

  if (assignedCount > 0) {
    triggerImmediateUpload();
  }

  return assignedCount;
}

export async function assignStructuresToSal(
  projectId: string,
  salId: string,
  userId: string,
  includeToComplete = false
): Promise<number> {
  const entries = await getStructureEntriesForProject(projectId);
  let assignedCount = 0;

  await db.transaction('rw', [db.structureEntries, db.syncQueue], async () => {
    for (const entry of entries) {
      if (!includeToComplete && entry.toComplete) {
        continue;
      }

      const hasUnassigned = entry.structures?.some((s) => !s.salId);
      if (!hasUnassigned) {
        continue;
      }

      let entryAssigned = 0;
      const updatedStructures = entry.structures.map((s) => {
        if (!s.salId) {
          entryAssigned += 1;
          return { ...s, salId };
        }
        return s;
      });

      assignedCount += entryAssigned;

      const updatedEntry: StructureEntry = {
        ...entry,
        structures: updatedStructures,
        modifiedBy: userId,
        lastModified: now(),
        version: (entry.version ?? 0) + 1,
        synced: 0,
      };

      await db.structureEntries.put(updatedEntry);
      await enqueueStructureEntryUpdate(updatedEntry);
    }
  });

  if (assignedCount > 0) {
    triggerImmediateUpload();
  }

  return assignedCount;
}
