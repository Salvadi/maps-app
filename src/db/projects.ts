import { db, generateId, now, Project, ProjectCachePref, SyncQueueItem } from './database';
import { triggerImmediateUpload } from '../sync/syncEngine';
import { supabase } from '../lib/supabase';
import {
  applyPendingWrites,
  getPendingEntityIds,
  isAuthError,
  isOnlineAndConfigured,
  writeThroughCache,
} from './onlineFirst';
import { convertRemoteToLocalProject } from '../sync/conflictResolution';
import { getMappingEntriesForProject, getPhotosForMappings, ensurePhotoBlob } from './mappings';
import { getFloorPlansByProject, ensureFloorPlanAsset } from './floorPlans';

async function processInBatches<T>(
  items: T[],
  batchSize: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  for (let index = 0; index < items.length; index += batchSize) {
    const batch = items.slice(index, index + batchSize);
    await Promise.all(batch.map((item) => worker(item)));
  }
}

export async function createProject(
  projectData: Omit<Project, 'id' | 'createdAt' | 'updatedAt' | 'synced' | 'archived' | 'syncEnabled'>
): Promise<Project> {
  const project: Project = {
    ...projectData,
    id: generateId(),
    archived: 0,
    syncEnabled: 1,
    createdAt: now(),
    updatedAt: now(),
    version: 1,
    lastModified: now(),
    synced: 0,
  };

  try {
    await db.projects.add(project);

    const syncItem: SyncQueueItem = {
      id: generateId(),
      operation: 'CREATE',
      entityType: 'project',
      entityId: project.id,
      payload: project,
      timestamp: now(),
      retryCount: 0,
      synced: 0,
    };
    await db.syncQueue.add(syncItem);
    triggerImmediateUpload();

    return project;
  } catch (error) {
    console.error('Failed to create project:', error);
    throw error;
  }
}

export async function getProject(id: string): Promise<Project | undefined> {
  return db.projects.get(id);
}

function mergeProjectLocalFields(remote: Project, existing: Project | undefined): Project {
  return {
    ...remote,
    syncEnabled: existing?.syncEnabled ?? 1,
  };
}

export async function getProjectsForUser(userId: string): Promise<Project[]> {
  if (isOnlineAndConfigured()) {
    try {
      const { data: allProjects, error } = await supabase
        .from('projects')
        .select('*');

      if (error) {
        throw error;
      }

      const userProjects = (allProjects || []).filter((project: any) =>
        project.owner_id === userId ||
        (Array.isArray(project.accessible_users) && project.accessible_users.includes(userId))
      );

      const converted = userProjects.map(convertRemoteToLocalProject);
      const pendingIds = await getPendingEntityIds('project');
      const cached = await writeThroughCache(converted, pendingIds, db.projects, mergeProjectLocalFields);
      const withPending = await applyPendingWrites<Project>(cached, 'project', () => true);

      return withPending
        .filter((project) => project.ownerId === userId || (project.accessibleUsers || []).includes(userId))
        .sort((a, b) => b.updatedAt - a.updatedAt);
    } catch (err) {
      if (isAuthError(err)) {
        throw err;
      }
      console.warn('[online-first] getProjectsForUser fallback to IndexedDB', err);
    }
  }

  const projects = await db.projects
    .where('ownerId')
    .equals(userId)
    .or('accessibleUsers')
    .equals(userId)
    .sortBy('updatedAt');

  return projects.reverse();
}

export async function getAllProjects(): Promise<Project[]> {
  if (isOnlineAndConfigured()) {
    try {
      const { data: allProjects, error } = await supabase
        .from('projects')
        .select('*');

      if (error) {
        throw error;
      }

      const converted = (allProjects || []).map(convertRemoteToLocalProject);
      const pendingIds = await getPendingEntityIds('project');
      const cached = await writeThroughCache(converted, pendingIds, db.projects, mergeProjectLocalFields);
      const withPending = await applyPendingWrites<Project>(cached, 'project', () => true);
      return withPending.sort((a, b) => b.updatedAt - a.updatedAt);
    } catch (err) {
      if (isAuthError(err)) {
        throw err;
      }
      console.warn('[online-first] getAllProjects fallback to IndexedDB', err);
    }
  }

  return db.projects
    .orderBy('updatedAt')
    .reverse()
    .toArray();
}

