import { db, Sal, generateId, now, SyncQueueItem } from './database';
import { triggerImmediateUpload } from '../sync/syncEngine';
import { updateMappingEntry, getMappingEntriesForProject } from './mappings';
import { supabase } from '../lib/supabase';
import {
  isOnlineAndConfigured,
  getPendingEntityIds,
  applyPendingWrites,
  writeThroughCache,
  isAuthError,
} from './onlineFirst';

/**
 * Converte un record SAL da formato Supabase a formato locale
 */
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

/**
 * Ottieni tutti i SAL di un progetto ordinati per numero.
 * Online-first: reads from Supabase when connected, falls back to IndexedDB when offline.
 */
export async function getSalsForProject(projectId: string): Promise<Sal[]> {
  if (isOnlineAndConfigured()) {
    try {
      const { data, error } = await supabase
        .from('sals')
        .select('*')
        .eq('project_id', projectId)
        .order('number', { ascending: true });

      if (error) throw error;

      const remoteSals = (data || []).map(convertRemoteToLocalSal);

      const pendingIds = await getPendingEntityIds(
        'sal',
        (item) => (item.payload as Sal)?.projectId === projectId
      );

      await writeThroughCache(remoteSals, pendingIds, db.sals);

      const results = await applyPendingWrites<Sal>(
        remoteSals,
        'sal',
        (item) => (item.payload as Sal)?.projectId === projectId
      );

      return results.sort((a, b) => a.number - b.number);
    } catch (err) {
      if (isAuthError(err)) throw err;
      console.warn('[online-first] getSalsForProject: fallback su IndexedDB', err);
    }
  }

  // Offline fallback
  return db.sals.where('projectId').equals(projectId).sortBy('number');
}

/**
 * Crea un nuovo SAL
 */
export async function createSal(
  projectId: string,
  name: string | undefined,
  date: number,
  notes?: string
): Promise<Sal> {
  // Calcola prossimo numero progressivo
  const existing = await db.sals.where('projectId').equals(projectId).toArray();
  const maxNumber = existing.length > 0
    ? Math.max(...existing.map(s => s.number))
    : 0;

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

  // Aggiungi alla coda di sync
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

/**
 * Aggiorna un SAL esistente (nome, data, note)
 */
export async function updateSal(
  id: string,
  updates: Partial<Pick<Sal, 'name' | 'date' | 'notes'>>
): Promise<void> {
  const existing = await db.sals.get(id);
  if (!existing) throw new Error(`SAL not found: ${id}`);

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

/**
 * Elimina un SAL e rimuove il salId da tutti i crossing associati
 */
export async function deleteSal(
  salId: string,
  projectId: string,
  userId: string
): Promise<number> {
  // Rimuovi salId da tutti i crossing che referenziano questo SAL
  const entries = await getMappingEntriesForProject(projectId);
  let unassignedCount = 0;

  for (const entry of entries) {
    const hasSalCrossings = entry.crossings?.some(c => c.salId === salId);
    if (!hasSalCrossings) continue;

    const updatedCrossings = entry.crossings.map(c =>
      c.salId === salId ? { ...c, salId: undefined } : c
    );
    unassignedCount += entry.crossings.filter(c => c.salId === salId).length;

    await updateMappingEntry(entry.id, { crossings: updatedCrossings }, userId);
  }

  // Elimina il record SAL
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

/**
 * Assegna tutti i crossing non contabilizzati di un progetto a un SAL.
 * Per default esclude le mappature marcate come "da completare".
 * Passare includeToComplete=true per assegnare anche quelle.
 * Ritorna il conteggio degli attraversamenti assegnati.
 */
export async function assignCrossingsToSal(
  projectId: string,
  salId: string,
  userId: string,
  includeToComplete = false
): Promise<number> {
  const entries = await getMappingEntriesForProject(projectId);
  let assignedCount = 0;

  for (const entry of entries) {
    if (!includeToComplete && entry.toComplete) continue;
    const hasUnassigned = entry.crossings?.some(c => !c.salId);
    if (!hasUnassigned) continue;

    let entryAssigned = 0;
    const updatedCrossings = entry.crossings.map(c => {
      if (!c.salId) {
        entryAssigned++;
        return { ...c, salId };
      }
      return c;
    });
    assignedCount += entryAssigned;

    await updateMappingEntry(entry.id, { crossings: updatedCrossings }, userId);
  }

  return assignedCount;
}
