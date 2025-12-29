// ============================================
// INDEXEDDB SCHEMA UPDATE
// Add these tables to src/db/database.ts
// ============================================

// 1. Add new interfaces at the top of the file (after existing interfaces):

export interface FloorPlan {
  id: string;
  projectId: string;
  floor: string;
  imageBlob: Blob; // Store full resolution image locally
  thumbnailBlob?: Blob; // Store thumbnail locally
  imageUrl?: string; // Supabase URL (when synced)
  thumbnailUrl?: string; // Supabase URL (when synced)
  originalFilename: string;
  originalFormat: string;
  width: number;
  height: number;
  metadata?: Record<string, any>;
  createdBy: string;
  createdAt: number; // timestamp
  updatedAt: number; // timestamp
  synced: 0 | 1; // 0 = not synced, 1 = synced
}

export interface FloorPlanPoint {
  id: string;
  floorPlanId: string;
  mappingEntryId: string;
  pointType: 'parete' | 'solaio' | 'perimetro' | 'generico';
  pointX: number; // Normalized 0-1
  pointY: number; // Normalized 0-1
  labelX: number; // Normalized 0-1
  labelY: number; // Normalized 0-1
  perimeterPoints?: Array<{ x: number; y: number }>; // For 'perimetro' type
  customText?: string; // For 'generico' type
  metadata?: Record<string, any>;
  createdBy: string;
  createdAt: number; // timestamp
  updatedAt: number; // timestamp
  synced: 0 | 1;
}

export interface StandaloneMap {
  id: string;
  userId: string;
  name: string;
  description?: string;
  imageBlob: Blob;
  thumbnailBlob?: Blob;
  imageUrl?: string; // Supabase URL (when synced)
  thumbnailUrl?: string;
  originalFilename: string;
  width: number;
  height: number;
  points: Array<{
    id: string;
    pointType: 'parete' | 'solaio' | 'perimetro' | 'generico';
    pointX: number;
    pointY: number;
    labelX: number;
    labelY: number;
    perimeterPoints?: Array<{ x: number; y: number }>;
    customText?: string;
  }>;
  gridEnabled: boolean;
  gridConfig: {
    rows: number;
    cols: number;
    offsetX: number;
    offsetY: number;
  };
  metadata?: Record<string, any>;
  createdAt: number;
  updatedAt: number;
  synced: 0 | 1;
}

// 2. Update the MapsDatabase class definition to include new tables:

class MapsDatabase extends Dexie {
  // Existing tables
  users!: Dexie.Table<User, string>;
  projects!: Dexie.Table<Project, string>;
  mappingEntries!: Dexie.Table<MappingEntry, string>;
  photos!: Dexie.Table<Photo, string>;
  syncQueue!: Dexie.Table<SyncQueueItem, string>;

  // NEW TABLES
  floorPlans!: Dexie.Table<FloorPlan, string>;
  floorPlanPoints!: Dexie.Table<FloorPlanPoint, string>;
  standaloneMaps!: Dexie.Table<StandaloneMap, string>;

  constructor() {
    super('MapsDatabase');

    // Update version number (increment by 1 from current version)
    // Current version is likely 1, so use version 2
    this.version(2).stores({
      // Existing tables (keep these)
      users: 'id, email, role',
      projects: 'id, ownerId, title, *accessibleUsers, syncEnabled',
      mappingEntries: 'id, projectId, floor, createdBy, synced',
      photos: 'id, mappingEntryId, uploaded',
      syncQueue: 'id, entityType, entityId, synced, timestamp',

      // NEW TABLES
      floorPlans: 'id, projectId, floor, createdBy, synced',
      floorPlanPoints: 'id, floorPlanId, mappingEntryId, pointType, synced',
      standaloneMaps: 'id, userId, name, synced',
    });
  }
}

// 3. Export the new interfaces (add to existing exports at bottom of file):
export type { FloorPlan, FloorPlanPoint, StandaloneMap };

// ============================================
// NOTES FOR IMPLEMENTATION
// ============================================

/*
IMPORTANT: When updating the Dexie version:

1. The version() method defines the schema for that version
2. Each new version should INCLUDE all previous tables plus new ones
3. IndexedDB will automatically migrate data from previous versions
4. You can use .upgrade() callback if you need to transform data

Example with data transformation:
this.version(2).stores({
  // all tables here
}).upgrade(tx => {
  // Optional: transform existing data
  return tx.table('projects').toCollection().modify(project => {
    // Add default values for new fields if needed
  });
});

5. After updating, test by:
   - Opening app with old schema
   - Verify upgrade happens automatically
   - Check that all data is preserved
   - Verify new tables are created

6. For debugging, you can inspect IndexedDB in Chrome DevTools:
   Application tab → Storage → IndexedDB → MapsDatabase
*/
