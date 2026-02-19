/**
 * floorPlans.ts
 * Operazioni su database per planimetrie, punti planimetria e mappe standalone.
 * Ogni operazione di scrittura aggiunge un record alla coda di sincronizzazione
 * e attiva l'upload immediato verso Supabase.
 */

import { db, generateId, now, FloorPlan, FloorPlanPoint, StandaloneMap } from './database';
import { processFloorPlan, uploadFloorPlan, uploadStandaloneMap, blobToBase64 } from '../utils/floorPlanUtils';
import { triggerImmediateUpload } from '../sync/syncEngine';

// ============================================
// SEZIONE: CRUD Planimetrie
// Creazione, lettura, aggiornamento ed eliminazione delle planimetrie (FloorPlan).
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
    // Process the floor plan file (convert to PNG 2x, generate thumbnail, extract PDF if provided)
    const { fullRes, thumbnail, width, height, originalFormat, pdfBlob } = await processFloorPlan(file);

    // Upload to Supabase Storage
    let imageUrl: string | undefined;
    let thumbnailUrl: string | undefined;
    let pdfUrl: string | undefined;

    try {
      const urls = await uploadFloorPlan(projectId, floor, fullRes, thumbnail, userId, pdfBlob);
      imageUrl = urls.fullResUrl;
      thumbnailUrl = urls.thumbnailUrl;
      pdfUrl = urls.pdfUrl;
      console.log('Floor plan uploaded to Supabase Storage:', projectId, floor);
    } catch (uploadError) {
      console.warn('Failed to upload floor plan to Supabase Storage, saving locally only:', uploadError);
      // Continue anyway - will be stored locally and synced later
    }

    // Convert pdfBlob to Base64 for storage in IndexedDB (Dexie doesn't serialize Blobs well)
    let pdfBlobBase64: string | undefined;
    if (pdfBlob) {
      console.log('🔄 Converting pdfBlob to Base64..., size:', pdfBlob.size);
      try {
        pdfBlobBase64 = await blobToBase64(pdfBlob);
        console.log('✅ pdfBlobBase64 conversion successful, length:', pdfBlobBase64?.length);
      } catch (error) {
        console.error('❌ Error converting pdfBlob to Base64:', error);
      }
    }

    const floorPlan: FloorPlan = {
      id: generateId(),
      projectId,
      floor,
      imageBlob: fullRes,
      thumbnailBlob: thumbnail,
      imageUrl,
      thumbnailUrl,
      pdfBlobBase64, // Store original PDF as Base64 for vector preservation
      pdfUrl,  // URL to original PDF on Supabase
      originalFilename: file.name,
      originalFormat,
      width,
      height,
      createdBy: userId,
      createdAt: now(),
      updatedAt: now(),
      synced: imageUrl ? 1 : 0, // Mark as synced if uploaded successfully
    };

    console.log('💾 Saving FloorPlan to IndexedDB:', { id: floorPlan.id, hasPdfBlobBase64: !!floorPlan.pdfBlobBase64, pdfBlobBase64Length: floorPlan.pdfBlobBase64?.length });
    await db.floorPlans.add(floorPlan);

    // Always add to sync queue to ensure floor_plans table entry is created in Supabase
    // Even if Storage upload succeeded, we still need to create the database record
    await db.syncQueue.add({
      id: generateId(),
      operation: 'CREATE',
      entityType: 'floor_plan',
      entityId: floorPlan.id,
      payload: floorPlan,
      timestamp: now(),
      retryCount: 0,
      synced: 0, // Always set to 0 so it gets processed by sync engine
    });
    triggerImmediateUpload();

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
  const plans = await db.floorPlans.where('projectId').equals(projectId).toArray();
  console.log(`📋 Loaded ${plans.length} floor plans for project ${projectId}:`, plans.map(p => ({
    id: p.id,
    floor: p.floor,
    hasPdfBlobBase64: !!p.pdfBlobBase64,
    pdfBlobBase64Length: p.pdfBlobBase64?.length,
  })));
  return plans;
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
      triggerImmediateUpload();
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
    triggerImmediateUpload();

    console.log('Floor plan deleted:', id);
  } catch (error) {
    console.error('Error deleting floor plan:', error);
    throw error;
  }
}

// ============================================
// SEZIONE: CRUD Punti Planimetria
// Creazione, lettura, aggiornamento ed eliminazione dei punti sulla planimetria.
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
    triggerImmediateUpload();

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
      triggerImmediateUpload();
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
    triggerImmediateUpload();

    console.log('Floor plan point deleted:', id);
  } catch (error) {
    console.error('Error deleting floor plan point:', error);
    throw error;
  }
}

// ============================================
// SEZIONE: CRUD Mappe Standalone
// Creazione, lettura, aggiornamento ed eliminazione delle mappe standalone.
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

    // Always add to sync queue to ensure standalone_maps table entry is created in Supabase
    // Even if Storage upload succeeded, we still need to create the database record
    await db.syncQueue.add({
      id: generateId(),
      operation: 'CREATE',
      entityType: 'standalone_map',
      entityId: map.id,
      payload: map,
      timestamp: now(),
      retryCount: 0,
      synced: 0, // Always set to 0 so it gets processed by sync engine
    });
    triggerImmediateUpload();

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
      triggerImmediateUpload();
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
    triggerImmediateUpload();

    console.log('Standalone map deleted:', id);
  } catch (error) {
    console.error('Error deleting standalone map:', error);
    throw error;
  }
}

// ============================================
// SEZIONE: Aggiornamento etichette
// Funzioni per aggiornare le etichette dei punti in base alle mapping entries.
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

/**
 * Update floor plan point labels for a specific mapping entry
 * This should be called when a mapping entry is updated to keep labels in sync
 */
export async function updateFloorPlanLabelsForMapping(
  mappingEntryId: string,
  generateLabelFn: () => string[]
): Promise<void> {
  try {
    // Find all floor plan points associated with this mapping entry
    const points = await db.floorPlanPoints
      .where('mappingEntryId')
      .equals(mappingEntryId)
      .toArray();

    if (points.length === 0) {
      console.log('No floor plan points found for mapping entry:', mappingEntryId);
      return;
    }

    // Update each point's label metadata
    for (const point of points) {
      const newLabel = generateLabelFn();

      await db.floorPlanPoints.update(point.id, {
        metadata: {
          ...point.metadata,
          labelText: newLabel,
        },
        updatedAt: now(),
        synced: 0,
      });

      // Add to sync queue
      const updatedPoint = await db.floorPlanPoints.get(point.id);
      if (updatedPoint) {
        await db.syncQueue.add({
          id: generateId(),
          operation: 'UPDATE',
          entityType: 'floor_plan_point',
          entityId: point.id,
          payload: updatedPoint,
          timestamp: now(),
          retryCount: 0,
          synced: 0,
        });
      }
    }
    triggerImmediateUpload();

    console.log(`Updated labels for ${points.length} floor plan point(s) associated with mapping ${mappingEntryId}`);
  } catch (error) {
    console.error('Error updating floor plan labels for mapping:', error);
    throw error;
  }
}