export async function updateProject(
  id: string,
  updates: Partial<Omit<Project, 'id' | 'createdAt'>>
): Promise<Project> {
  const project = await db.projects.get(id);
  if (!project) {
    throw new Error(`Project not found: ${id}`);
  }

  const updatedProject: Project = {
    ...project,
    ...updates,
    updatedAt: now(),
    version: (project.version || 0) + 1,
    lastModified: now(),
    synced: 0,
  };

  try {
    await db.projects.put(updatedProject);

    const syncItem: SyncQueueItem = {
      id: generateId(),
      operation: 'UPDATE',
      entityType: 'project',
      entityId: id,
      payload: updatedProject,
      timestamp: now(),
      retryCount: 0,
      synced: 0,
    };
    await db.syncQueue.add(syncItem);
    triggerImmediateUpload();

    return updatedProject;
  } catch (error) {
    console.error('Failed to update project:', error);
    throw error;
  }
}

export async function deleteProject(id: string): Promise<void> {
  try {
    await db.transaction(
      'rw',
      [
        db.projects,
        db.mappingEntries,
        db.photos,
        db.floorPlans,
        db.floorPlanPoints,
        db.sals,
        db.typologyPrices,
        db.projectCachePrefs,
        db.syncQueue,
      ],
      async () => {
        const mappingEntries = await db.mappingEntries.where('projectId').equals(id).toArray();
        const mappingEntryIds = mappingEntries.map((entry) => entry.id);

        const photos = mappingEntryIds.length > 0
          ? await db.photos.where('mappingEntryId').anyOf(mappingEntryIds).toArray()
          : [];
        const photoIds = photos.map((photo) => photo.id);

        const floorPlans = await db.floorPlans.where('projectId').equals(id).toArray();
        const floorPlanIds = floorPlans.map((floorPlan) => floorPlan.id);

        const floorPlanPoints = floorPlanIds.length > 0
          ? await db.floorPlanPoints.where('floorPlanId').anyOf(floorPlanIds).toArray()
          : [];
        const floorPlanPointIds = floorPlanPoints.map((point) => point.id);

        const sals = await db.sals.where('projectId').equals(id).toArray();
        const salIds = sals.map((sal) => sal.id);

        const typologyPrices = await db.typologyPrices.where('projectId').equals(id).toArray();
        const typologyPriceIds = typologyPrices.map((price) => price.id);

        const queueItems = await db.syncQueue.where('synced').equals(0).toArray();
        const hadPendingProjectCreate = queueItems.some(
          (item) =>
            item.entityType === 'project' &&
            item.entityId === id &&
            item.operation === 'CREATE'
        );

        const queueIdsToRemove = queueItems
          .filter((item) => {
            if (item.entityType === 'project' && item.entityId === id) {
              return true;
            }
            if (item.entityType === 'mapping_entry' && mappingEntryIds.includes(item.entityId)) {
              return true;
            }
            if (
              item.entityType === 'photo' &&
              (photoIds.includes(item.entityId) ||
                mappingEntryIds.includes((item.payload as { mappingEntryId?: string })?.mappingEntryId || ''))
            ) {
              return true;
            }
            if (item.entityType === 'floor_plan' && floorPlanIds.includes(item.entityId)) {
              return true;
            }
            if (
              item.entityType === 'floor_plan_point' &&
              (floorPlanPointIds.includes(item.entityId) ||
                floorPlanIds.includes((item.payload as { floorPlanId?: string })?.floorPlanId || ''))
            ) {
              return true;
            }
            if (item.entityType === 'sal' && salIds.includes(item.entityId)) {
              return true;
            }
            if (item.entityType === 'typology_price' && typologyPriceIds.includes(item.entityId)) {
              return true;
            }
            return false;
          })
          .map((item) => item.id);

        if (queueIdsToRemove.length > 0) {
          await db.syncQueue.bulkDelete(queueIdsToRemove);
        }

        if (photoIds.length > 0) {
          await db.photos.bulkDelete(photoIds);
        }
        if (mappingEntryIds.length > 0) {
          await db.mappingEntries.bulkDelete(mappingEntryIds);
        }
        if (floorPlanPointIds.length > 0) {
          await db.floorPlanPoints.bulkDelete(floorPlanPointIds);
        }
        if (floorPlanIds.length > 0) {
          await db.floorPlans.bulkDelete(floorPlanIds);
        }
        if (salIds.length > 0) {
          await db.sals.bulkDelete(salIds);
        }
        if (typologyPriceIds.length > 0) {
          await db.typologyPrices.bulkDelete(typologyPriceIds);
        }

        await db.projectCachePrefs.delete(id);
        await db.projects.delete(id);

        if (!hadPendingProjectCreate) {
          const syncItem: SyncQueueItem = {
            id: generateId(),
            operation: 'DELETE',
            entityType: 'project',
            entityId: id,
            payload: { id },
            timestamp: now(),
            retryCount: 0,
            synced: 0,
          };
          await db.syncQueue.add(syncItem);
        }
      }
    );

    triggerImmediateUpload();
  } catch (error) {
    console.error('Failed to delete project:', error);
    throw error;
  }
}

