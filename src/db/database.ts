import Dexie, { Table } from 'dexie';

// TypeScript interfaces matching PRD data models
export interface Project {
  id: string; // UUID
  title: string;
  client: string;
  address: string;
  notes: string;
  floors: string[]; // e.g., ['-1', '0', '1', '2']
  plans: string[]; // URLs or local blob IDs
  useRoomNumbering: boolean; // Switch Stanza
  useInterventionNumbering: boolean; // Switch Intervento n.
  typologies: Typology[];
  ownerId: string; // user UUID
  accessibleUsers: string[]; // array of user UUIDs
  archived: number; // 0 = false, 1 = true (for Dexie indexing compatibility)
  syncEnabled: number; // 0 = false (metadata only), 1 = true (full sync with photos and mappings)
  createdAt: number; // timestamp
  updatedAt: number; // timestamp
  version?: number; // For conflict detection (optional for backward compatibility)
  lastModified?: number; // For conflict detection (optional for backward compatibility)
  synced: number; // 0 = false, 1 = true (for Dexie indexing compatibility)
}

export interface Typology {
  id: string;
  number: number;
  supporto: string;
  tipoSupporto: string;
  attraversamento: string;
  attraversamentoCustom?: string;
  marcaProdottoUtilizzato: string;
  prodottiSelezionati: string[];
}

export interface PhotoMetadata {
  id: string;
  localBlobId?: string; // If not yet uploaded
  remoteUrl?: string; // After upload
  timestamp: number;
  size: number;
  compressed: boolean;
}

export interface Crossing {
  id: string;
  supporto: string;
  tipoSupporto: string;
  attraversamento: string;
  attraversamentoCustom?: string;
  tipologicoId?: string;
  quantita?: number;
  diametro?: string;
  dimensioni?: string;
  notes?: string;
}

export interface MappingEntry {
  id: string; // UUID
  projectId: string;
  floor: string;
  room?: string;
  intervention?: string;
  photos: PhotoMetadata[];
  crossings: Crossing[];
  toComplete?: boolean; // Flag to mark if intervention is still to be completed
  timestamp: number;
  createdBy: string; // user UUID
  lastModified: number;
  modifiedBy: string;
  version: number; // For conflict detection
  synced: number; // 0 = false, 1 = true (for Dexie indexing compatibility)
}

export interface Photo {
  id: string;
  blob: Blob;
  mappingEntryId: string;
  metadata: {
    width: number;
    height: number;
    size: number;
    mimeType: string;
    captureTimestamp: number;
    gps?: { lat: number; lon: number }; // Optional
  };
  uploaded: boolean;
  remoteUrl?: string;
}

export interface SyncQueueItem {
  id: string;
  operation: 'CREATE' | 'UPDATE' | 'DELETE';
  entityType: 'project' | 'mapping_entry' | 'photo' | 'floor_plan' | 'floor_plan_point' | 'standalone_map';
  entityId: string;
  payload: any; // The actual data to sync
  timestamp: number;
  retryCount: number;
  lastError?: string;
  synced: number; // 0 = false, 1 = true (for Dexie indexing compatibility)
}

export interface User {
  id: string; // UUID
  email: string;
  username: string; // Display name
  role: 'admin' | 'user';
  createdAt: number;
}

export interface AppMetadata {
  key: string;
  value: any;
}

export interface ConflictHistory {
  id: string;
  timestamp: number;
  entityType: 'project' | 'mapping_entry';
  entityId: string;
  conflictType: 'version' | 'timestamp' | 'both';
  localVersion: any;
  remoteVersion: any;
  resolvedVersion: any;
  strategy: string; // ConflictResolutionStrategy
  autoResolved: boolean;
  userNotified: boolean;
}

// ============================================
// FLOOR PLAN INTERFACES
// ============================================

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
  gridEnabled?: boolean;
  gridConfig?: {
    rows: number;
    cols: number;
    offsetX: number;
    offsetY: number;
  };
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
    labelBackgroundColor?: string; // Custom background color for label
    labelTextColor?: string; // Custom text color for label
    labelText?: string[]; // Custom label text (if modified by user)
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

// ============================================
// DROPDOWN OPTIONS CACHE INTERFACES
// ============================================

