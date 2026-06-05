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
    // Allineato a supabase/schema.sql (tabella public.projects). Le colonne JSONB
    // (floors/plans/floor_plans/typologies/accessible_users) vengono serializzate
    // in crud.ts prima del bind. `synced` è readOnly: il DB è boolean ma il client
    // invia 1/0 → senza esclusione causerebbe un cast error int→bool.
    columns: {
      id: 'uuid',
      title: 'text',
      client: 'text',
      address: 'text',
      notes: 'text',
      floors: 'jsonb',
      plans: 'jsonb',
      floor_plans: 'jsonb',
      typologies: 'jsonb',
      owner_id: 'text',
      accessible_users: 'jsonb',
      use_room_numbering: 'boolean',
      use_intervention_numbering: 'boolean',
      archived: 'boolean',
      synced: 'boolean',
      sync_enabled: 'integer',
      version: 'integer',
      last_modified: 'bigint',
      created_at: 'timestamptz',
      updated_at: 'timestamptz',
    },
    readOnly: ['synced'],
    relationships: {
      mapping_entries: { type: 'hasMany', fk: 'project_id', target: 'mapping_entries' },
      floor_plans: { type: 'hasMany', fk: 'project_id', target: 'floor_plans' },
      sals: { type: 'hasMany', fk: 'project_id', target: 'sals' },
    },
  },
  mapping_entries: {
    // Allineato a supabase/schema.sql. `synced` è boolean nel DB ed è readOnly
    // (il client invia 1/0 → cast error int→bool se scrivibile).
    columns: {
      id: 'uuid',
      project_id: 'uuid',
      floor: 'text',
      room: 'text',
      intervention: 'text',
      crossings: 'jsonb',
      photos: 'jsonb',
      timestamp: 'bigint',
      last_modified: 'bigint',
      version: 'integer',
      created_by: 'text',
      modified_by: 'text',
      planimetry_point_id: 'text',
      planimetry_x: 'float',
      planimetry_y: 'float',
      planimetry_label: 'text',
      to_complete: 'boolean',
      synced: 'boolean',
      created_at: 'timestamptz',
      updated_at: 'timestamptz',
    },
    readOnly: ['synced'],
    relationships: {
      photos_rel: { type: 'hasMany', fk: 'mapping_entry_id', target: 'photos' },
      project: { type: 'belongsTo', fk: 'project_id', target: 'projects' },
    },
  },
  structure_entries: {
    columns: {
      id: 'uuid',
      project_id: 'uuid',
      floor: 'text',
      room: 'text',
      intervention: 'text',
      structures: 'jsonb',
      photos: 'jsonb',
      to_complete: 'boolean',
      timestamp: 'bigint',
      last_modified: 'bigint',
      version: 'integer',
      created_by: 'text',
      modified_by: 'text',
      synced: 'boolean',
      created_at: 'timestamptz',
      updated_at: 'timestamptz',
    },
    readOnly: ['synced'],
    relationships: {
      photos_rel: { type: 'hasMany', fk: 'structure_entry_id', target: 'photos' },
      project: { type: 'belongsTo', fk: 'project_id', target: 'projects' },
    },
  },
  photos: {
    columns: {
      id: 'uuid',
      mapping_entry_id: 'uuid',
      structure_entry_id: 'uuid',
      storage_path: 'text',
      thumbnail_storage_path: 'text',
      url: 'text',
      thumbnail_url: 'text',
      metadata: 'jsonb',
      uploaded: 'boolean',
      created_at: 'timestamptz',
      updated_at: 'timestamptz',
    },
    relationships: {
      mapping_entries: { type: 'belongsTo', fk: 'mapping_entry_id', target: 'mapping_entries' },
    },
  },
  floor_plans: {
    columns: {
      id: 'uuid',
      project_id: 'uuid',
      floor: 'text',
      image_url: 'text',
      thumbnail_url: 'text',
      pdf_url: 'text',
      image_storage_path: 'text',
      thumbnail_storage_path: 'text',
      pdf_storage_path: 'text',
      original_filename: 'text',
      original_format: 'text',
      width: 'integer',
      height: 'integer',
      metadata: 'jsonb',
      created_by: 'text',
      created_at: 'timestamptz',
      updated_at: 'timestamptz',
    },
    // *_storage_path scrivibili dal client durante sync upload (registrazione path MinIO).
    relationships: {
      floor_plan_points: { type: 'hasMany', fk: 'floor_plan_id', target: 'floor_plan_points' },
      project: { type: 'belongsTo', fk: 'project_id', target: 'projects' },
    },
  },
  floor_plan_points: {
    columns: {
      id: 'uuid',
      floor_plan_id: 'uuid',
      mapping_entry_id: 'uuid',
      structure_entry_id: 'uuid',
      point_type: 'text',
      point_x: 'float',
      point_y: 'float',
      label_x: 'float',
      label_y: 'float',
      perimeter_points: 'jsonb',
      custom_text: 'text',
      ei_rating: 'integer',
      metadata: 'jsonb',
      created_by: 'text',
      created_at: 'timestamptz',
      updated_at: 'timestamptz',
    },
    relationships: {
      floor_plan: { type: 'belongsTo', fk: 'floor_plan_id', target: 'floor_plans' },
    },
  },
  standalone_maps: {
    // Allineato a supabase/schema.sql. Il client scrive points/grid_config/grid_enabled
    // /metadata/description/dimensioni; `data` era una colonna fantasma (non esiste nel DB).
    columns: {
      id: 'uuid',
      user_id: 'text',
      name: 'text',
      description: 'text',
      // URL legacy — mantenuti per compatibilità lettura
      image_url: 'text',
      thumbnail_url: 'text',
      pdf_url: 'text',
      // Percorsi canonici MinIO — leggibili ma non scrivibili dai client
      image_storage_path: 'text',
      thumbnail_storage_path: 'text',
      pdf_storage_path: 'text',
      original_filename: 'text',
      original_format: 'text',
      width: 'integer',
      height: 'integer',
      points: 'jsonb',
      grid_enabled: 'boolean',
      grid_config: 'jsonb',
      metadata: 'jsonb',
      created_at: 'timestamptz',
      updated_at: 'timestamptz',
    },
    // *_storage_path impostati solo da migration/server
    readOnly: ['image_storage_path', 'thumbnail_storage_path', 'pdf_storage_path'],
    relationships: {},
  },
  dropdown_options: {
    columns: { id: 'uuid', category: 'text', value: 'text', label: 'text', unit: 'text', sort_order: 'integer', is_active: 'boolean', created_at: 'timestamptz', updated_at: 'timestamptz' },
    relationships: {},
  },
  products: {
    columns: { id: 'uuid', brand: 'text', name: 'text', sort_order: 'integer', is_active: 'boolean', created_at: 'timestamptz', updated_at: 'timestamptz' },
    relationships: {},
  },
  sals: {
    // Allineato a supabase/schema.sql: la tabella sals NON ha updated_at né
    // last_modified. `synced` è boolean ed è readOnly (client invia true/1).
    columns: {
      id: 'uuid',
      project_id: 'uuid',
      number: 'integer',
      name: 'text',
      date: 'bigint',
      notes: 'text',
      synced: 'boolean',
      created_at: 'timestamptz',
    },
    readOnly: ['synced'],
    relationships: {
      project: { type: 'belongsTo', fk: 'project_id', target: 'projects' },
    },
  },
  typology_prices: {
    columns: {
      id: 'uuid',
      project_id: 'uuid',
      category: 'text',
      attraversamento: 'text',
      tipologico_id: 'text',
      price_per_unit: 'float',
      unit: 'text',
      created_at: 'timestamptz',
      updated_at: 'timestamptz',
    },
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
