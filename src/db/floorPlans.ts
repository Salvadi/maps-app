/**
 * Floor Plan Database Operations
 * CRUD operations for floor plans, floor plan points, and standalone maps
 */

import { db, generateId, now, FloorPlan, FloorPlanPoint, StandaloneMap } from './database';
import { processFloorPlan, uploadStandaloneMap } from '../utils/floorPlanUtils';

// ============================================
// FLOOR PLANS
// ============================================

/**
 * Create a new floor plan
 */
export async function createFloorPlan(
  projectId: string,
  floor: string,
  file: File,
  userId: string
): Promise<FloorPlan> {
  try {
    // Process the floor plan file (convert to PNG 2x, generate thumbnail)
    const { fullRes, thumbnail, width, height, originalFormat } = await processFloorPlan(file);

    const floorPlan: FloorPlan = {
      id: generateId(),
      projectId,
      floor,
      imageBlob: fullRes,
      thumbnailBlob: thumbnail,
      originalFilename: file.name,
      originalFormat,
      width,
      height,
      createdBy: userId,
      createdAt: now(),
      updatedAt: now(),
      synced: 0, // Not synced yet
    };

    await db.floorPlans.add(floorPlan);

    // Add to sync queue
    await db.syncQueue.add({
      id: generateId(),
      operation: 'CREATE',
      entityType: 'floor_plan',
      entityId: floorPlan.id,
      payload: floorPlan,
      timestamp: now(),
      retryCount: 0,
      synced: 0,
    });

    console.log('Floor plan created:', floorPlan.id);
    return floorPlan;
  } catch (error) {
    console.error('Error creating floor plan:', error);
    throw error;
  }
}

/**
 * Get floor plan by ID
 */
export async function getFloorPlan(id: string): Promise<FloorPlan | undefined> {
  return await db.floorPlans.get(id);
}

/**
 * Get floor plan for a specific project and floor
 */
export async function getFloorPlanByProjectAndFloor(
  projectId: string,
  floor: string
): Promise<FloorPlan | undefined> {
  return await db.floorPlans
    .where('[projectId+floor]')
    .equals([projectId, floor])
    .first();
}

/**
 * Get all floor plans for a project
 */
export async function getFloorPlansByProject(projectId: string): Promise<FloorPlan[]> {
  return await db.floorPlans.where('projectId').equals(projectId).toArray();
}

/**
 * Update floor plan
 */
export async function updateFloorPlan(
  id: string,
  updates: Partial<FloorPlan>
): Promise<void> {
  try {
    await db.floorPlans.update(id, {
      ...updates,
      updatedAt: now(),
      synced: 0, // Mark as not synced
    });

    const floorPlan = await db.floorPlans.get(id);
    if (floorPlan) {
      // Add to sync queue
      await db.syncQueue.add({
        id: generateId(),
        operation: 'UPDATE',
        entityType: 'floor_plan',
        entityId: id,
        payload: floorPlan,
        timestamp: now(),
        retryCount: 0,
        synced: 0,
      });
    }

    console.log('Floor plan updated:', id);
  } catch (error) {
    console.error('Error updating floor plan:', error);
    throw error;
  }
}

/**
 * Delete floor plan
 */
export async function deleteFloorPlan(id: string): Promise<void> {
  try {
    const floorPlan = await db.floorPlans.get(id);
    if (!floorPlan) {
      throw new Error('Floor plan not found');
    }

    // Delete associated points
    await db.floorPlanPoints.where('floorPlanId').equals(id).delete();

    // Delete from database
    await db.floorPlans.delete(id);

    // Add to sync queue for deletion
    await db.syncQueue.add({
      id: generateId(),
      operation: 'DELETE',
      entityType: 'floor_plan',
      entityId: id,
      payload: { id },
      timestamp: now(),
      retryCount: 0,
      synced: 0,
    });

    console.log('Floor plan deleted:', id);
  } catch (error) {
    console.error('Error deleting floor plan:', error);
    throw error;
  }
}

