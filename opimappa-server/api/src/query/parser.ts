import type { ColumnType, RelationshipDef, TableSchemaDef } from './schema.js';
import { TABLE_SCHEMA } from './schema.js';

export function httpError(status: number, message: string): never {
  throw { status, message };
}

export type SelectPlan = { cols: string[] | '*'; joins: JoinPlan[] };
export type JoinPlan = { relation: RelationshipDef; relName: string; type: 'inner' | 'left'; cols: string[] };
export type FilterClause = { type: 'direct' | 'join_filter'; col: string; colType?: ColumnType; op: string; value: string; rel?: RelationshipDef };
export type OrderClause = { col: string; dir: 'asc' | 'desc'; nulls?: 'nullsfirst' | 'nullslast' };
export type QueryPlan = { select: SelectPlan; filters: FilterClause[]; order: OrderClause[]; limit: number; offset: number; countMode: boolean; headMode: boolean };

const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'count', 'head']);
const ALLOWED_OPS = new Set(['eq', 'neq', 'in', 'gte', 'lte', 'gt', 'lt', 'is', 'like', 'ilike']);

function splitTopLevel(raw: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;

  for (const char of raw) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }

  parts.push(current.trim());
  return parts;
}

export function parseSelect(raw: string | null, schema: TableSchemaDef): SelectPlan {
  if (raw === null || raw === '*') return { cols: '*', joins: [] };

  const cols: string[] = [];
  const joins: JoinPlan[] = [];

  for (const part of splitTopLevel(raw).map((s) => s.trim())) {
    const joinMatch = part.match(/^(\w+)!(inner|left)\((.*)\)$/);
    if (joinMatch) {
      const [, relName, type, subColsRaw] = joinMatch;
      const relation = schema.relationships[relName];
      if (!relation) httpError(400, 'unknown relation: ' + relName);
      const cols = subColsRaw.split(',').map((s) => s.trim());
      joins.push({ relation, relName, type: type as 'inner' | 'left', cols });
      continue;
    }

    if (!(part in schema.columns)) httpError(400, 'unknown col: ' + part);
    cols.push(part);
  }

  return { cols, joins };
}

export function parseFilters(params: URLSearchParams, schema: TableSchemaDef): FilterClause[] {
  const filters: FilterClause[] = [];

  for (const [key, raw] of params) {
    if (RESERVED.has(key)) continue;

    const dotIdx = raw.indexOf('.');
    if (dotIdx === -1) httpError(400, 'invalid filter value: ' + raw);

    const op = raw.slice(0, dotIdx);
    const value = raw.slice(dotIdx + 1);
    if (!ALLOWED_OPS.has(op)) httpError(400, 'unknown op: ' + op);

    if (op === 'is') {
      const allowed = new Set(['null', 'not.null', 'true', 'false']);
      if (!allowed.has(value)) httpError(400, `is operator accepts only: null, not.null, true, false`);
    }

    if (key.includes('.')) {
      const [relName, relCol] = key.split('.');
      const rel = schema.relationships[relName];
      if (!rel) httpError(400, 'unknown relation in filter: ' + relName);
      const targetSchema = TABLE_SCHEMA[rel.target as keyof typeof TABLE_SCHEMA];
      if (targetSchema && !(relCol in targetSchema.columns)) {
        httpError(400, `unknown col on ${relName}: ${relCol}`);
      }
      filters.push({ type: 'join_filter', rel, col: relCol, op, value });
    } else {
      if (!(key in schema.columns)) httpError(400, 'unknown col: ' + key);
      filters.push({ type: 'direct', col: key, colType: schema.columns[key], op, value });
    }
  }

  return filters;
}

export function parseOrder(raw: string | null, schema: TableSchemaDef): OrderClause[] {
  if (raw === null) return [];

  return raw.split(',').map((s) => s.trim()).map((part) => {
    const [col, dir, nulls] = part.split('.');
    if (!(col in schema.columns)) httpError(400, 'unknown col: ' + col);
    if (dir !== 'asc' && dir !== 'desc') httpError(400, 'invalid order dir: ' + String(dir));
    if (nulls !== undefined && nulls !== 'nullsfirst' && nulls !== 'nullslast') {
      httpError(400, 'invalid nulls order: ' + nulls);
    }
    return { col, dir, nulls } as OrderClause;
  });
}

export function parseQuery(tableName: string, params: URLSearchParams): QueryPlan {
  const schema = TABLE_SCHEMA[tableName];
  if (!schema) httpError(400, 'unknown table: ' + tableName);

  const select = parseSelect(params.get('select'), schema);
  const filters = parseFilters(params, schema);
  const order = parseOrder(params.get('order'), schema);
  const limit = Math.min(parseInt(params.get('limit') ?? '100') || 100, 1000);
  const offset = Math.max(parseInt(params.get('offset') ?? '0') || 0, 0);
  const countMode = params.get('count') === 'exact';
  const headMode = params.get('head') === 'true';

  return { select, filters, order, limit, offset, countMode, headMode };
}
