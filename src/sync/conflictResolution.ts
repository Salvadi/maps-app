import { db, MappingEntry, Project, ConflictHistory, generateId } from '../db/database';
import { supabase } from '../lib/supabase';

/**
 * Conflict Resolution for Phase 3
 *
 * Handles conflicts when local and remote data diverge
 * Uses version numbers and timestamps for conflict detection
 * Enhanced with conflict logging and improved merge strategies
 */

export interface ConflictInfo<T> {
  localVersion: T;
  remoteVersion: T;
  conflictType: 'version' | 'timestamp' | 'both';
}

export type ConflictResolutionStrategy = 'local-wins' | 'remote-wins' | 'last-modified-wins' | 'merge';

/**
 * Log a conflict to the conflict history table for user awareness and audit
 */
async function logConflict(
  entityType: 'project' | 'mapping_entry',
  entityId: string,
  conflictType: 'version' | 'timestamp' | 'both',
  localVersion: any,
  remoteVersion: any,
  resolvedVersion: any,
  strategy: ConflictResolutionStrategy,
  autoResolved: boolean = true
): Promise<void> {
  const conflictRecord: ConflictHistory = {
    id: generateId(),
    timestamp: Date.now(),
    entityType,
    entityId,
    conflictType,
    localVersion,
    remoteVersion,
    resolvedVersion,
    strategy,
    autoResolved,
    userNotified: false
  };

  await db.conflictHistory.add(conflictRecord);
  console.log(`📝 Conflict logged: ${entityType} ${entityId} - ${strategy}`);
}

/**
 * Detect if a conflict exists between local and remote versions
 */
export function detectConflict<T extends { version: number; lastModified: number }>(
  local: T,
  remote: T
): ConflictInfo<T> | null {
  const versionConflict = local.version !== remote.version;
  const timestampConflict = local.lastModified !== remote.lastModified;

  if (!versionConflict && !timestampConflict) {
    return null; // No conflict
  }

  return {
    localVersion: local,
    remoteVersion: remote,
    conflictType: versionConflict && timestampConflict
      ? 'both'
      : versionConflict
      ? 'version'
      : 'timestamp'
  };
}

/**
 * Resolve a mapping entry conflict
 */
export async function resolveMappingEntryConflict(
  localEntry: MappingEntry,
  remoteEntry: any,
  strategy: ConflictResolutionStrategy = 'last-modified-wins'
): Promise<MappingEntry> {
  console.log(`🔀 Resolving conflict for mapping entry ${localEntry.id} using strategy: ${strategy}`);

  // Detect conflict type
  const versionConflict = localEntry.version !== remoteEntry.version;
  const timestampConflict = localEntry.lastModified !== remoteEntry.last_modified;
  const conflictType: 'version' | 'timestamp' | 'both' =
    versionConflict && timestampConflict ? 'both' : versionConflict ? 'version' : 'timestamp';

  let resolved: MappingEntry;

  switch (strategy) {
    case 'local-wins':
      console.log('✅ Conflict resolved: local wins');
      resolved = localEntry;
      break;

    case 'remote-wins':
      console.log('✅ Conflict resolved: remote wins');
      // Convert remote format to local format
      resolved = convertRemoteToLocalMapping(remoteEntry);
      break;

    case 'last-modified-wins':
      // Compare timestamps
      if (localEntry.lastModified > remoteEntry.last_modified) {
        console.log('✅ Conflict resolved: local is newer');
        resolved = localEntry;
      } else {
        console.log('✅ Conflict resolved: remote is newer');
        resolved = convertRemoteToLocalMapping(remoteEntry);
      }
      break;

    case 'merge':
      // Merge strategy - keep newer fields
      console.log('✅ Conflict resolved: merging fields');
      resolved = mergeMappingEntries(localEntry, remoteEntry);
      break;

    default:
      // Default to last-modified-wins
      return resolveMappingEntryConflict(localEntry, remoteEntry, 'last-modified-wins');
  }

  // Log conflict for audit and user notification
  await logConflict('mapping_entry', localEntry.id, conflictType, localEntry, remoteEntry, resolved, strategy);

  return resolved;
}

/**
 * Resolve a project conflict
 */
