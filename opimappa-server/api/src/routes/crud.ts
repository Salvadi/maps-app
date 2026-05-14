import type { Context } from 'hono';
import { randomUUID } from 'crypto';
import type { Variables } from '../auth/middleware.js';
import { TABLE_SCHEMA, getWritableColumns } from '../query/schema.js';
import { executeQuery } from '../query/builder.js';
import { httpError, parseQuery, parseFilters, type FilterClause } from '../query/parser.js';
export { addScope } from '../query/scope.js';
import { sql } from '../db/client.js';

type AppContext = Context<{ Variables: Variables }>;

function isHttpError(error: unknown): error is { status: number; message: string } {
  return typeof error === 'object' && error !== null && 'status' in error && typeof (error as { status?: unknown }).status === 'number';
}

function quoteIdent(identifier: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(identifier)) httpError(400, 'invalid identifier: ' + identifier);
  return `"${identifier}"`;
}

function addParam(values: unknown[], value: unknown): string {
  values.push(value);
  return `$${values.length}`;
}

function addFilter(filter: FilterClause, clauses: string[], values: unknown[]): void {
  if (filter.type === 'join_filter') return;
  const col = quoteIdent(filter.col);

  if (filter.op === 'in') {
    const placeholders = filter.value.split(',').map((part) => addParam(values, part.trim())).join(', ');
    clauses.push(`${col} = ANY(ARRAY[${placeholders}])`);
    return;
  }

  if (filter.op === 'is') {
    const valLower = filter.value.toLowerCase();
    if (valLower === 'null') {
      clauses.push(`${col} IS NULL`);
      return;
    }
    if (valLower === 'not.null') {
      clauses.push(`${col} IS NOT NULL`);
      return;
    }
    if (valLower === 'true') {
      clauses.push(`${col} IS TRUE`);
      return;
    }
    if (valLower === 'false') {
      clauses.push(`${col} IS FALSE`);
      return;
    }
    httpError(400, `is operator accepts only: null, not.null, true, false`);
  }

  const ops: Record<string, string> = { eq: '=', neq: '!=', gte: '>=', lte: '<=', gt: '>', lt: '<', like: 'LIKE', ilike: 'ILIKE' };
  const op = ops[filter.op];
  if (!op) httpError(400, 'unknown op: ' + filter.op);
  clauses.push(`${col} ${op} ${addParam(values, filter.value)}`);
}

function scopedWhere(tableName: string, params: URLSearchParams, userId: string, role: string): { sqlText: string; values: unknown[] } {
  const plan = parseQuery(tableName, params);
  const clauses: string[] = [];
  const values: unknown[] = [];
  addScope(tableName, userId, role, clauses, values);
  for (const filter of plan.filters) addFilter(filter, clauses, values);
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

function handleError(c: AppContext, error: unknown) {
  if (isHttpError(error) && error.status < 500) {
    return c.json({ error: error.message }, error.status as 400);
  }
  return c.json({ error: 'internal server error' }, 500);
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
        return handleError(c, error);
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
        const cols = Object.keys(body);
        const values = Object.values(body);
        const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');
        const result = await sql.unsafe(`INSERT INTO ${quoteIdent(tableName)} (${cols.map(quoteIdent).join(', ')}) VALUES (${placeholders}) RETURNING *`, values);
        return c.json({ data: [result[0]], error: null }, 201);
      } catch (error) {
        return handleError(c, error);
      }
    },
    patch: async (c: AppContext) => {
      try {
        const user = c.get('user');
        const body = sanitizePatchBody(tableName, (await c.req.json()) as Record<string, unknown>);
        const values = Object.values(body);
        const sets = Object.keys(body).map((col, index) => `${quoteIdent(col)} = $${index + 1}`);
        if (sets.length === 0) httpError(400, 'empty body');

        const scoped = scopedWhere(tableName, new URL(c.req.url).searchParams, user.id, user.role ?? 'user');
        const result = await sql.unsafe(
          `UPDATE ${quoteIdent(tableName)} SET ${sets.join(', ')}${scoped.sqlText.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + values.length}`)} RETURNING *`,
          [...values, ...scoped.values],
        );
        return c.json({ data: result as unknown[], error: null });
      } catch (error) {
        return handleError(c, error);
      }
    },
    delete: async (c: AppContext) => {
      try {
        const user = c.get('user');
        const urlParams = new URL(c.req.url).searchParams;
        // Fix sicurezza: DELETE senza filtri espliciti non è permessa
        const schema = TABLE_SCHEMA[tableName];
        const clientFilters = parseFilters(urlParams, schema!);
        if (clientFilters.length === 0) {
          return c.json({ data: null, error: 'DELETE requires at least one filter (e.g. id=eq.xxx)' }, 400);
        }
        const scoped = scopedWhere(tableName, urlParams, user.id, user.role ?? 'user');
        await sql.unsafe(`DELETE FROM ${quoteIdent(tableName)}${scoped.sqlText} RETURNING *`, scoped.values);
        return c.json({ data: null, error: null }, 200);
      } catch (error) {
        return handleError(c, error);
      }
    },
  };
}
