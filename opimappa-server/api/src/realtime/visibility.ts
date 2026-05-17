import { sql } from '../db/client.js';
import { GLOBAL_TABLES } from '../query/schema.js';
import type { ChangeLogRow } from './listener.js';

/**
 * Verifica visibilita di una riga change_log per l'utente dato.
 */
export async function canSee(userId: string, role: string | undefined | null, row: ChangeLogRow): Promise<boolean> {
  if (role === 'admin') return true;

  if (row.project_id === null) {
    if (row.user_id === null) {
      // Tabelle globali (dropdown_options, products): visibili a tutti gli utenti autenticati.
      if (GLOBAL_TABLES.has(row.table_name)) return true;
      // Righe orfane da cascade delete / non user-scoped: solo admin.
      // Gli utenti normali si riallineano con prune/full sync.
      return false;
    }
    return row.user_id === userId;
  }

  if (row.table_name === 'projects' && row.op === 'DELETE') {
    // Il progetto e gia stato eliminato: il trigger salva owner_id in user_id.
    // I collaboratori si riallineano con prune/full sync, senza query live al progetto sparito.
    return row.user_id === userId;
  }

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