export async function resolveProjectConflict(
  localProject: Project,
  remoteProject: any,
  strategy: ConflictResolutionStrategy = 'last-modified-wins'
): Promise<Project> {
  console.log(`🔀 Resolving conflict for project ${localProject.id} using strategy: ${strategy}`);

  // Detect conflict type
  const versionConflict = (localProject.version || 1) !== (remoteProject.version || 1);
  const timestampConflict = localProject.updatedAt !== new Date(remoteProject.updated_at).getTime();
  const conflictType: 'version' | 'timestamp' | 'both' =
    versionConflict && timestampConflict ? 'both' : versionConflict ? 'version' : 'timestamp';

  let resolved: Project;

  switch (strategy) {
    case 'local-wins':
      console.log('✅ Conflict resolved: local wins');
      resolved = localProject;
      break;

    case 'remote-wins':
      console.log('✅ Conflict resolved: remote wins');
      resolved = convertRemoteToLocalProject(remoteProject);
      break;

    case 'last-modified-wins':
      const localTime = localProject.updatedAt;
      const remoteTime = new Date(remoteProject.updated_at).getTime();

      if (localTime > remoteTime) {
        console.log('✅ Conflict resolved: local is newer');
        resolved = localProject;
      } else {
        console.log('✅ Conflict resolved: remote is newer');
        resolved = convertRemoteToLocalProject(remoteProject);
      }
      break;

    case 'merge':
      console.log('✅ Conflict resolved: merging fields');
      resolved = mergeProjects(localProject, remoteProject);
      break;

    default:
      return resolveProjectConflict(localProject, remoteProject, 'last-modified-wins');
  }

  // Log conflict for audit and user notification
  await logConflict('project', localProject.id, conflictType, localProject, remoteProject, resolved, strategy);

  return resolved;
}

/**
 * Convert remote mapping entry to local format
 */
function convertRemoteToLocalMapping(remote: any): MappingEntry {
  return {
    id: remote.id,
    projectId: remote.project_id,
    floor: remote.floor,
    room: remote.room || undefined,
    intervention: remote.intervention || undefined,
    crossings: remote.crossings || [],
    timestamp: remote.timestamp,
    lastModified: remote.last_modified,
    version: remote.version,
    createdBy: remote.created_by,
    modifiedBy: remote.modified_by,
    photos: remote.photos || [],
    synced: 1
  };
}

/**
 * Convert remote project to local format
 */
function convertRemoteToLocalProject(remote: any): Project {
  return {
    id: remote.id,
    title: remote.title,
    client: remote.client || '',
    address: remote.address || '',
    notes: remote.notes || '',
    floors: remote.floors || [],
    plans: remote.plans || [],
    useRoomNumbering: remote.use_room_numbering || false,
    useInterventionNumbering: remote.use_intervention_numbering || false,
    typologies: remote.typologies || [],
    ownerId: remote.owner_id,
    accessibleUsers: remote.accessible_users || [],
    archived: remote.archived || 0,
    syncEnabled: 0, // Default to 0 for remote projects (per-device preference, not synced)
    createdAt: new Date(remote.created_at).getTime(),
    updatedAt: new Date(remote.updated_at).getTime(),
    version: remote.version || 1, // Add version for conflict detection
    lastModified: remote.last_modified || new Date(remote.updated_at).getTime(), // Add lastModified
    synced: 1
  };
}

/**
 * Merge two mapping entries (field-level merge)
 * Enhanced with better crossing comparison
 */
function mergeMappingEntries(local: MappingEntry, remote: any): MappingEntry {
  // Start with the newer version as base
  const base = local.lastModified > remote.last_modified ? local : convertRemoteToLocalMapping(remote);

  // Merge photos arrays (combine unique photos)
  const localPhotoIds = new Set(local.photos.map(p => p.id));
  const remotePhotos = (remote.photos || []).filter((p: any) => !localPhotoIds.has(p.id));
  const mergedPhotos = [...local.photos, ...remotePhotos];

  // Merge crossings with improved comparison (all significant fields)
  const mergedCrossings = [...local.crossings];
  for (const remoteCrossing of remote.crossings || []) {
    // Check if crossing exists with same core identity
    const existingIndex = mergedCrossings.findIndex(c =>
      c.id === remoteCrossing.id ||
      (c.supporto === remoteCrossing.supporto &&
       c.tipoSupporto === remoteCrossing.tipoSupporto &&
       c.attraversamento === remoteCrossing.attraversamento)
    );

    if (existingIndex === -1) {
      // New crossing, add it
      mergedCrossings.push(remoteCrossing);
    } else {
      // Crossing exists, merge fields if they differ
      const existing = mergedCrossings[existingIndex];
      const hasChanges =
        existing.quantita !== remoteCrossing.quantita ||
        existing.diametro !== remoteCrossing.diametro ||
        existing.dimensioni !== remoteCrossing.dimensioni ||
        existing.notes !== remoteCrossing.notes ||
        existing.tipologicoId !== remoteCrossing.tipologicoId;

      if (hasChanges) {
        // Keep the newer version's details based on parent entry timestamp
        if (remote.last_modified > local.lastModified) {
          mergedCrossings[existingIndex] = remoteCrossing;
        }
        // Otherwise keep local version (already in array)
      }
    }
  }

  return {
    ...base,
    photos: mergedPhotos,
    crossings: mergedCrossings,
    version: Math.max(local.version, remote.version) + 1, // Increment version
    lastModified: Date.now(), // Update to current time
    modifiedBy: local.modifiedBy // Keep local modifier
  };
}