export interface DropdownOptionCache {
  id: string; // Supabase UUID
  category: string; // e.g., 'supporto', 'tipo_supporto', 'attraversamento'
  value: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
  fetchedAt: number; // timestamp
}

export interface ProductCache {
  id: string; // Supabase UUID
  brand: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  fetchedAt: number; // timestamp
}

// Dexie database class
export class MappingDatabase extends Dexie {
  // Typed table properties
  projects!: Table<Project, string>;
  mappingEntries!: Table<MappingEntry, string>;
  photos!: Table<Photo, string>;
  syncQueue!: Table<SyncQueueItem, string>;
  users!: Table<User, string>;
  metadata!: Table<AppMetadata, string>;
  conflictHistory!: Table<ConflictHistory, string>;

  // FLOOR PLAN TABLES
  floorPlans!: Table<FloorPlan, string>;
  floorPlanPoints!: Table<FloorPlanPoint, string>;
  standaloneMaps!: Table<StandaloneMap, string>;

  // DROPDOWN OPTIONS CACHE
  dropdownOptionsCache!: Table<DropdownOptionCache, string>;
  productsCache!: Table<ProductCache, string>;

  constructor() {
    super('MappingDatabase');

    // Define schema v1
    this.version(1).stores({
      projects: 'id, ownerId, *accessibleUsers, synced, updatedAt',
      mappingEntries: 'id, projectId, floor, createdBy, synced, timestamp',
      photos: 'id, mappingEntryId, uploaded',
      syncQueue: 'id, synced, timestamp, entityType, entityId',
      users: 'id, email, role',
      metadata: 'key'
    });

    // Define schema v2 - add archived field to projects
    this.version(2).stores({
      projects: 'id, ownerId, *accessibleUsers, synced, updatedAt, archived',
      mappingEntries: 'id, projectId, floor, createdBy, synced, timestamp',
      photos: 'id, mappingEntryId, uploaded',
      syncQueue: 'id, synced, timestamp, entityType, entityId',
      users: 'id, email, role',
      metadata: 'key'
    }).upgrade(tx => {
      // Set archived = 0 for all existing projects
      return tx.table('projects').toCollection().modify(project => {
        if (project.archived === undefined) {
          project.archived = 0;
        }
      });
    });

    // Define schema v3 - add syncEnabled field to projects and conflictHistory table
    this.version(3).stores({
      projects: 'id, ownerId, *accessibleUsers, synced, updatedAt, archived, syncEnabled',
      mappingEntries: 'id, projectId, floor, createdBy, synced, timestamp',
      photos: 'id, mappingEntryId, uploaded',
      syncQueue: 'id, synced, timestamp, entityType, entityId',
      users: 'id, email, role',
      metadata: 'key',
      conflictHistory: 'id, timestamp, entityType, entityId, userNotified'
    }).upgrade(tx => {
      // Set syncEnabled = 0 for all existing projects (default to metadata-only sync)
      return tx.table('projects').toCollection().modify(project => {
        if (project.syncEnabled === undefined) {
          project.syncEnabled = 0;
        }
      });
    });

    // Define schema v4 - add floor plan tables
    this.version(4).stores({
      projects: 'id, ownerId, *accessibleUsers, synced, updatedAt, archived, syncEnabled',
      mappingEntries: 'id, projectId, floor, createdBy, synced, timestamp',
      photos: 'id, mappingEntryId, uploaded',
      syncQueue: 'id, synced, timestamp, entityType, entityId',
      users: 'id, email, role',
      metadata: 'key',
      conflictHistory: 'id, timestamp, entityType, entityId, userNotified',
      // NEW TABLES FOR FLOOR PLANS
      floorPlans: 'id, projectId, floor, createdBy, synced, [projectId+floor]',
      floorPlanPoints: 'id, floorPlanId, mappingEntryId, pointType, synced',
      standaloneMaps: 'id, userId, name, synced'
    });

    // Define schema v5 - add dropdown options and products cache tables
    this.version(5).stores({
      projects: 'id, ownerId, *accessibleUsers, synced, updatedAt, archived, syncEnabled',
      mappingEntries: 'id, projectId, floor, createdBy, synced, timestamp',
      photos: 'id, mappingEntryId, uploaded',
      syncQueue: 'id, synced, timestamp, entityType, entityId',
      users: 'id, email, role',
      metadata: 'key',
      conflictHistory: 'id, timestamp, entityType, entityId, userNotified',
      floorPlans: 'id, projectId, floor, createdBy, synced, [projectId+floor]',
      floorPlanPoints: 'id, floorPlanId, mappingEntryId, pointType, synced',
      standaloneMaps: 'id, userId, name, synced',
      // DROPDOWN OPTIONS CACHE
      dropdownOptionsCache: 'id, category, sortOrder',
      productsCache: 'id, brand, sortOrder'
    });
  }
}

