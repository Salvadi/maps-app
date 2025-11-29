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
  createdAt: number; // timestamp
  updatedAt: number; // timestamp
  synced: number; // 0 = false, 1 = true (for Dexie indexing compatibility)
}

export interface Typology {
  id: string;
  number: number;
  supporto: string;
  tipoSupporto: string;
  attraversamento: string;
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
  tipologicoId?: string;
  notes?: string;
}

export interface MappingEntry {
  id: string; // UUID
  projectId: string;
  floor: string;
  roomOrIntervention: string;
  photos: PhotoMetadata[];
  crossings: Crossing[];
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
  entityType: 'project' | 'mapping_entry' | 'photo';
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

// Dexie database class
export class MappingDatabase extends Dexie {
  // Typed table properties
  projects!: Table<Project, string>;
  mappingEntries!: Table<MappingEntry, string>;
  photos!: Table<Photo, string>;
  syncQueue!: Table<SyncQueueItem, string>;
  users!: Table<User, string>;
  metadata!: Table<AppMetadata, string>;

  constructor() {
    super('MappingDatabase');

    // Define schema
    this.version(1).stores({
      projects: 'id, ownerId, *accessibleUsers, synced, updatedAt',
      mappingEntries: 'id, projectId, floor, createdBy, synced, timestamp',
      photos: 'id, mappingEntryId, uploaded',
      syncQueue: 'id, synced, timestamp, entityType, entityId',
      users: 'id, email, role',
      metadata: 'key'
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
    userCount
  ] = await Promise.all([
    db.projects.count(),
    db.mappingEntries.count(),
    db.photos.count(),
    db.syncQueue.where('synced').equals(0).count(),
    db.users.count()
  ]);

  // Calculate approximate storage size
  const photos = await db.photos.toArray();
  const totalPhotoSize = photos.reduce((sum, photo) => sum + photo.blob.size, 0);

  return {
    projects: projectCount,
    mappingEntries: mappingCount,
    photos: photoCount,
    pendingSync: pendingSyncCount,
    users: userCount,
    photoStorageBytes: totalPhotoSize,
    photoStorageMB: (totalPhotoSize / (1024 * 1024)).toFixed(2)
  };
}