/**
 * Merge two projects (field-level merge)
 */
function mergeProjects(local: Project, remote: any): Project {
  // Start with the newer version as base
  const base = local.updatedAt > new Date(remote.updated_at).getTime()
    ? local
    : convertRemoteToLocalProject(remote);

  // Merge floors (combine unique)
  const mergedFloors = Array.from(new Set([...local.floors, ...(remote.floors || [])]));

  // Merge plans (combine unique)
  const mergedPlans = Array.from(new Set([...local.plans, ...(remote.plans || [])]));

  // Merge typologies (combine unique by id)
  const typologyMap = new Map();
  for (const typ of local.typologies) {
    typologyMap.set(typ.id, typ);
  }
  for (const typ of remote.typologies || []) {
    if (!typologyMap.has(typ.id)) {
      typologyMap.set(typ.id, typ);
    }
  }
  const mergedTypologies = Array.from(typologyMap.values());

  // Merge accessible users (combine unique)
  const mergedUsers = Array.from(new Set([
    ...local.accessibleUsers,
    ...(remote.accessible_users || [])
  ]));

  return {
    ...base,
    floors: mergedFloors,
    plans: mergedPlans,
    typologies: mergedTypologies,
    accessibleUsers: mergedUsers,
    updatedAt: Date.now(), // Update to current time
    version: Math.max(local.version || 1, remote.version || 1) + 1, // Increment version after merge
    lastModified: Date.now() // Update to current time
  };
}

/**
 * Check for conflicts before syncing
 * Fetches remote version and compares with local
 */
export async function checkForConflicts(
  entityType: 'project' | 'mapping',
  entityId: string
): Promise<{ hasConflict: boolean; remote: any | null }> {
  try {
    if (entityType === 'project') {
      const { data: remote, error } = await supabase
        .from('projects')
        .select('*')
        .eq('id', entityId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          // Not found - no conflict
          return { hasConflict: false, remote: null };
        }
        throw error;
      }

      const local = await db.projects.get(entityId);
      if (!local) {
        return { hasConflict: false, remote };
      }

      // Compare versions
      const remoteTime = new Date(remote.updated_at).getTime();
      const hasConflict = local.updatedAt !== remoteTime;

      return { hasConflict, remote };
    } else {
      const { data: remote, error } = await supabase
        .from('mapping_entries')
        .select('*')
        .eq('id', entityId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return { hasConflict: false, remote: null };
        }
        throw error;
      }

      const local = await db.mappingEntries.get(entityId);
      if (!local) {
        return { hasConflict: false, remote };
      }

      const hasConflict = local.version !== remote.version ||
                         local.lastModified !== remote.last_modified;

      return { hasConflict, remote };
    }
  } catch (err) {
    console.error('Error checking for conflicts:', err);
    return { hasConflict: false, remote: null };
  }
}

/**
 * Apply conflict resolution and update local database
 */
export async function applyConflictResolution(
  entityType: 'project' | 'mapping',
  entityId: string,
  strategy: ConflictResolutionStrategy = 'last-modified-wins'
): Promise<void> {
  const { hasConflict, remote } = await checkForConflicts(entityType, entityId);

  if (!hasConflict || !remote) {
    console.log(`No conflict for ${entityType} ${entityId}`);
    return;
  }

  if (entityType === 'project') {
    const local = await db.projects.get(entityId);
    if (!local) return;

    const resolved = await resolveProjectConflict(local, remote, strategy);
    await db.projects.put(resolved);

    console.log(`✅ Project ${entityId} conflict resolved and updated locally`);
  } else {
    const local = await db.mappingEntries.get(entityId);
    if (!local) return;

    const resolved = await resolveMappingEntryConflict(local, remote, strategy);
    await db.mappingEntries.put(resolved);

    console.log(`✅ Mapping entry ${entityId} conflict resolved and updated locally`);
  }
}
