export type ColumnType = 'text' | 'uuid' | 'boolean' | 'integer' | 'bigint' | 'float' | 'jsonb' | 'timestamptz';
export type RelationshipType = 'hasMany' | 'belongsTo';
export interface RelationshipDef { type: RelationshipType; fk: string; target: string; }

/**
 * TableSchemaDef — definizione schema tabella.
 *
 * columns:   tutte le colonne selezionabili (lettura + scrittura)
 * readOnly:  colonne incluse in SELECT ma escluse dalla whitelist di scrittura
 *            (es. *_storage_path — impostati solo lato server/migration)
 * relationships: relazioni tra tabelle
 */
export interface TableSchemaDef {
  columns: Record<string, ColumnType>;
  readOnly?: string[];
  relationships: Record<string, RelationshipDef>;
}

export const TABLE_SCHEMA: Record<string, TableSchemaDef> = {
  profiles: {
    columns: { id: 'text', email: 'text', username: 'text', role: 'text', active: 'boolean', created_at: 'timestamptz', updated_at: 'timestamptz' },
    relationships: {},
  },
  projects: {
    columns: { id: 'uuid', owner_id: 'text', title: 'text', description: 'text', last_modified: 'bigint', archived: 'boolean', sync_enabled: 'boolean', accessible_users: 'jsonb', created_at: 'timestamptz', updated_at: 'timestamptz' },
    relationships: {
      mapping_entries: { type: 'hasMany', fk: 'project_id', target: 'mapping_entries' },
      floor_plans: { type: 'hasMany', fk: 'project_id', target: 'floor_plans' },
      sals: { type: 'hasMany', fk: 'project_id', target: 'sals' },
    },
  },
  mapping_entries: {
    columns: { id: 'uuid', project_id: 'uuid', floor_plan_id: 'uuid', type: 'text', label: 'text', x: 'float', y: 'float', data: 'jsonb', synced: 'integer', last_modified: 'bigint', created_at: 'timestamptz', updated_at: 'timestamptz' },
    relationships: {
      photos: { type: 'hasMany', fk: 'mapping_entry_id', target: 'photos' },
      project: { type: 'belongsTo', fk: 'project_id', target: 'projects' },
    },
  },
  structure_entries: {
    columns: { id: 'uuid', project_id: 'uuid', floor_plan_id: 'uuid', type: 'text', label: 'text', data: 'jsonb', synced: 'integer', last_modified: 'bigint', created_at: 'timestamptz', updated_at: 'timestamptz' },
    relationships: {
      photos: { type: 'hasMany', fk: 'structure_entry_id', target: 'photos' },
      project: { type: 'belongsTo', fk: 'project_id', target: 'projects' },
    },
  },
  photos: {
    columns: {
      id: 'uuid',
      mapping_entry_id: 'uuid',
      structure_entry_id: 'uuid',
      // Percorsi canonici MinIO — leggibili ma non scrivibili dai client
      storage_path: 'text',
      thumbnail_storage_path: 'text',
      // URL legacy Supabase — mantenuti per compatibilità lettura
      url: 'text',
      thumbnail_url: 'text',
      remote_url: 'text',
      has_remote_photos: 'boolean',
      uploaded: 'boolean',
      synced: 'integer',
      last_modified: 'bigint',
      created_at: 'timestamptz',
    },
    // storage_path e thumbnail_storage_path impostati solo da migration/server
    readOnly: ['storage_path', 'thumbnail_storage_path'],
    relationships: {
      mapping_entries: { type: 'belongsTo', fk: 'mapping_entry_id', target: 'mapping_entries' },
    },
  },
  floor_plans: {
    columns: {
      id: 'uuid',
      project_id: 'uuid',
      name: 'text',
      // URL legacy — mantenuti per compatibilità lettura
      image_url: 'text',
      thumbnail_url: 'text',
      pdf_url: 'text',
      // Percorsi canonici MinIO — leggibili ma non scrivibili dai client
      image_storage_path: 'text',
      thumbnail_storage_path: 'text',
      pdf_storage_path: 'text',
      synced: 'integer',
      last_modified: 'bigint',
      created_at: 'timestamptz',
      updated_at: 'timestamptz',
    },
    // *_storage_path impostati solo da migration/server
    readOnly: ['image_storage_path', 'thumbnail_storage_path', 'pdf_storage_path'],
    relationships: {
      floor_plan_points: { type: 'hasMany', fk: 'floor_plan_id', target: 'floor_plan_points' },
      project: { type: 'belongsTo', fk: 'project_id', target: 'projects' },
    },
  },
  floor_plan_points: {
    columns: { id: 'uuid', floor_plan_id: 'uuid', x: 'float', y: 'float', type: 'text', label: 'text', data: 'jsonb', synced: 'integer', last_modified: 'bigint' },
    relationships: {
      floor_plan: { type: 'belongsTo', fk: 'floor_plan_id', target: 'floor_plans' },
    },
  },
  standalone_maps: {
    columns: {
      id: 'uuid',
      user_id: 'text',
      name: 'text',
      // URL legacy — mantenuti per compatibilità lettura
      image_url: 'text',
      thumbnail_url: 'text',
      pdf_url: 'text',
      // Percorsi canonici MinIO — leggibili ma non scrivibili dai client
      image_storage_path: 'text',
      thumbnail_storage_path: 'text',
      pdf_storage_path: 'text',
      data: 'jsonb',
      synced: 'integer',
      last_modified: 'bigint',
      created_at: 'timestamptz',
      updated_at: 'timestamptz',
    },
    // *_storage_path impostati solo da migration/server
    readOnly: ['image_storage_path', 'thumbnail_storage_path', 'pdf_storage_path'],
    relationships: {},
  },
  dropdown_options: {
    columns: { id: 'uuid', category: 'text', value: 'text', label: 'text', sort_order: 'integer', is_active: 'boolean', created_at: 'timestamptz', updated_at: 'timestamptz' },
    relationships: {},
  },
  products: {
    columns: { id: 'uuid', brand: 'text', name: 'text', sort_order: 'integer', is_active: 'boolean', created_at: 'timestamptz', updated_at: 'timestamptz' },
    relationships: {},
  },
  sals: {
    columns: { id: 'uuid', project_id: 'uuid', title: 'text', data: 'jsonb', synced: 'integer', last_modified: 'bigint', created_at: 'timestamptz', updated_at: 'timestamptz' },
    relationships: {
      project: { type: 'belongsTo', fk: 'project_id', target: 'projects' },
    },
  },
  typology_prices: {
    columns: { id: 'uuid', project_id: 'uuid', typology: 'text', price: 'float', synced: 'integer', last_modified: 'bigint', created_at: 'timestamptz', updated_at: 'timestamptz' },
    relationships: {},
  },
};

export const ADMIN_ONLY_TABLES = new Set(['profiles']);
export const GLOBAL_TABLES = new Set(['dropdown_options', 'products']);
export const USER_ID_TABLES = new Set(['standalone_maps']);

/**
 * Restituisce l'insieme di colonne scrivibili per una tabella.
 * Esclude le colonne in readOnly (es. *_storage_path).
 */
export function getWritableColumns(tableName: string): Record<string, ColumnType> | undefined {
  const table = TABLE_SCHEMA[tableName];
  if (!table) return undefined;
  if (!table.readOnly || table.readOnly.length === 0) return table.columns;

  const roSet = new Set(table.readOnly);
  return Object.fromEntries(
    Object.entries(table.columns).filter(([key]) => !roSet.has(key)),
  );
}
