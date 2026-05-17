// api/src/realtime/changesRoute.ts
// Endpoint REST per change_log
// Fix C3+C4+H2: GET /api/changes e GET /api/changes/head

import { Hono } from 'hono';
import { sql } from '../db/client.js';
import { lastNotifiedSeq, type ChangeLogRow } from './listener.js';
import type { Variables } from '../auth/middleware.js';
import { canSee } from './visibility.js';

const app = new Hono<{ Variables: Variables }>();

// GET /api/changes?sinceSeq=<n>
app.get('/changes', async (c) => {
  const sinceSeqRaw = c.req.query('sinceSeq') ?? '0';
  let sinceSeq: bigint;
  try {
    sinceSeq = BigInt(sinceSeqRaw);
  } catch {
    return c.json({ data: null, error: 'invalid sinceSeq', fullResyncRequired: false, currentSeq: lastNotifiedSeq.toString() }, 400);
  }

  const sessionId = c.get('sessionId') as string;
  const user = c.get('user') as { id: string; role?: string | null };
  const userId = user.id;

  // H2: cursor expired — controlla se sinceSeq è scaduto
  if (sinceSeq > 0n) {
    const minRows = await sql`
      SELECT COALESCE(min(seq), 0)::bigint AS min_seq FROM change_log
    `;
    const minSeq = BigInt((minRows[0] as Record<string, unknown>)['min_seq'] as string | number);

    if (sinceSeq < minSeq) {
      return c.json(
        {
          data: null,
          error: 'cursor_expired',
          fullResyncRequired: true,
          currentSeq: lastNotifiedSeq.toString(),
        },
        410,
        { 'X-Server-Seen-Seq': lastNotifiedSeq.toString() }
      );
    }
  }

  const rawRows = await sql`
    SELECT seq, table_name, row_id, op, project_id, user_id, originator
    FROM change_log
    WHERE seq > ${sinceSeq.toString()}
    ORDER BY seq ASC
    LIMIT 10000
  `;

  const filtered: Record<string, unknown>[] = [];
  for (const raw of rawRows) {
    const r = raw as Record<string, unknown>;
    const row: ChangeLogRow = {
      seq: BigInt(r['seq'] as string | number),
      table_name: r['table_name'] as string,
      row_id: r['row_id'] as string,
      op: r['op'] as ChangeLogRow['op'],
      project_id: (r['project_id'] as string | null) ?? null,
      user_id: (r['user_id'] as string | null) ?? null,
      originator: (r['originator'] as string | null) ?? null,
    };

    // Soppressione echo: filtra righe con originator == sessionId corrente
    if (row.originator === sessionId) continue;

    if (await canSee(userId, user.role, row)) {
      filtered.push({ ...row, seq: row.seq.toString() });
    }
  }

  return c.json(
    { data: filtered, currentSeq: lastNotifiedSeq.toString(), error: null },
    200,
    { 'X-Server-Seen-Seq': lastNotifiedSeq.toString() }
  );
});

// GET /api/changes/head
app.get('/changes/head', async (c) => {
  return c.json(
    { currentSeq: lastNotifiedSeq.toString() },
    200,
    { 'X-Server-Seen-Seq': lastNotifiedSeq.toString() }
  );
});

export default app;
