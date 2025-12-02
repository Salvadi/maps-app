import { db, generateId, now, Project, SyncQueueItem } from './database';

/**
 * Create a new project
 */
export async function createProject(
  projectData: Omit<Project, 'id' | 'createdAt' | 'updatedAt' | 'synced' | 'archived'>
): Promise<Project> {
  const project: Project = {
    ...projectData,
    id: generateId(),
    archived: 0,
    createdAt: now(),
    updatedAt: now(),
    synced: 0
  };

  try {
    await db.projects.add(project);

    // Add to sync queue
    const syncItem: SyncQueueItem = {
      id: generateId(),
      operation: 'CREATE',
      entityType: 'project',
      entityId: project.id,
      payload: project,
      timestamp: now(),
      retryCount: 0,
      synced: 0
    };
    await db.syncQueue.add(syncItem);

    console.log('Project created:', project.id);
    return project;
  } catch (error) {
    console.error('Failed to create project:', error);
    throw error;
  }
}

/**
 * Get a project by ID
 */
export async function getProject(id: string): Promise<Project | undefined> {
  return await db.projects.get(id);
}

/**
 * Get all projects for a user
 */
export async function getProjectsForUser(userId: string): Promise<Project[]> {
  return await db.projects
    .where('ownerId')
    .equals(userId)
    .or('accessibleUsers')
    .equals(userId)
    .sortBy('updatedAt');
}

/**
 * Get all projects (for admin)
 */
export async function getAllProjects(): Promise<Project[]> {
  return await db.projects
    .orderBy('updatedAt')
    .reverse()
    .toArray();
}

/**
 * Update a project
 */
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
    synced: 0
  };

  try {
    await db.projects.put(updatedProject);

    // Add to sync queue
    const syncItem: SyncQueueItem = {
      id: generateId(),
      operation: 'UPDATE',
      entityType: 'project',
      entityId: id,
      payload: updatedProject,
      timestamp: now(),
      retryCount: 0,
      synced: 0
    };
    await db.syncQueue.add(syncItem);

    console.log('Project updated:', id);
    return updatedProject;
  } catch (error) {
    console.error('Failed to update project:', error);
    throw error;
  }
}

/**
 * Delete a project and all associated mapping entries
 */
export async function deleteProject(id: string): Promise<void> {
  try {
    // Delete project
    await db.projects.delete(id);

    // Delete all associated mapping entries
    const mappingEntries = await db.mappingEntries
      .where('projectId')
      .equals(id)
      .toArray();

    for (const entry of mappingEntries) {
      // Delete photos associated with this mapping entry
      await db.photos.where('mappingEntryId').equals(entry.id).delete();
      // Delete the mapping entry
      await db.mappingEntries.delete(entry.id);
    }

    // Add to sync queue
    const syncItem: SyncQueueItem = {
      id: generateId(),
      operation: 'DELETE',
      entityType: 'project',
      entityId: id,
      payload: { id },
      timestamp: now(),
      retryCount: 0,
      synced: 0
    };
    await db.syncQueue.add(syncItem);

    console.log('Project deleted:', id);
  } catch (error) {
    console.error('Failed to delete project:', error);
    throw error;
  }
}

/**
 * Search projects by title, client, or address
 */
export async function searchProjects(query: string): Promise<Project[]> {
  const lowerQuery = query.toLowerCase();
  const projects = await db.projects.toArray();

  return projects.filter(project =>
    project.title.toLowerCase().includes(lowerQuery) ||
    project.client.toLowerCase().includes(lowerQuery) ||
    project.address.toLowerCase().includes(lowerQuery)
  );
}

/**
 * Get unsynced projects
 */
export async function getUnsyncedProjects(): Promise<Project[]> {
  return await db.projects
    .where('synced')
    .equals(0)
    .toArray();
}

/**
 * Mark project as synced
 */
export async function markProjectSynced(id: string): Promise<void> {
  await db.projects.update(id, { synced: 1 });
}

/**
 * Archive a project
 */
export async function archiveProject(id: string): Promise<Project> {
  return await updateProject(id, { archived: 1 });
}

/**
 * Unarchive a project
 */
export async function unarchiveProject(id: string): Promise<Project> {
  return await updateProject(id, { archived: 0 });
}
