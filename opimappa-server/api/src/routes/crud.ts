import type { Context } from 'hono';
import { randomUUID } from 'crypto';
import type { Variables } from '../auth/middleware.js';
import { TABLE_SCHEMA, getWritableColumns } from '../query/schema.js';
import { executeQuery, addFilter, addParam, quoteIdent, type WhereBuild } from '../query/builder.js';
import { httpError, parseQuery, parseFilters } from '../query/parser.js';
import { addScope } from '../query/scope.js';
export { addScope };
import { sql } from '../db/client.js';

type AppContext = Context<{ Variables: Variables }>;
type SqlExecutor = Pick<typeof sql, 'unsafe'>;

function isHttpError(error: unknown): error is { status: number; message: string } {
  return typeof error === 'object' && error !== null && 'status' in error && typeof (error as { status?: unknown }).status === 'number';
}

// I parametri bind per colonne JSONB devono essere serializzati: postgres.js,
// in una query .unsafe() dinamica, non conosce il tipo di colonna e proverebbe a
// codificare un array/oggetto JS come array Postgres → TypeError
// (ERR_INVALID_ARG_TYPE: Received an instance of Array) e quindi 500.
// Passando una stringa JSON, Postgres la castta implicitamente a jsonb (tipo della colonna).
function toBindValues(tableName: string, body: Record<string, unknown>): unknown[] {
  const colTypes = getWritableColumns(tableName) ?? {};
  return Object.entries(body).map(([col, value]) => {
    if (colTypes[col] === 'jsonb' && value !== null && value !== undefined && typeof value !== 'string') {
      return JSON.stringify(value);
    }
    return value;
  });
}

function scopedWhere(tableName: string, params: URLSearchParams, userId: string, role: string): { sqlText: string; values: unknown[] } {
  const plan = parseQuery(tableName, params);
  const clauses: string[] = [];
  const values: unknown[] = [];
  addScope(tableName, userId, role, clauses, values);
  const build: WhereBuild = { clauses, values };
  for (const filter of plan.filters) addFilter(filter, build);
  return { sqlText: clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '', values };
}

function sanitizeBody(tableName: string, input: Record<string, unknown>): Record<string, unknown> {
  const table = TABLE_SCHEMA[tableName];
  if (!table) httpError(400, 'unknown table: ' + tableName);

  // Usa solo le colonne scrivibili — esclude readOnly (es. *_storage_path)
  const writableCols = getWritableColumns(tableName)!;
  const now = new Date().toISOString();
  const body = { ...input, id: input.id ?? randomUUID(), created_at: now, updated_at: now };
  return Object.fromEntries(Object.entries(body).filter(([key]) => key in writableCols));
}

function sanitizePatchBody(tableName: string, input: Record<string, unknown>): Record<string, unknown> {
  const table = TABLE_SCHEMA[tableName];
  if (!table) httpError(400, 'unknown table: ' + tableName);

  // Usa solo le colonne scrivibili — esclude readOnly (es. *_storage_path)
  const writableCols = getWritableColumns(tableName)!;
  const body = { ...input, updated_at: new Date().toISOString() };
  return Object.fromEntries(Object.entries(body).filter(([key]) => key in writableCols && key !== 'id'));
}

function hasSelectiveIdFilter(filters: ReturnType<typeof parseFilters>): boolean {
  return filters.some((filter) => {
    if (filter.type !== 'direct' || filter.col !== 'id') return false;
    if (filter.op === 'eq') return filter.value.trim() !== '';
    if (filter.op !== 'in') return false;

    const rawList = filter.value.trim();
    const list = rawList.startsWith('(') && rawList.endsWith(')')
      ? rawList.slice(1, -1)
      : rawList;
    // Solo una lista id non vuota rende sicura una mutazione bulk.
    return list.split(',').some((value) => value.trim() !== '');
  });
}

async function ensureScopedMutationAllowed(tableName: string, body: Record<string, unknown>, userId: string, role: string): Promise<void> {
  if (role === 'admin') return;

  const hasScopedRow = async (targetTable: string, id: unknown): Promise<boolean> => {
    if (typeof id !== 'string' || id.trim() === '') return false;
    const params = new URLSearchParams({ id: `eq.${id}` });
    const scoped = scopedWhere(targetTable, params, userId, role);
    const rows = await sql.unsafe(
      `SELECT 1 FROM ${quoteIdent(targetTable)}${scoped.sqlText} LIMIT 1`,
      scoped.values as unknown[] as any[],
    );
    return rows.length > 0;
  };

  const hasAccessibleProject = async (projectId: unknown): Promise<boolean> => {
    if (typeof projectId !== 'string' || projectId.trim() === '') return false;
    return hasScopedRow('projects', projectId);
  };

  // Tabelle con project_id diretto: il progetto target deve essere nello scope utente.
  if (
    ['mapping_entries', 'structure_entries', 'floor_plans', 'sals', 'typology_prices'].includes(tableName) &&
    !(await hasAccessibleProject(body.project_id))
  ) {
    httpError(403, 'forbidden');
  }

  // Photos: valida il parent mapping/structure indicato prima di creare metadata storage.
  if (tableName === 'photos') {
    if (body.mapping_entry_id == null && body.structure_entry_id == null) httpError(403, 'forbidden');
    const mappingAllowed = body.mapping_entry_id == null || await hasScopedRow('mapping_entries', body.mapping_entry_id);
    const structureAllowed = body.structure_entry_id == null || await hasScopedRow('structure_entries', body.structure_entry_id);
    if (!mappingAllowed || !structureAllowed) httpError(403, 'forbidden');
  }

  // Punti planimetria: ogni FK presente deve puntare a una riga nello scope.
  if (tableName === 'floor_plan_points') {
    const floorPlanAllowed = await hasScopedRow('floor_plans', body.floor_plan_id);
    const mappingAllowed = body.mapping_entry_id == null || await hasScopedRow('mapping_entries', body.mapping_entry_id);
    const structureAllowed = body.structure_entry_id == null || await hasScopedRow('structure_entries', body.structure_entry_id);
    if (!floorPlanAllowed || !mappingAllowed || !structureAllowed) httpError(403, 'forbidden');
  }
}

