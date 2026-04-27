// Main database exports
export * from './database';
export * from './projects';
export * from './mappings';
export * from './structures';
export * from './auth';
export * from './floorPlans';

// Re-export commonly used functions
export { db, initializeDatabase, clearDatabase, getDatabaseStats } from './database';
export {
  createProject,
  getProject,
  getAllProjects,
  getProjectsForUser,
  updateProject,
  deleteProject,
  archiveProject,
  unarchiveProject,
  getProjectCachePref,
  setProjectOfflinePinned,
  hydrateProjectForOffline,
} from './projects';
export { createMappingEntry, getMappingEntry, getMappingEntriesForProject, updateMappingEntry, deleteMappingEntry, getPhotosForMapping, getPhotosForMappings, ensurePhotoBlob, addPhotosToMapping, removePhotoFromMapping } from './mappings';
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
  getFloorPlanPointsForPlans,
  updateFloorPlanPoint,
  deleteFloorPlanPoint,
  ensureFloorPlanAsset,
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

// Dropdown options exports
export { getDropdownOptions, getProductsByBrand, getBrandOptions, refreshDropdownCaches } from './dropdownOptions';

// Pricing exports
export { getTypologyPrices, upsertTypologyPrice, deleteTypologyPrice } from './pricing';
export type { TypologyPrice } from './database';

// SAL exports
export { getSalsForProject, createSal, updateSal, deleteSal, assignCrossingsToSal, assignStructuresToSal } from './sal';
export type { Sal } from './database';

// Structures exports
export {
  createStructureEntry,
  getStructureEntry,
  getStructureEntriesForProject,
  updateStructureEntry,
  deleteStructureEntry,
  getPhotosForStructure,
  addPhotosToStructure,
  removePhotoFromStructure,
  getStructureCountForProject,
  convertRemoteToLocalStructure,
} from './structures';
export type { Structure, StructureEntry } from './database';
