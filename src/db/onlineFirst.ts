/**
 * @file onlineFirst.ts
 * @description Utility condivise per il pattern Online-First con fallback IndexedDB.
 *
 * Ogni lettura verifica prima la connessione; se online chiama Supabase direttamente,
 * aggiorna la cache IndexedDB (write-through), sovrappone le scritture locali pendenti
 * dalla sync queue, e restituisce il risultato merged. In caso di errore di rete
 * cade in fallback su IndexedDB. Gli errori 401/403 vengono rilanciati (richiedono re-auth).
 */

import { db, SyncQueueItem } from './database';
import { isSupabaseConfigured } from '../lib/supabase';

// ─── Helpers pubblici ────────────────────────────────────────────────────────

/**
 * True se il browser è online E Supabase è configurato (URL + key presenti).
 * navigator.onLine può dare falsi positivi su reti captive, ma il try/catch
 * in ogni funzione garantisce il fallback corretto.
 */
export function isOnlineAndConfigured(): boolean {
  return navigator.onLine && isSupabaseConfigured();
}

/**
 * Ritorna il Set degli entityId che hanno scritture pendenti nella sync queue
 * (synced=0) per il tipo di entità specificato.
 *
 * @param entityType  Tipo entità Dexie (es. 'mapping_entry', 'project')
 * @param filter      Filtro opzionale per restringere ai soli item rilevanti
 *                    (es. appartenenti a un certo progetto)
 */
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

/**
 * Applica le scritture locali pendenti (sync queue, synced=0) come overlay
 * sui dati remoti appena letti da Supabase.
 *
 * - CREATE / UPDATE → aggiunge o sostituisce nel result set
 * - DELETE         → rimuove dal result set
 *
 * Gli item vengono applicati in ordine di timestamp per rispettare la sequenza
 * delle operazioni dell'utente.
 *
 * @param remoteItems  Risultato convertito da Supabase
 * @param entityType   Tipo entità per filtrare la sync queue
 * @param filter       Filtro per restringere ai soli item rilevanti per questo scope
 */
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

  const relevant = pending.filter(filter);
  if (relevant.length === 0) return remoteItems;

  // Ordina per timestamp ASC per applicare le operazioni nell'ordine corretto
  relevant.sort((a, b) => a.timestamp - b.timestamp);

  const resultMap = new Map<string, T>(remoteItems.map((item) => [item.id, item]));

  for (const pendingItem of relevant) {
    switch (pendingItem.operation) {
      case 'CREATE':
      case 'UPDATE':
        resultMap.set(pendingItem.entityId, pendingItem.payload as T);
        break;
      case 'DELETE':
        resultMap.delete(pendingItem.entityId);
        break;
    }
  }

  return Array.from(resultMap.values());
}

/**
 * Write-through cache: aggiorna IndexedDB con i dati freschi letti da Supabase.
 *
 * Salta le entry che hanno scritture pendenti (pendingIds) per non sovrascrivere
 * modifiche locali non ancora sincronizzate.
 *
 * Se viene fornita una funzione `mergeLocalFields`, questa viene chiamata con
 * (remoteItem, existingLocalItem) per preservare i campi che esistono solo
 * localmente (es. syncEnabled, gridConfig, eiRating).
 *
 * @param remoteItems      Item convertiti da formato Supabase a formato locale
 * @param pendingIds       Set degli id con scritture pendenti (da saltare)
 * @param table            Tabella Dexie su cui salvare
 * @param mergeLocalFields Funzione opzionale per preservare campi local-only
 */
export async function writeThroughCache<T extends { id: string }>(
  remoteItems: T[],
  pendingIds: Set<string>,
  table: any,
  mergeLocalFields?: (remote: T, existing: T | undefined) => T
): Promise<T[]> {
  const mergedItems: T[] = [];

  for (const remoteItem of remoteItems) {
    let itemToSave = remoteItem;

    if (mergeLocalFields) {
      // Leggi il record locale (se esiste) per preservare i campi local-only
      const existing: T | undefined = await table.get(remoteItem.id);
      itemToSave = mergeLocalFields(remoteItem, existing);
    }

    mergedItems.push(itemToSave);

    // Non sovrascrivere record con scritture locali pendenti
    if (!pendingIds.has(remoteItem.id)) {
      await table.put(itemToSave);
    }
  }

  return mergedItems;
}

/**
 * Controlla se un errore Supabase è dovuto a mancata autenticazione (401/403).
 * In questo caso NON si fa fallback su IndexedDB — l'errore viene rilanciato
 * affinché il chiamante possa gestire la re-autenticazione.
 */
export function isAuthError(err: any): boolean {
  // Supabase restituisce status 401 o codice PGRST301 per JWT scaduto
  return (
    err?.status === 401 ||
    err?.status === 403 ||
    err?.code === 'PGRST301' ||
    err?.message?.includes('JWT')
  );
}
