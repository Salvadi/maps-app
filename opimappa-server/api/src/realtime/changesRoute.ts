// api/src/realtime/changesRoute.ts
// Endpoint REST per change_log
// Fix C3+C4+H2: GET /api/changes e GET /api/changes/head

import { Hono } from 'hono';
import { sql } from '../db/client.js';
import { lastNotifiedSeq, type ChangeLogRow } from './listener.js';
import type { Variables } from '../auth/middleware.js';

const app = new Hono<{ Variables: Variables }>();

/**
 * Verifica visibilità riga per l'utente dato.
 * - project_id NULL → visibile a tutti
 * - project_id non-null → owner OR collaboratore in accessible_users
 */
async function canSee(userId: string, row: ChangeLogRow): Promise<boolean> {
  if (row.project_id === null) return true;

  const rows = await sql`
    SELECT id FROM projects
    WHERE id = ${row.project_id}
      AND (
        owner_id = ${userId}
        OR (accessible_users)::jsonb ? ${userId}
      )
    LIMIT 1
  `;
  return rows.length > 0;
}

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
  const userId = (c.get('user') as { id: string }).id;

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

    if (await canSee(userId, row)) {
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
