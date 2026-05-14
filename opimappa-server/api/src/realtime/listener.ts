// api/src/realtime/listener.ts
// Listener PostgreSQL LISTEN/NOTIFY per change_log
// Fix C1: rimozione snapshot currentDrained — uso diretto di lastDrainedSeq
// Fix C2: guard draining + drainTarget per prevenire chiamate concorrenti
// Fix C3: onclose passato come opzione costruttore (non patch post-costruzione)

import postgres from 'postgres';
import pino from 'pino';
import { sql } from '../db/client.js';

const logger = pino();

export interface ChangeLogRow {
  seq: bigint;
  table_name: string;
  row_id: string;
  op: 'INSERT' | 'UPDATE' | 'DELETE';
  project_id: string | null;
  user_id: string | null;
  originator: string | null;
}

type RowSubscriber = (rows: ChangeLogRow[]) => Promise<void>;
type SystemMessage = { type: 'reconnected'; seq?: string } | { type: 'connection_lost' };
type SystemSubscriber = (msg: SystemMessage) => void;

// Cursori interni
let lastDrainedSeq: bigint = 0n;
export let lastNotifiedSeq: bigint = 0n;

// Sottoscrittori applicativi
const subscribers: Set<RowSubscriber> = new Set();
const systemSubscribers: Set<SystemSubscriber> = new Set();

/** Sottoscrivi a eventi change_log. Ritorna funzione di unsub. */
export function subscribe(fn: RowSubscriber): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

/** Sottoscrivi a eventi di sistema (reconnected / connection_lost). */
export function subscribeSystem(fn: SystemSubscriber): () => void {
  systemSubscribers.add(fn);
  return () => systemSubscribers.delete(fn);
}

function broadcastSystem(msg: SystemMessage): void {
  for (const fn of systemSubscribers) {
    try { fn(msg); } catch {}
  }
}

async function dispatchRows(rawRows: unknown[]): Promise<void> {
  if (rawRows.length === 0) return;
  const rows: ChangeLogRow[] = (rawRows as Record<string, unknown>[]).map((r) => ({
    seq: BigInt(r['seq'] as string | number),
    table_name: r['table_name'] as string,
    row_id: r['row_id'] as string,
    op: r['op'] as ChangeLogRow['op'],
    project_id: (r['project_id'] as string | null) ?? null,
    user_id: (r['user_id'] as string | null) ?? null,
    originator: (r['originator'] as string | null) ?? null,
  }));

  for (const fn of subscribers) {
    try { await fn(rows); } catch (e) { logger.warn({ err: e }, 'subscriber error'); }
  }
}

// Fix C2: guard per serializzare chiamate concorrenti a drainUntil
let draining = false;
let drainTarget = 0n;

// Fix C1 + C2: drainUntil con guard coalescing — nessun snapshot di lastDrainedSeq prima del loop
async function drainUntil(targetSeq: bigint): Promise<void> {
  if (targetSeq > drainTarget) drainTarget = targetSeq;
  if (draining) return; // un drain è già in volo e raccoglierà drainTarget aggiornato
  draining = true;
  try {
    while (lastDrainedSeq < drainTarget) {
      const target = drainTarget; // snapshot DENTRO il loop per stabilità del batch corrente
      const rows = await sql`
        SELECT seq, table_name, row_id, op, project_id, user_id, originator
        FROM change_log
        WHERE seq > ${lastDrainedSeq.toString()} AND seq <= ${target.toString()}
        ORDER BY seq ASC
        LIMIT 1000
      `;
      if (rows.length === 0) break;

      await dispatchRows(rows);
      lastDrainedSeq = BigInt((rows[rows.length - 1] as Record<string, unknown>)['seq'] as string | number);
    }
  } finally {
    draining = false;
    // Se un nuovo target è arrivato durante il drain, rientra una volta
    if (lastDrainedSeq < drainTarget) {
      void drainUntil(drainTarget);
    }
  }
}

// Fix C3: onclose passato come opzione costruttore — postgres.js legge le opzioni al momento
//         della connessione, non dopo. Il patching post-costruzione non funziona.
async function startListener(): Promise<void> {
  while (true) {
    let resolveClose!: () => void;
    const closePromise = new Promise<void>((r) => { resolveClose = r; });

    const databaseUrl = process.env['DATABASE_URL'];
    if (!databaseUrl) {
      logger.error('DATABASE_URL mancante');
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }

    const listenSql = postgres(databaseUrl, {
      max: 1,
      idle_timeout: 0,
      onclose: () => resolveClose(), // opzione costruttore valida in postgres.js
    });

    try {
      await listenSql.listen('opimappa_changes', async (raw: string) => {
        const seq = BigInt(raw);
        if (seq <= lastNotifiedSeq) return;
        lastNotifiedSeq = seq;
        await drainUntil(seq);
      });

      // Su reconnect: drain gap accumulato durante outage
      // Eseguito DOPO listen() per evitare eventi mancati
      const reconnectRows = await sql`
        SELECT COALESCE(max(seq), 0)::bigint AS max_seq FROM change_log
      `;
      const currentMax = BigInt((reconnectRows[0] as Record<string, unknown>)['max_seq'] as string | number);
      if (currentMax > lastDrainedSeq) {
        if (currentMax > lastNotifiedSeq) lastNotifiedSeq = currentMax;
        await drainUntil(currentMax);
      }

      broadcastSystem({ type: 'reconnected', seq: lastNotifiedSeq.toString() });
      logger.info({ seq: lastNotifiedSeq.toString() }, 'pg LISTEN attivo');

      // Attendi finché onclose scatta (connessione caduta)
      await closePromise;
    } catch (e) {
      logger.error({ err: e }, 'pg LISTEN errore');
    } finally {
      try { await listenSql.end({ timeout: 1 }); } catch {}
      broadcastSystem({ type: 'connection_lost' });
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

/** Inizializza il listener. Chiamare una sola volta all'avvio. */
export async function initListener(): Promise<void> {
  // Inizializza cursori da max(seq) reale, non da 0
  const initRows = await sql`
    SELECT COALESCE(max(seq), 0)::bigint AS max_seq FROM change_log
  `;
  const startSeq = BigInt((initRows[0] as Record<string, unknown>)['max_seq'] as string | number);
  lastDrainedSeq = startSeq;
  lastNotifiedSeq = startSeq;
  drainTarget = startSeq; // allinea drainTarget al cursore iniziale
  logger.info({ startSeq: startSeq.toString() }, 'listener init');

  // Avvia loop in background (non awaitable)
  startListener().catch((err) => logger.error({ err }, 'startListener crash'));
}
