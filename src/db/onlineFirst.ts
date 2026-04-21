import { db, SyncQueueItem } from './database';
import { isSupabaseConfigured } from '../lib/supabase';

export function isOnlineAndConfigured(): boolean {
  return navigator.onLine && isSupabaseConfigured();
}

export async function getPendingEntityIds(
  entityType: SyncQueueItem['entityType'],
  filter?: (item: SyncQueueItem) => boolean
): Promise<Set<string>> {
  const pending = await db.syncQueue
    .where('entityType')
    .equals(entityType)
    .and((item) => item.synced === 0)
    .toArray();

  const relevant = filter ? pending.filter(filter) : pending;
  return new Set(relevant.map((item) => item.entityId));
}

export async function applyPendingWrites<T extends { id: string }>(
  remoteItems: T[],
  entityType: SyncQueueItem['entityType'],
  filter: (item: SyncQueueItem) => boolean
): Promise<T[]> {
  const pending = await db.syncQueue
    .where('entityType')
    .equals(entityType)
    .and((item) => item.synced === 0)
    .toArray();

  const relevant = pending.filter(filter).sort((a, b) => a.timestamp - b.timestamp);
  if (relevant.length === 0) {
    return remoteItems;
  }

  const resultMap = new Map<string, T>(remoteItems.map((item) => [item.id, item]));

  for (const pendingItem of relevant) {
    if (pendingItem.operation === 'DELETE') {
      resultMap.delete(pendingItem.entityId);
      continue;
    }

    resultMap.set(pendingItem.entityId, pendingItem.payload as T);
  }

  return Array.from(resultMap.values());
}

export async function writeThroughCache<T extends { id: string }>(
  remoteItems: T[],
  pendingIds: Set<string>,
  table: any,
  mergeLocalFields?: (remote: T, existing: T | undefined) => T
): Promise<T[]> {
  const mergedItems: T[] = [];

  for (const remoteItem of remoteItems) {
    const existing = mergeLocalFields ? await table.get(remoteItem.id) : undefined;
    const itemToSave = mergeLocalFields ? mergeLocalFields(remoteItem, existing) : remoteItem;

    mergedItems.push(itemToSave);

    if (!pendingIds.has(remoteItem.id)) {
      await table.put(itemToSave);
    }
  }

  return mergedItems;
}

export function isAuthError(err: any): boolean {
  return (
    err?.status === 401 ||
    err?.status === 403 ||
    err?.code === 'PGRST301' ||
    err?.message?.includes('JWT')
  );
}
