// Main database exports
export * from './database';
export * from './projects';
export * from './mappings';
export * from './auth';

// Re-export commonly used functions
export { db, initializeDatabase, clearDatabase, getDatabaseStats } from './database';
export { createProject, getProject, getAllProjects, getProjectsForUser, updateProject, deleteProject } from './projects';
export { createMappingEntry, getMappingEntry, getMappingEntriesForProject } from './mappings';
export { login, signUp, logout, getCurrentUser, isAdmin, initializeMockUsers, onAuthStateChange } from './auth';
