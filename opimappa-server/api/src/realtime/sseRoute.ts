// api/src/realtime/sseRoute.ts
// Endpoint SSE GET /api/events/stream
// Fix M5: max 5 SSE per session con eviction oldest
// Fix H3: echo suppression — righe originate da questo session non inviate
// Fix M2: cleanup() nel catch di send() per evitare timer leak
// Fix M3: eviction chiama cleanup del tab rimosso per de-registrare subscriber

import { Hono } from 'hono';
import { subscribe, subscribeSystem, lastNotifiedSeq, type ChangeLogRow } from './listener.js';
import type { Variables } from '../auth/middleware.js';
import { sql } from '../db/client.js';
import { canSee } from './visibility.js';

const MAX_SSE_PER_SESSION = 5;

// Map: chiave `${sessionId}:${tabId}` → funzione send
const subscribers = new Map<string, (data: string) => void>();

// Fix M3: Map parallela con le funzioni cleanup per ogni tab (usata per eviction)
const subscriberCleanups = new Map<string, () => void>();

const app = new Hono<{ Variables: Variables }>();

app.get('/events/stream', async (c) => {
  const sessionId = c.get('sessionId') as string;
  const user = c.get('user') as { id: string; role?: string | null };
  const userId = user.id;
  const tabId = c.req.query('tabId') ?? crypto.randomUUID();
  const sinceSeqRaw = c.req.query('sinceSeq') ?? '0';
  const sinceSeq = BigInt(sinceSeqRaw);

  const key = `${sessionId}:${tabId}`;

  // Eviction: se raggiungiamo MAX_SSE_PER_SESSION, rimuovi il più vecchio
  // Fix M3: invia evicted PRIMA del cleanup, poi chiama cleanup del tab rimosso
  const sessionKeys = Array.from(subscribers.keys()).filter((k) => k.startsWith(sessionId + ':'));
  if (sessionKeys.length >= MAX_SSE_PER_SESSION) {
    const oldestKey = sessionKeys[0]!;
    const oldestSend = subscribers.get(oldestKey);
    if (oldestSend) {
      // Invia il messaggio di eviction prima di chiudere lo stream
      oldestSend(`data: ${JSON.stringify({ system: true, type: 'evicted' })}\n\n`);
    }
    // Chiama cleanup del tab rimosso per de-registrare i subscriber e liberare il timer
    const evictedCleanup = subscriberCleanups.get(oldestKey);
    if (evictedCleanup) evictedCleanup();
  }

  // Prepara lo stream SSE
  const { readable, writable } = new TransformStream<string, string>();
  const writer = writable.getWriter();

  let closed = false;

  // Fix M2: send() chiama cleanup() invece di impostare solo closed=true
  //         così il timer heartbeat e i subscriber vengono sempre rimossi
  const send = (data: string): void => {
    if (closed) return;
    writer.write(data).catch(() => { cleanup(); });
  };

  subscribers.set(key, send);

  // Heartbeat ogni 30s
  const heartbeatTimer = setInterval(() => {
    send(': heartbeat\n\n');
  }, 30_000);

  // Cleanup quando il client si disconnette (idempotente)
  const cleanup = (): void => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeatTimer);
    unsubRows();
    unsubSystem();
    subscribers.delete(key);
    subscriberCleanups.delete(key); // Fix M3: rimuovi anche dalla map dei cleanup
    writer.close().catch(() => {});
  };

  // Fix M3: registra la funzione cleanup nella map parallela
  subscriberCleanups.set(key, cleanup);

  // Sottoscrizione a eventi sistema (reconnected / connection_lost)
  const unsubSystem = subscribeSystem((msg) => {
    send(`data: ${JSON.stringify({ system: true, ...msg })}\n\n`);
  });

  // Sottoscrizione a righe nuove
  // Fix H3: echo suppression — salta righe originate da questo session
  const unsubRows = subscribe(async (rows: ChangeLogRow[]) => {
    for (const row of rows) {
      // Sopprimi eco: non inviare righe originate da questa sessione
      if (row.originator !== null && row.originator === sessionId) continue;
      if (await canSee(userId, user.role, row)) {
        send(`data: ${JSON.stringify({ ...row, seq: row.seq.toString() })}\n\n`);
      }
    }
  });

  // Replay iniziale: righe dal sinceSeq al corrente
  (async () => {
    try {
      const replayRows = await sql`
        SELECT seq, table_name, row_id, op, project_id, user_id, originator
        FROM change_log
        WHERE seq > ${sinceSeq.toString()}
        ORDER BY seq ASC
        LIMIT 10000
      `;
      for (const raw of replayRows) {
        const row: ChangeLogRow = {
          seq: BigInt((raw as Record<string, unknown>)['seq'] as string | number),
          table_name: (raw as Record<string, unknown>)['table_name'] as string,
          row_id: (raw as Record<string, unknown>)['row_id'] as string,
          op: (raw as Record<string, unknown>)['op'] as ChangeLogRow['op'],
          project_id: ((raw as Record<string, unknown>)['project_id'] as string | null) ?? null,
          user_id: ((raw as Record<string, unknown>)['user_id'] as string | null) ?? null,
          originator: ((raw as Record<string, unknown>)['originator'] as string | null) ?? null,
        };
        if (row.originator !== null && row.originator === sessionId) continue;
        if (await canSee(userId, user.role, row)) {
          send(`data: ${JSON.stringify({ ...row, seq: row.seq.toString() })}\n\n`);
        }
      }
    } catch {}
  })();

  // Gestisci chiusura client (best-effort: Hono node-server)
  c.req.raw.signal?.addEventListener('abort', cleanup);

  const encoder = new TextEncoder();
  const encodedStream = new ReadableStream({
    start(controller) {
      const reader = readable.getReader();
      const pump = (): Promise<void> =>
        reader.read().then(({ done, value }) => {
          if (done) { controller.close(); cleanup(); return; }
          controller.enqueue(encoder.encode(value));
          return pump();
        }).catch(() => { controller.close(); cleanup(); });
      return pump();
    }
  });

  return new Response(encodedStream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
      'X-Server-Seen-Seq': lastNotifiedSeq.toString(),
    },
  });
});

export default app;
