import { sql } from '../db/client.js';
import { TABLE_SCHEMA } from './schema.js';
import { httpError, type FilterClause, type OrderClause, type QueryPlan } from './parser.js';
import { addScope } from './scope.js';

export type WhereBuild = {
  clauses: string[];
  values: unknown[];
};

const OP_SQL: Record<string, string> = {
  eq: '=',
  neq: '!=',
  gte: '>=',
  lte: '<=',
  gt: '>',
  lt: '<',
  like: 'LIKE',
  ilike: 'ILIKE',
};

export function quoteIdent(identifier: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(identifier)) {
    httpError(400, 'invalid identifier: ' + identifier);
  }
  return `"${identifier}"`;
}

export function addParam(values: unknown[], value: unknown): string {
  values.push(value);
  return `$${values.length}`;
}

export function addFilter(filter: FilterClause, build: WhereBuild): void {
  if (filter.type === 'join_filter') return;

  const sqlArrayTypeFor = (colType: FilterClause['colType']): string => {
    switch (colType) {
      case 'uuid':
        return '::uuid[]';
      case 'integer':
        return '::int[]';
      case 'bigint':
        return '::bigint[]';
      case 'float':
        return '::float8[]';
      case 'boolean':
        return '::boolean[]';
      default:
        return '';
    }
  };

  const col = quoteIdent(filter.col);
  if (filter.op === 'in') {
    const rawList = filter.value.trim();
    const normalizedList = rawList.startsWith('(') && rawList.endsWith(')')
      ? rawList.slice(1, -1)
      : rawList;
    const parts = normalizedList.split(',').map((part) => part.trim());
    if (parts.length === 0 || parts.some((part) => part === '')) {
      httpError(400, 'in operator requires non-empty values');
    }
    const placeholders = parts.map((part) => addParam(build.values, part)).join(', ');
    // Postgres non inferisce il tipo degli elementi per parametri text comparati a UUID/numerici.
    build.clauses.push(`${col} = ANY(ARRAY[${placeholders}]${sqlArrayTypeFor(filter.colType)})`);
    return;
  }

  if (filter.op === 'is') {
    const valLower = filter.value.toLowerCase();
    if (valLower === 'null') {
      build.clauses.push(`${col} IS NULL`);
      return;
    }
    if (valLower === 'not.null') {
      build.clauses.push(`${col} IS NOT NULL`);
      return;
    }
    if (valLower === 'true') {
      build.clauses.push(`${col} IS TRUE`);
      return;
    }
    if (valLower === 'false') {
      build.clauses.push(`${col} IS FALSE`);
      return;
    }
    httpError(400, `is operator accepts only: null, not.null, true, false`);
  }

  const op = OP_SQL[filter.op];
  if (!op) httpError(400, 'unknown op: ' + filter.op);
  // postgres.js serializza una stringa JS ('true'/'false') verso una colonna boolean
  // sempre come false (vedi serializer interno): un filtro is_active=eq.true tornerebbe
  // 0 righe. Convertiamo qui il valore in un boolean JS reale prima del bind.
  let boundValue: unknown = filter.value;
  if (filter.colType === 'boolean') {
    const lower = filter.value.toLowerCase();
    if (lower === 'true' || lower === 't' || lower === '1') boundValue = true;
    else if (lower === 'false' || lower === 'f' || lower === '0') boundValue = false;
    else httpError(400, 'invalid boolean value: ' + filter.value);
  }
  build.clauses.push(`${col} ${op} ${addParam(build.values, boundValue)}`);
}

function buildWhere(tableName: string, plan: QueryPlan, userId: string, role: string): WhereBuild {
  const build: WhereBuild = { clauses: [], values: [] };
  addScope(tableName, userId, role, build.clauses, build.values);
  for (const filter of plan.filters) addFilter(filter, build);
  return build;
}

function buildSelect(plan: QueryPlan): string {
  if (plan.select.cols === '*') return '*';
  if (plan.select.cols.length === 0) return '*';
  return plan.select.cols.map(quoteIdent).join(', ');
}

function buildOrder(tableName: string, order: OrderClause[], limit: number, offset: number): string {
  if (order.length === 0) {
    // Paginazione stabile: senza ORDER BY Postgres può duplicare/skippare righe tra pagine.
    if ((limit > 0 || offset > 0) && TABLE_SCHEMA[tableName]?.columns.id) return ` ORDER BY ${quoteIdent('id')} ASC`;
    return '';
  }
  const parts = order.map((clause) => {
    const nulls = clause.nulls ? ` ${clause.nulls === 'nullsfirst' ? 'NULLS FIRST' : 'NULLS LAST'}` : '';
    return `${quoteIdent(clause.col)} ${clause.dir.toUpperCase()}${nulls}`;
  });
  return ` ORDER BY ${parts.join(', ')}`;
}

export async function executeQuery(tableName: string, plan: QueryPlan, userId: string, role: string): Promise<{ rows: unknown[]; totalCount: number | null }> {
  if (!TABLE_SCHEMA[tableName]) httpError(400, 'unknown table: ' + tableName);

  const table = quoteIdent(tableName);
  const where = buildWhere(tableName, plan, userId, role);
  const whereSql = where.clauses.length > 0 ? ` WHERE ${where.clauses.join(' AND ')}` : '';

  let totalCount: number | null = null;
  if (plan.countMode) {
    const countRows = await sql.unsafe(`SELECT COUNT(*)::int AS count FROM ${table}${whereSql}`, where.values as unknown[] as any[]);
    totalCount = Number(countRows[0]?.count ?? 0);
  }

  if (plan.headMode) {
    return { rows: [], totalCount };
  }

  const values = [...where.values, plan.limit, plan.offset];
  const query = `SELECT ${buildSelect(plan)} FROM ${table}${whereSql}${buildOrder(tableName, plan.order, plan.limit, plan.offset)} LIMIT $${values.length - 1} OFFSET $${values.length}`;
  const rows = await sql.unsafe(query, values as unknown[] as any[]);

  return { rows: rows as unknown[], totalCount };
}
