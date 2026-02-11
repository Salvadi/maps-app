// Main database exports
export * from './database';
export * from './projects';
export * from './mappings';
export * from './auth';
export * from './floorPlans';

// Re-export commonly used functions
export { db, initializeDatabase, clearDatabase, getDatabaseStats } from './database';
export { createProject, getProject, getAllProjects, getProjectsForUser, updateProject, deleteProject, archiveProject, unarchiveProject } from './projects';
export { createMappingEntry, getMappingEntry, getMappingEntriesForProject } from './mappings';
export { login, signUp, logout, getCurrentUser, isAdmin, initializeMockUsers, onAuthStateChange, sendPasswordResetEmail, updatePassword } from './auth';

// Floor Plans exports
export {
  createFloorPlan,
  getFloorPlan,
  getFloorPlanByProjectAndFloor,
  getFloorPlansByProject,
  updateFloorPlan,
  deleteFloorPlan,
  createFloorPlanPoint,
  getFloorPlanPoint,
  getFloorPlanPointByMappingEntry,
  getFloorPlanPoints,
  updateFloorPlanPoint,
  deleteFloorPlanPoint,
  updateFloorPlanLabelsForMapping,
  createStandaloneMap,
  getStandaloneMap,
  getStandaloneMaps,
  updateStandaloneMap,
  deleteStandaloneMap,
  hasFloorPlan,
  getFloorPlanBlobUrl,
  revokeFloorPlanBlobUrl
} from './floorPlans';

// Export floor plan types
export type { FloorPlan, FloorPlanPoint, StandaloneMap } from './database';