function handleError(c: AppContext, tableName: string, error: unknown) {
  if (isHttpError(error) && error.status < 500) {
    return c.json({ error: error.message }, error.status as 400);
  }
  console.error(`[crud:${tableName}]`, error);
  return c.json({ error: 'internal server error' }, 500);
}

// B3 — Ogni mutazione DB DEVE passare da qui: imposta opimappa.originator_session
// nella transazione così il trigger su change_log valorizza `originator`. Senza,
// la riga avrebbe originator NULL → l'echo non viene soppresso e il client che ha
// fatto la modifica la vede "rimbalzare" via SSE. Il guard sotto fallisce in modo
// rumoroso se una route monta un handler mutante senza requireUser (sessionId
// assente), invece di scrivere silenziosamente un originator vuoto.
async function withOriginatorTransaction(c: AppContext, work: (tx: SqlExecutor) => Promise<unknown>): Promise<unknown> {
  const sessionId = c.get('sessionId');
  if (!sessionId) {
    throw new Error('withOriginatorTransaction: sessionId mancante (requireUser non applicato?)');
  }
  return sql.begin(async (tx) => {
    // Equivalente transazionale di SET LOCAL, con valore parametrizzato.
    await tx`SELECT set_config('opimappa.originator_session', ${sessionId}, true)`;
    return work(tx);
  });
}