// Create and export database instance
export const db = new MappingDatabase();

// Helper function to generate UUIDs
export function generateId(): string {
  return crypto.randomUUID();
}

// Helper function to get current timestamp
export function now(): number {
  return Date.now();
}

// Initialize database
export async function initializeDatabase(): Promise<void> {
  try {
    await db.open();
    console.log('Database initialized successfully');

    // Set initial metadata
    const lastSyncKey = await db.metadata.get('lastSync');
    if (!lastSyncKey) {
      await db.metadata.put({ key: 'lastSync', value: 0 });
    }

    const currentUserKey = await db.metadata.get('currentUser');
    if (!currentUserKey) {
      await db.metadata.put({ key: 'currentUser', value: null });
    }
  } catch (error) {
    console.error('Failed to initialize database:', error);
    throw error;
  }
}

// Clear all data (for testing or reset)
export async function clearDatabase(): Promise<void> {
  await db.projects.clear();
  await db.mappingEntries.clear();
  await db.photos.clear();
  await db.syncQueue.clear();
  await db.users.clear();
  await db.floorPlans.clear();
  await db.floorPlanPoints.clear();
  await db.standaloneMaps.clear();
  await db.dropdownOptionsCache.clear();
  await db.productsCache.clear();
  // Keep metadata
  console.log('Database cleared');
}

// Get database statistics
export async function getDatabaseStats() {
  const [
    projectCount,
    mappingCount,
    photoCount,
    pendingSyncCount,
    userCount,
    floorPlanCount,
    floorPlanPointCount,
    standaloneMapCount
  ] = await Promise.all([
    db.projects.count(),
    db.mappingEntries.count(),
    db.photos.count(),
    db.syncQueue.where('synced').equals(0).count(),
    db.users.count(),
    db.floorPlans.count(),
    db.floorPlanPoints.count(),
    db.standaloneMaps.count()
  ]);

  // Calculate approximate storage size
  const photos = await db.photos.toArray();
  const totalPhotoSize = photos.reduce((sum, photo) => sum + photo.blob.size, 0);

  const floorPlans = await db.floorPlans.toArray();
  const totalFloorPlanSize = floorPlans.reduce((sum, fp) =>
    sum + fp.imageBlob.size + (fp.thumbnailBlob?.size || 0), 0
  );

  const standaloneMaps = await db.standaloneMaps.toArray();
  const totalStandaloneMapSize = standaloneMaps.reduce((sum, sm) =>
    sum + sm.imageBlob.size + (sm.thumbnailBlob?.size || 0), 0
  );

  return {
    projects: projectCount,
    mappingEntries: mappingCount,
    photos: photoCount,
    pendingSync: pendingSyncCount,
    users: userCount,
    floorPlans: floorPlanCount,
    floorPlanPoints: floorPlanPointCount,
    standaloneMaps: standaloneMapCount,
    photoStorageBytes: totalPhotoSize,
    photoStorageMB: (totalPhotoSize / (1024 * 1024)).toFixed(2),
    floorPlanStorageBytes: totalFloorPlanSize,
    floorPlanStorageMB: (totalFloorPlanSize / (1024 * 1024)).toFixed(2),
    standaloneMapStorageBytes: totalStandaloneMapSize,
    standaloneMapStorageMB: (totalStandaloneMapSize / (1024 * 1024)).toFixed(2),
    totalStorageBytes: totalPhotoSize + totalFloorPlanSize + totalStandaloneMapSize,
    totalStorageMB: ((totalPhotoSize + totalFloorPlanSize + totalStandaloneMapSize) / (1024 * 1024)).toFixed(2)
  };
}
