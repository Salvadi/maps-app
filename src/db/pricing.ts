import { db, TypologyPrice, generateId, now, SyncQueueItem } from './database';
import { MeasureUnit, legacyToUnit } from '../config/units';
import { triggerImmediateUpload } from '../sync/syncEngine';
import { apiFetchJson, isHomeserverConfigured } from '../lib/homeserver';
import {
  applyPendingWrites,
  getPendingEntityIds,
  shouldFallbackToIndexedDb,
  writeThroughCache,
} from './onlineFirst';

// Gate locale per le letture online-first via homeserver.
function isHomeserverOnline(): boolean {
  return navigator.onLine && isHomeserverConfigured();
}

function convertRemoteToLocalTypologyPrice(remote: any): TypologyPrice {
  return {
    id: remote.id,
    projectId: remote.project_id,
    category: remote.category || 'attraversamento',
    attraversamento: remote.attraversamento,
    tipologicoId: remote.tipologico_id || undefined,
    pricePerUnit: remote.price_per_unit,
    unit: legacyToUnit(remote.unit, (remote.category === 'struttura' ? 'mq' : 'pz')),
    createdAt: remote.created_at ? new Date(remote.created_at).getTime() : undefined,
    updatedAt: remote.updated_at ? new Date(remote.updated_at).getTime() : undefined,
    synced: 1,
  };
}

export async function getTypologyPrices(projectId: string): Promise<TypologyPrice[]> {
  if (isHomeserverOnline()) {
    try {
      const PAGE = 1000;
      const rows: Record<string, unknown>[] = [];
      let offset = 0;

      // Paginazione client-side per superare l'hardcap backend di 1000 righe per chiamata.
      while (true) {
        const params = new URLSearchParams({
          project_id: `eq.${projectId}`,
          select: '*',
          limit: String(PAGE),
          offset: String(offset),
        });

        const { data } = await apiFetchJson<{
          data: Record<string, unknown>[];
        }>(`/api/typology_prices?${params.toString()}`);
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

      const remotePrices: TypologyPrice[] = rows.map(convertRemoteToLocalTypologyPrice);
      const pendingIds = await getPendingEntityIds(
        'typology_price',
        (item) => (item.payload as TypologyPrice)?.projectId === projectId
      );
      const cached: TypologyPrice[] = await writeThroughCache<TypologyPrice>(
        remotePrices,
        pendingIds,
        db.typologyPrices
      );
      const withPending = await applyPendingWrites<TypologyPrice>(
        cached,
        'typology_price',
        (item) => (item.payload as TypologyPrice)?.projectId === projectId
      );

      return withPending.sort((a, b) => {
        const attr = a.attraversamento.localeCompare(b.attraversamento, 'it');
        if (attr !== 0) {
          return attr;
        }
        return (a.tipologicoId || '').localeCompare(b.tipologicoId || '', 'it');
      });
    } catch (err) {
      if (!shouldFallbackToIndexedDb(err)) {
        throw err;
      }
      console.warn('[online-first] getTypologyPrices fallback to IndexedDB', err);
    }
  }

  return db.typologyPrices.where('projectId').equals(projectId).toArray();
}

export async function upsertTypologyPrice(
  projectId: string,
  attraversamento: string,
  pricePerUnit: number,
  unit: MeasureUnit,
  tipologicoId?: string,
  category: 'attraversamento' | 'struttura' = 'attraversamento'
): Promise<void> {
  const existing = tipologicoId
    ? await db.typologyPrices
        .where('[projectId+attraversamento+tipologicoId]')
        .equals([projectId, attraversamento, tipologicoId])
        .filter((price) => (price.category ?? 'attraversamento') === category)
        .first()
    : await db.typologyPrices
        .where('[projectId+attraversamento]')
        .equals([projectId, attraversamento])
        .filter((price) => !price.tipologicoId && (price.category ?? 'attraversamento') === category)
        .first();

  const timestamp = now();

  if (existing) {
    const updatedPrice: TypologyPrice = {
      ...existing,
      pricePerUnit,
      unit,
      updatedAt: timestamp,
      synced: 0,
    };
    await db.typologyPrices.put(updatedPrice);
    await enqueueTypologyPriceSync('UPDATE', updatedPrice);
    return;
  }

  const createdPrice: TypologyPrice = {
    id: generateId(),
    projectId,
    category,
    attraversamento,
    tipologicoId,
    pricePerUnit,
    unit,
    createdAt: timestamp,
    updatedAt: timestamp,
    synced: 0,
  };

  await db.typologyPrices.add(createdPrice);
  await enqueueTypologyPriceSync('CREATE', createdPrice);
}

export async function deleteTypologyPrice(id: string): Promise<void> {
  const existing = await db.typologyPrices.get(id);
  if (!existing) {
    return;
  }

  await db.typologyPrices.delete(id);
  await enqueueTypologyPriceSync('DELETE', existing);
}

async function enqueueTypologyPriceSync(
  operation: SyncQueueItem['operation'],
  price: TypologyPrice
): Promise<void> {
  const syncItem: SyncQueueItem = {
    id: generateId(),
    operation,
    entityType: 'typology_price',
    entityId: price.id,
    payload: price,
    timestamp: now(),
    retryCount: 0,
    synced: 0,
  };

  await db.syncQueue.add(syncItem);
  triggerImmediateUpload();
}
