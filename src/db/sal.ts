import { db, Sal, generateId, now, SyncQueueItem } from './database';
import { triggerImmediateUpload } from '../sync/syncEngine';
import { updateMappingEntry, getMappingEntriesForProject } from './mappings';
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
  const entries = await getMappingEntriesForProject(projectId);
  let unassignedCount = 0;

  for (const entry of entries) {
    const hasSalCrossings = entry.crossings?.some((crossing) => crossing.salId === salId);
    if (!hasSalCrossings) {
      continue;
    }

    const updatedCrossings = entry.crossings.map((crossing) =>
      crossing.salId === salId ? { ...crossing, salId: undefined } : crossing
    );
    unassignedCount += entry.crossings.filter((crossing) => crossing.salId === salId).length;

    await updateMappingEntry(entry.id, { crossings: updatedCrossings }, userId);
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
    await updateMappingEntry(entry.id, { crossings: updatedCrossings }, userId);
  }

  return assignedCount;
}