// ============================================
// FLOOR PLAN POINTS
// ============================================

/**
 * Create a new floor plan point
 */
export async function createFloorPlanPoint(
  floorPlanId: string,
  mappingEntryId: string,
  pointType: 'parete' | 'solaio' | 'perimetro' | 'generico',
  pointX: number,
  pointY: number,
  labelX: number,
  labelY: number,
  userId: string,
  options?: {
    perimeterPoints?: Array<{ x: number; y: number }>;
    customText?: string;
    metadata?: Record<string, any>;
  }
): Promise<FloorPlanPoint> {
  try {
    const point: FloorPlanPoint = {
      id: generateId(),
      floorPlanId,
      mappingEntryId,
      pointType,
      pointX,
      pointY,
      labelX,
      labelY,
      perimeterPoints: options?.perimeterPoints,
      customText: options?.customText,
      metadata: options?.metadata,
      createdBy: userId,
      createdAt: now(),
      updatedAt: now(),
      synced: 0,
    };

    await db.floorPlanPoints.add(point);

    // Add to sync queue
    await db.syncQueue.add({
      id: generateId(),
      operation: 'CREATE',
      entityType: 'floor_plan_point',
      entityId: point.id,
      payload: point,
      timestamp: now(),
      retryCount: 0,
      synced: 0,
    });

    console.log('Floor plan point created:', point.id);
    return point;
  } catch (error) {
    console.error('Error creating floor plan point:', error);
    throw error;
  }
}

/**
 * Get floor plan point by ID
 */
export async function getFloorPlanPoint(id: string): Promise<FloorPlanPoint | undefined> {
  return await db.floorPlanPoints.get(id);
}

/**
 * Get floor plan point by mapping entry ID
 */
export async function getFloorPlanPointByMappingEntry(
  mappingEntryId: string
): Promise<FloorPlanPoint | undefined> {
  return await db.floorPlanPoints.where('mappingEntryId').equals(mappingEntryId).first();
}

/**
 * Get all points for a floor plan
 */
export async function getFloorPlanPoints(floorPlanId: string): Promise<FloorPlanPoint[]> {
  return await db.floorPlanPoints.where('floorPlanId').equals(floorPlanId).toArray();
}

/**
 * Update floor plan point
 */
export async function updateFloorPlanPoint(
  id: string,
  updates: Partial<FloorPlanPoint>
): Promise<void> {
  try {
    await db.floorPlanPoints.update(id, {
      ...updates,
      updatedAt: now(),
      synced: 0,
    });

    const point = await db.floorPlanPoints.get(id);
    if (point) {
      // Add to sync queue
      await db.syncQueue.add({
        id: generateId(),
        operation: 'UPDATE',
        entityType: 'floor_plan_point',
        entityId: id,
        payload: point,
        timestamp: now(),
        retryCount: 0,
        synced: 0,
      });
    }

    console.log('Floor plan point updated:', id);
  } catch (error) {
    console.error('Error updating floor plan point:', error);
    throw error;
  }
}

/**
 * Delete floor plan point
 */
export async function deleteFloorPlanPoint(id: string): Promise<void> {
  try {
    await db.floorPlanPoints.delete(id);

    // Add to sync queue
    await db.syncQueue.add({
      id: generateId(),
      operation: 'DELETE',
      entityType: 'floor_plan_point',
      entityId: id,
      payload: { id },
      timestamp: now(),
      retryCount: 0,
      synced: 0,
    });

    console.log('Floor plan point deleted:', id);
  } catch (error) {
    console.error('Error deleting floor plan point:', error);
    throw error;
  }
}

// ============================================
// STANDALONE MAPS
// ============================================

/**
 * Create a new standalone map
 */