export async function searchProjects(
  userId: string,
  query: string
): Promise<Project[]> {
  const lowerQuery = query.toLowerCase();
  const projects = await getProjectsForUser(userId);

  return projects.filter((project) =>
    project.title.toLowerCase().includes(lowerQuery) ||
    project.client.toLowerCase().includes(lowerQuery) ||
    project.address.toLowerCase().includes(lowerQuery)
  );
}

export async function getUnsyncedProjects(): Promise<Project[]> {
  return db.projects.where('synced').equals(0).toArray();
}

export async function getProjectCachePref(projectId: string): Promise<ProjectCachePref | undefined> {
  return db.projectCachePrefs.get(projectId);
}

export async function setProjectOfflinePinned(
  projectId: string,
  offlinePinned: boolean
): Promise<ProjectCachePref> {
  const existing = await db.projectCachePrefs.get(projectId);
  const cachePref: ProjectCachePref = {
    projectId,
    offlinePinned: offlinePinned ? 1 : 0,
    lastHydratedAt: existing?.lastHydratedAt,
    updatedAt: now(),
  };

  await db.projectCachePrefs.put(cachePref);
  return cachePref;
}

export async function hydrateProjectForOffline(projectId: string): Promise<ProjectCachePref> {
  const mappings = await getMappingEntriesForProject(projectId);
  const mappingIds = mappings.map((mapping) => mapping.id);

  if (mappingIds.length > 0) {
    const groupedPhotos = await getPhotosForMappings(mappingIds);
    const allPhotos = Object.values(groupedPhotos).flat();
    await processInBatches(allPhotos, 8, async (photo) => {
      await ensurePhotoBlob(photo.id);
    });
  }

  const floorPlans = await getFloorPlansByProject(projectId);
  for (const floorPlan of floorPlans) {
    await ensureFloorPlanAsset(floorPlan.id, 'thumbnail');
    await ensureFloorPlanAsset(floorPlan.id, 'full');
    await ensureFloorPlanAsset(floorPlan.id, 'pdf');
  }

  const hydratedAt = now();
  const cachePref: ProjectCachePref = {
    projectId,
    offlinePinned: 1,
    lastHydratedAt: hydratedAt,
    updatedAt: hydratedAt,
  };

  await db.projectCachePrefs.put(cachePref);
  return cachePref;
}

export async function markProjectSynced(id: string): Promise<void> {
  await db.projects.update(id, { synced: 1 });
}

export async function archiveProject(id: string): Promise<Project> {
  return updateProject(id, { archived: 1 });
}

export async function unarchiveProject(id: string): Promise<Project> {
  return updateProject(id, { archived: 0 });
}
