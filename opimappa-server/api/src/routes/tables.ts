import { Hono, type Context } from 'hono';
import { Variables } from '../auth/middleware.js';
import { TABLE_SCHEMA } from '../query/schema.js';
import { createCrudHandler } from './crud.js';

const tables = new Hono<{ Variables: Variables }>();
const TABLE_NAMES = Object.keys(TABLE_SCHEMA);
const ADMIN_ONLY_TABLES = new Set(['dropdown_options', 'products']);
type TableContext = Context<{ Variables: Variables }>;
type TableHandler = (c: TableContext) => Response | Promise<Response>;

function adminWriteGuard(tableName: string, handler: TableHandler): TableHandler {
  return async (c) => {
    const user = c.get('user');
    if (ADMIN_ONLY_TABLES.has(tableName) && user.role !== 'admin') {
      return c.json({ error: 'forbidden' }, 403);
    }
    return handler(c);
  };
}

for (const tableName of TABLE_NAMES) {
  const handler = createCrudHandler(tableName);
  tables.get('/' + tableName, handler.get);
  if (tableName !== 'profiles') {
    tables.post('/' + tableName, adminWriteGuard(tableName, handler.post));
    tables.put('/' + tableName, adminWriteGuard(tableName, handler.put));
    tables.patch('/' + tableName, adminWriteGuard(tableName, handler.patch));
    tables.delete('/' + tableName, adminWriteGuard(tableName, handler.delete));
  }
}

export default tables;