export async function createStandaloneMap(
  userId: string,
  name: string,
  file: File,
  description?: string
): Promise<StandaloneMap> {
  try {
    const { fullRes, thumbnail, width, height } = await processFloorPlan(file);

    const mapId = generateId();

    // Upload to Supabase Storage
    let imageUrl: string | undefined;
    let thumbnailUrl: string | undefined;

    try {
      const urls = await uploadStandaloneMap(mapId, fullRes, thumbnail, userId);
      imageUrl = urls.fullResUrl;
      thumbnailUrl = urls.thumbnailUrl;
      console.log('Standalone map uploaded to Supabase Storage:', mapId);
    } catch (uploadError) {
      console.warn('Failed to upload to Supabase Storage, saving locally only:', uploadError);
      // Continue anyway - will be stored locally and synced later
    }

    const map: StandaloneMap = {
      id: mapId,
      userId,
      name,
      description,
      imageBlob: fullRes,
      thumbnailBlob: thumbnail,
      imageUrl,
      thumbnailUrl,
      originalFilename: file.name,
      width,
      height,
      points: [],
      gridEnabled: false,
      gridConfig: {
        rows: 10,
        cols: 10,
        offsetX: 0,
        offsetY: 0,
      },
      createdAt: now(),
      updatedAt: now(),
      synced: imageUrl ? 1 : 0, // Mark as synced if uploaded successfully
    };

    await db.standaloneMaps.add(map);

    // Add to sync queue only if upload failed
    if (!imageUrl) {
      await db.syncQueue.add({
        id: generateId(),
        operation: 'CREATE',
        entityType: 'standalone_map',
        entityId: map.id,
        payload: map,
        timestamp: now(),
        retryCount: 0,
        synced: 0,
      });
    }

    console.log('Standalone map created:', map.id);
    return map;
  } catch (error) {
    console.error('Error creating standalone map:', error);
    throw error;
  }
}

/**
 * Get standalone map by ID
 */
export async function getStandaloneMap(id: string): Promise<StandaloneMap | undefined> {
  return await db.standaloneMaps.get(id);
}

/**
 * Get all standalone maps for a user
 */
export async function getStandaloneMaps(userId: string): Promise<StandaloneMap[]> {
  return await db.standaloneMaps.where('userId').equals(userId).toArray();
}

/**
 * Update standalone map
 */
export async function updateStandaloneMap(
  id: string,
  updates: Partial<StandaloneMap>
): Promise<void> {
  try {
    await db.standaloneMaps.update(id, {
      ...updates,
      updatedAt: now(),
      synced: 0,
    });

    const map = await db.standaloneMaps.get(id);
    if (map) {
      // Add to sync queue
      await db.syncQueue.add({
        id: generateId(),
        operation: 'UPDATE',
        entityType: 'standalone_map',
        entityId: id,
        payload: map,
        timestamp: now(),
        retryCount: 0,
        synced: 0,
      });
    }

    console.log('Standalone map updated:', id);
  } catch (error) {
    console.error('Error updating standalone map:', error);
    throw error;
  }
}

/**
 * Delete standalone map
 */
export async function deleteStandaloneMap(id: string): Promise<void> {
  try {
    await db.standaloneMaps.delete(id);

    // Add to sync queue
    await db.syncQueue.add({
      id: generateId(),
      operation: 'DELETE',
      entityType: 'standalone_map',
      entityId: id,
      payload: { id },
      timestamp: now(),
      retryCount: 0,
      synced: 0,
    });

    console.log('Standalone map deleted:', id);
  } catch (error) {
    console.error('Error deleting standalone map:', error);
    throw error;
  }
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Check if a floor plan exists for a project and floor
 */
export async function hasFloorPlan(projectId: string, floor: string): Promise<boolean> {
  const count = await db.floorPlans
    .where('[projectId+floor]')
    .equals([projectId, floor])
    .count();
  return count > 0;
}

/**
 * Get blob URL for a floor plan image
 */
export function getFloorPlanBlobUrl(imageBlob: Blob): string {
  return URL.createObjectURL(imageBlob);
}

/**
 * Revoke blob URL
 */
export function revokeFloorPlanBlobUrl(url: string): void {
  URL.revokeObjectURL(url);
}
