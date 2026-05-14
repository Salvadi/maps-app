import { ADMIN_ONLY_TABLES, GLOBAL_TABLES, USER_ID_TABLES } from './schema.js';
import { httpError } from './parser.js';
import { addParam, quoteIdent } from './builder.js';

const PROJECT_SCOPED_TABLES = new Set(['mapping_entries', 'structure_entries', 'floor_plans', 'sals', 'typology_prices']);

export function addScope(
  tableName: string,
  userId: string,
  role: string,
  whereClauses: string[],
  values: unknown[]
): void {
  if (role === 'admin' || GLOBAL_TABLES.has(tableName)) return;
  if (ADMIN_ONLY_TABLES.has(tableName)) httpError(403, 'forbidden');

  if (USER_ID_TABLES.has(tableName)) {
    whereClauses.push(`${quoteIdent('user_id')} = ${addParam(values, userId)}`);
    return;
  }

  // floor_plan_points: scope via floor_plan_id → floor_plans → projects (nessuna colonna project_id diretta)
  if (tableName === 'floor_plan_points') {
    const p1 = addParam(values, userId);
    const p2 = addParam(values, userId);
    whereClauses.push(`floor_plan_id IN (
      SELECT id FROM floor_plans WHERE project_id IN (
        SELECT id FROM projects
        WHERE owner_id = ${p1} OR (accessible_users)::jsonb ? ${p2}
      )
    )`);
    return;
  }

  // Tabelle con project_id diretto: scope via subquery su projects accessibili
  if (PROJECT_SCOPED_TABLES.has(tableName)) {
    const ownerParam = addParam(values, userId);
    const accessibleParam = addParam(values, userId);
    whereClauses.push(`project_id IN (SELECT id FROM projects WHERE ${quoteIdent('owner_id')} = ${ownerParam} OR (${quoteIdent('accessible_users')})::jsonb ? ${accessibleParam})`);
    return;
  }

  // photos: scope via mapping_entry_id o structure_entry_id → project
  if (tableName === 'photos') {
    const p1 = addParam(values, userId);
    const p2 = addParam(values, userId);
    const p3 = addParam(values, userId);
    const p4 = addParam(values, userId);
    whereClauses.push(`(
      (mapping_entry_id IS NOT NULL AND mapping_entry_id IN (
        SELECT id FROM mapping_entries WHERE project_id IN (
          SELECT id FROM projects WHERE ${quoteIdent('owner_id')} = ${p1} OR (${quoteIdent('accessible_users')})::jsonb ? ${p2}
        )
      )) OR
      (structure_entry_id IS NOT NULL AND structure_entry_id IN (
        SELECT id FROM structure_entries WHERE project_id IN (
          SELECT id FROM projects WHERE ${quoteIdent('owner_id')} = ${p3} OR (${quoteIdent('accessible_users')})::jsonb ? ${p4}
        )
      ))
    )`);
    return;
  }

  // Tabella projects (owner_id diretto)
  const ownerParam = addParam(values, userId);
  const accessibleParam = addParam(values, userId);
  whereClauses.push(`(${quoteIdent('owner_id')} = ${ownerParam} OR (${quoteIdent('accessible_users')})::jsonb ? ${accessibleParam})`);
}