export function createCrudHandler(tableName: string) {
  const table = TABLE_SCHEMA[tableName];
  if (!table) httpError(400, 'unknown table: ' + tableName);

  return {
    get: async (c: AppContext) => {
      try {
        const params = new URL(c.req.url).searchParams;
        const plan = parseQuery(tableName, params);
        const user = c.get('user');
        const { rows, totalCount } = await executeQuery(tableName, plan, user.id, user.role ?? 'user');
        c.header('X-Server-Seen-Seq', '0');
        return c.json({ data: rows, error: null, count: totalCount });
      } catch (error) {
        return handleError(c, tableName, error);
      }
    },
    post: async (c: AppContext) => {
      try {
        const user = c.get('user');
        const rawBody = (await c.req.json()) as Record<string, unknown>;
        // Fix sicurezza: forza sempre owner_id/user_id all'utente autenticato
        if (tableName === 'projects' || 'owner_id' in rawBody) {
          rawBody.owner_id = user.id;
        }
        if (tableName === 'standalone_maps' || 'user_id' in rawBody) {
          rawBody.user_id = user.id;
        }
        const body = sanitizeBody(tableName, rawBody);
        await ensureScopedMutationAllowed(tableName, body, user.id, user.role ?? 'user');
        const cols = Object.keys(body);
        const values = toBindValues(tableName, body);
        const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');
        const result = await withOriginatorTransaction(c, (tx) =>
          tx.unsafe(`INSERT INTO ${quoteIdent(tableName)} (${cols.map(quoteIdent).join(', ')}) VALUES (${placeholders}) RETURNING *`, values as unknown[] as any[])
        ) as unknown[];
        return c.json({ data: [result[0]], error: null }, 201);
      } catch (error) {
        return handleError(c, tableName, error);
      }
    },
    patch: async (c: AppContext) => {
      try {
        const user = c.get('user');
        const body = sanitizePatchBody(tableName, (await c.req.json()) as Record<string, unknown>);
        const values = toBindValues(tableName, body);
        const sets = Object.keys(body).map((col, index) => `${quoteIdent(col)} = $${index + 1}`);
        if (sets.length === 0) httpError(400, 'empty body');

        const urlParams = new URL(c.req.url).searchParams;
        // Fix sicurezza: PATCH richiede id=eq.* oppure id=in.*; filtri larghi non bastano.
        const schema = TABLE_SCHEMA[tableName];
        const clientFilters = parseFilters(urlParams, schema!);
        if (!hasSelectiveIdFilter(clientFilters)) {
          return c.json({ data: null, error: 'PATCH requires a selective id filter (id=eq.xxx or id=in.xxx,yyy)' }, 400);
        }

        const scoped = scopedWhere(tableName, urlParams, user.id, user.role ?? 'user');
        const result = await withOriginatorTransaction(c, (tx) =>
          tx.unsafe(
            `UPDATE ${quoteIdent(tableName)} SET ${sets.join(', ')}${scoped.sqlText.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + values.length}`)} RETURNING *`,
            [...values, ...scoped.values] as unknown[] as any[],
          )
        ) as unknown[];
        return c.json({ data: result as unknown[], error: null });
      } catch (error) {
        return handleError(c, tableName, error);
      }
    },
    delete: async (c: AppContext) => {
      try {
        const user = c.get('user');
        const urlParams = new URL(c.req.url).searchParams;
        // Fix sicurezza: DELETE richiede id=eq.* oppure id=in.*; filtri larghi non bastano.
        const schema = TABLE_SCHEMA[tableName];
        const clientFilters = parseFilters(urlParams, schema!);
        if (!hasSelectiveIdFilter(clientFilters)) {
          return c.json({ data: null, error: 'DELETE requires a selective id filter (id=eq.xxx or id=in.xxx,yyy)' }, 400);
        }
        const scoped = scopedWhere(tableName, urlParams, user.id, user.role ?? 'user');
        await withOriginatorTransaction(c, (tx) =>
          tx.unsafe(`DELETE FROM ${quoteIdent(tableName)}${scoped.sqlText} RETURNING *`, scoped.values as unknown[] as any[])
        );
        return c.json({ data: null, error: null }, 200);
      } catch (error) {
        return handleError(c, tableName, error);
      }
    },
    put: async (c: AppContext) => {
      try {
        const user = c.get('user');
        const rawBody = (await c.req.json()) as Record<string, unknown>;
        if (!rawBody.id) return c.json({ error: 'id required for upsert' }, 400);

        // Determina se è un INSERT puro (riga non esistente) o un UPDATE.
        // Il check di esistenza viene sempre eseguito, indipendentemente dal ruolo.
        let isInsert = true;
        const existsCheck = await sql.unsafe(
          `SELECT * FROM ${quoteIdent(tableName)} WHERE id = $1`,
          [rawBody.id] as any[]
        ) as Record<string, unknown>[];
        const existingRow = existsCheck[0];
        if (existingRow) {
          isInsert = false;
        }

        // Pre-check autorizzazione: solo per non-admin.
        // Se la riga esiste e non appartiene all'utente → 403 prima di scrivere.
        if (!isInsert && user.role !== 'admin') {
          const ownerCheck = scopedWhere(
            tableName,
            new URLSearchParams({ id: `eq.${rawBody.id}` }),
            user.id,
            user.role ?? 'user'
          );
          const owned = await sql.unsafe(
            `SELECT 1 FROM ${quoteIdent(tableName)}${ownerCheck.sqlText}`,
            ownerCheck.values as unknown[] as any[]
          );
          if (owned.length === 0) return c.json({ error: 'forbidden' }, 403);
        }

        // Fix sicurezza: forza owner_id/user_id solo su INSERT puro.
        // Su UPDATE non sovrascrivere: un collaboratore non deve diventare owner.
        if (isInsert) {
          if (tableName === 'projects' || 'owner_id' in rawBody) rawBody.owner_id = user.id;
          if (tableName === 'standalone_maps' || 'user_id' in rawBody) rawBody.user_id = user.id;
        } else if (existingRow) {
          // Su UPDATE l'upsert costruisce comunque una tuple INSERT che deve rispettare
          // i NOT NULL (es. projects.owner_id), anche se ON CONFLICT poi fa UPDATE.
          // Un client che invia owner_id/user_id null O che li OMETTE del tutto
          // (es. payload project UPDATE in syncUploadHandlers) causerebbe un 500.
          // Backfill dal valore esistente: l'ownership NON cambia mai (esclusa da updateSet).
          if (!('owner_id' in rawBody) || rawBody.owner_id == null) rawBody.owner_id = existingRow.owner_id;
          if (!('user_id' in rawBody) || rawBody.user_id == null) rawBody.user_id = existingRow.user_id;
        }

        const body = sanitizeBody(tableName, rawBody);
        await ensureScopedMutationAllowed(tableName, body, user.id, user.role ?? 'user');
        const cols = Object.keys(body);
        const values = toBindValues(tableName, body);
        const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
        const updateSet = cols
          .filter(col => col !== 'id' && col !== 'created_at' && col !== 'owner_id' && col !== 'user_id')
          .map(col => `${quoteIdent(col)} = EXCLUDED.${quoteIdent(col)}`)
          .join(', ');
        const result = await withOriginatorTransaction(c, (tx) =>
          tx.unsafe(
            `INSERT INTO ${quoteIdent(tableName)} (${cols.map(quoteIdent).join(', ')})
             VALUES (${placeholders})
             ON CONFLICT (id) DO UPDATE SET ${updateSet}
             RETURNING *`,
            values as unknown[] as any[]
          )
        ) as unknown[];
        return c.json({ data: [result[0]], error: null }, 200);
      } catch (error) {
        return handleError(c, tableName, error);
      }
    },
  };
}
