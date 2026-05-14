import { Hono } from 'hono';
import { Variables } from '../auth/middleware.js';
import { TABLE_SCHEMA } from '../query/schema.js';
import { createCrudHandler } from './crud.js';

const tables = new Hono<{ Variables: Variables }>();
const TABLE_NAMES = Object.keys(TABLE_SCHEMA);

for (const tableName of TABLE_NAMES) {
  const handler = createCrudHandler(tableName);
  tables.get('/' + tableName, handler.get);
  if (tableName !== 'profiles') {
    tables.post('/' + tableName, handler.post);
    tables.patch('/' + tableName, handler.patch);
    tables.delete('/' + tableName, handler.delete);
  }
}

export default tables;
