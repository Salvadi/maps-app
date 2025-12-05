// Main database exports
export * from './database';
export * from './projects';
export * from './mappings';
export * from './auth';
export * from './planimetries';

// Re-export commonly used functions
export { db, initializeDatabase, clearDatabase, getDatabaseStats } from './database';
export { createProject, getProject, getAllProjects, getProjectsForUser, updateProject, deleteProject, archiveProject, unarchiveProject } from './projects';
export { createMappingEntry, getMappingEntry, getMappingEntriesForProject } from './mappings';
export { login, signUp, logout, getCurrentUser, isAdmin, initializeMockUsers, onAuthStateChange, sendPasswordResetEmail, updatePassword } from './auth';
export {
  createPlanimetry,
  getPlanimetry,
  getPlanimetriesByProject,
  getPlanimetryByProjectAndFloor,
  updatePlanimetry,
  deletePlanimetry,
  addPlanimetryPoint,
  getPlanimetryPoints,
  updatePlanimetryPoint,
  deletePlanimetryPoint,
  addPlanimetryLine,
  getPlanimetryLines,
  deletePlanimetryLine,
  savePlanimetryWithData,
  getFullPlanimetry,
  hasPlanimetryForFloor,
  getPlanimetryCount
} from './planimetries';
