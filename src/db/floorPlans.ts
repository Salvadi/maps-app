/**
 * floorPlans.ts
 * Operazioni su database per planimetrie, punti planimetria e mappe standalone.
 * Ogni operazione di scrittura aggiunge un record alla coda di sincronizzazione
 * e attiva l'upload immediato verso Supabase.
 */

import { db, generateId, now, FloorPlan, FloorPlanPoint, StandaloneMap } from './database';
import { processFloorPlan, uploadFloorPlan, uploadStandaloneMap, blobToBase64 } from '../utils/floorPlanUtils';
import { triggerImmediateUpload } from '../sync/syncEngine';
import { supabase } from '../lib/supabase';
import {
  isOnlineAndConfigured,
  getPendingEntityIds,
  applyPendingWrites,
  writeThroughCache,
  isAuthError,
} from './onlineFirst';

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
    // Process the floor plan file (convert to PNG 2x, generate thumbnail, preserve PDF if applicable)
    const { fullRes, thumbnail, width, height, originalFormat, pdfBlob } = await processFloorPlan(file);

    // Upload to Supabase Storage
    let imageUrl: string | undefined;
    let thumbnailUrl: string | undefined;

    try {
      const urls = await uploadFloorPlan(projectId, floor, fullRes, thumbnail, userId);
      imageUrl = urls.fullResUrl;
      thumbnailUrl = urls.thumbnailUrl;
      console.log('Floor plan uploaded to Supabase Storage:', projectId, floor);
    } catch (uploadError) {
      console.warn('Failed to upload floor plan to Supabase Storage, saving locally only:', uploadError);
      // Continue anyway - will be stored locally and synced later
    }

    // Converti il PDF originale in Base64 per IndexedDB (il syncQueue.payload deve essere JSON-serializzabile)
    let pdfBlobBase64: string | undefined;
    if (pdfBlob) {
      try {
        pdfBlobBase64 = await blobToBase64(pdfBlob);
      } catch (err) {
        console.warn('Failed to convert PDF blob to Base64, vector export will use raster fallback:', err);
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
      pdfBlobBase64,
      originalFilename: file.name,
      originalFormat,
      width,
      height,
      createdBy: userId,
      createdAt: now(),
      updatedAt: now(),
      synced: imageUrl ? 1 : 0, // Mark as synced if uploaded successfully
    };

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
 * Converte un record FloorPlan da formato Supabase a formato locale.
 * NON include i blob (imageBlob, thumbnailBlob, pdfBlobBase64): troppo pesanti
 * per una lettura inline. I blob vengono scaricati dalla sync periodica.
 */
function convertRemoteToLocalFloorPlan(remote: any): FloorPlan {
  return {
    id: remote.id,
    projectId: remote.project_id,
    floor: remote.floor,
    imageUrl: remote.image_url || undefined,
    thumbnailUrl: remote.thumbnail_url || undefined,
    pdfUrl: remote.pdf_url || undefined,
    imageBlob: undefined as any, // sarà preservato dal merge se già presente localmente
    thumbnailBlob: undefined as any,
    pdfBlobBase64: undefined,
    originalFilename: remote.original_filename || '',
    originalFormat: remote.original_format || 'image',
    width: remote.width || 0,
    height: remote.height || 0,
    metadata: remote.metadata || {},
    gridConfig: undefined, // campo local-only, preservato dal merge
    gridEnabled: undefined, // campo local-only, preservato dal merge
    createdBy: remote.created_by,
    createdAt: new Date(remote.created_at).getTime(),
    updatedAt: new Date(remote.updated_at).getTime(),
    remoteUpdatedAt: new Date(remote.updated_at).getTime(),
    synced: 1,
  };
}

/**
 * Estrae il path dentro al bucket 'planimetrie' da un URL Supabase
 * (public o signed). Restituisce null se non matcha.
 */
function extractPlanimetriePath(url: string | undefined): string | null {
  if (!url) return null;
  const match = url.match(/\/planimetrie\/([^?]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Il bucket 'planimetrie' è privato: i publicUrl salvati in floor_plans
 * restituiscono 403. Sostituiamo imageUrl/thumbnailUrl/pdfUrl con signed URL
 * generate in un'unica chiamata batch (TTL 1h).
 */
async function signFloorPlanUrls(plans: FloorPlan[]): Promise<FloorPlan[]> {
  const paths = new Set<string>();
  for (const p of plans) {
    const a = extractPlanimetriePath(p.imageUrl);
    const b = extractPlanimetriePath(p.thumbnailUrl);
    const c = extractPlanimetriePath(p.pdfUrl);
    if (a) paths.add(a);
    if (b) paths.add(b);
    if (c) paths.add(c);
  }
  if (paths.size === 0) return plans;

  const pathList = Array.from(paths);
  const { data: signed, error } = await supabase.storage
    .from('planimetrie')
    .createSignedUrls(pathList, 60 * 60);
  if (error) {
    console.warn('[online-first] signFloorPlanUrls: createSignedUrls failed', error);
    return plans;
  }

  const byPath = new Map<string, string>();
  for (const s of signed || []) {
    if (s.path && s.signedUrl) byPath.set(s.path, s.signedUrl);
  }

  return plans.map((p) => {
    const imgPath = extractPlanimetriePath(p.imageUrl);
    const thumbPath = extractPlanimetriePath(p.thumbnailUrl);
    const pdfPath = extractPlanimetriePath(p.pdfUrl);
    return {
      ...p,
      imageUrl: (imgPath && byPath.get(imgPath)) || p.imageUrl,
      thumbnailUrl: (thumbPath && byPath.get(thumbPath)) || p.thumbnailUrl,
      pdfUrl: (pdfPath && byPath.get(pdfPath)) || p.pdfUrl,
    };
  });
}

/**
 * Preserva i campi local-only di un FloorPlan: blob binari e configurazione griglia.
 */
function mergeFloorPlanLocalFields(remote: FloorPlan, existing: FloorPlan | undefined): FloorPlan {
  return {
    ...remote,
    imageBlob: existing?.imageBlob ?? remote.imageBlob,
    thumbnailBlob: existing?.thumbnailBlob ?? remote.thumbnailBlob,
    pdfBlobBase64: existing?.pdfBlobBase64 ?? remote.pdfBlobBase64,
    gridConfig: existing?.gridConfig ?? remote.gridConfig,
    gridEnabled: existing?.gridEnabled ?? remote.gridEnabled,
  };
}

/**
 * Converte un record FloorPlanPoint da formato Supabase a formato locale.
 */
function convertRemoteToLocalFloorPlanPoint(remote: any): FloorPlanPoint {
  return {
    id: remote.id,
    floorPlanId: remote.floor_plan_id,
    mappingEntryId: remote.mapping_entry_id || undefined,
    pointType: remote.point_type,
    pointX: remote.point_x,
    pointY: remote.point_y,
    labelX: remote.label_x,
    labelY: remote.label_y,
    perimeterPoints: remote.perimeter_points || undefined,
    customText: remote.custom_text || undefined,
    eiRating: undefined, // campo local-only non presente in Supabase
    metadata: remote.metadata || {},
    createdBy: remote.created_by,
    createdAt: new Date(remote.created_at).getTime(),
    updatedAt: new Date(remote.updated_at).getTime(),
    remoteUpdatedAt: new Date(remote.updated_at).getTime(),
    synced: 1,
  };
}

/**
 * Preserva il campo eiRating (local-only) durante il write-through cache dei punti.
 */
function mergeFloorPlanPointLocalFields(
  remote: FloorPlanPoint,
  existing: FloorPlanPoint | undefined
): FloorPlanPoint {
  return {
    ...remote,
    eiRating: existing?.eiRating ?? remote.eiRating,
  };
}

/**
 * Get floor plan for a specific project and floor.
 * Online-first: reads from Supabase when connected, falls back to IndexedDB when offline.
 */
export async function getFloorPlanByProjectAndFloor(
  projectId: string,
  floor: string
): Promise<FloorPlan | undefined> {
  if (isOnlineAndConfigured()) {
    try {
      const { data, error } = await supabase
        .from('floor_plans')
        .select('*')
        .eq('project_id', projectId)
        .eq('floor', floor)
        .single();

      if (error) {
        if (error.code === 'PGRST116') return undefined; // Not found
        throw error;
      }

      const rawRemote = convertRemoteToLocalFloorPlan(data);
      const [signedRemote] = await signFloorPlanUrls([rawRemote]);
      const pendingIds = await getPendingEntityIds('floor_plan');

      const [merged] = await Promise.all([
        (async () => {
          const existing = await db.floorPlans.get(signedRemote.id);
          const item = mergeFloorPlanLocalFields(signedRemote, existing);
          if (!pendingIds.has(signedRemote.id)) await db.floorPlans.put(item);
          return item;
        })(),
      ]);

      return merged;
    } catch (err) {
      if (isAuthError(err)) throw err;
      console.warn('[online-first] getFloorPlanByProjectAndFloor: fallback su IndexedDB', err);
    }
  }

  return await db.floorPlans
    .where('[projectId+floor]')
    .equals([projectId, floor])
    .first();
}

/**
 * Get all floor plans for a project.
 * Online-first: reads from Supabase when connected, falls back to IndexedDB when offline.
 * I blob (imageBlob, thumbnailBlob, pdfBlobBase64) vengono preservati dall'IndexedDB locale
 * se già presenti — non vengono riscaricati inline (lo fa la sync periodica).
 */
export async function getFloorPlansByProject(projectId: string): Promise<FloorPlan[]> {
  if (isOnlineAndConfigured()) {
    try {
      const { data, error } = await supabase
        .from('floor_plans')
        .select('*')
        .eq('project_id', projectId);

      if (error) throw error;

      const rawFloorPlans = (data || []).map(convertRemoteToLocalFloorPlan);
      const remoteFloorPlans = await signFloorPlanUrls(rawFloorPlans);

      const pendingIds = await getPendingEntityIds(
        'floor_plan',
        (item) => (item.payload as FloorPlan)?.projectId === projectId
      );

      const mergedFloorPlans = await writeThroughCache(remoteFloorPlans, pendingIds, db.floorPlans, mergeFloorPlanLocalFields);

      const results = await applyPendingWrites<FloorPlan>(
        mergedFloorPlans,
        'floor_plan',
        (item) => (item.payload as FloorPlan)?.projectId === projectId
      );

      return results;
    } catch (err) {
      if (isAuthError(err)) throw err;
      console.warn('[online-first] getFloorPlansByProject: fallback su IndexedDB', err);
    }
  }

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
 * Get all points for a floor plan.
 * Online-first: reads from Supabase when connected, falls back to IndexedDB when offline.
 */
export async function getFloorPlanPoints(floorPlanId: string): Promise<FloorPlanPoint[]> {
  if (isOnlineAndConfigured()) {
    try {
      const { data, error } = await supabase
        .from('floor_plan_points')
        .select('*')
        .eq('floor_plan_id', floorPlanId);

      if (error) throw error;

      const remotePoints = (data || []).map(convertRemoteToLocalFloorPlanPoint);

      const pendingIds = await getPendingEntityIds(
        'floor_plan_point',
        (item) => (item.payload as FloorPlanPoint)?.floorPlanId === floorPlanId
      );

      const mergedPoints = await writeThroughCache(
        remotePoints,
        pendingIds,
        db.floorPlanPoints,
        mergeFloorPlanPointLocalFields
      );

      return await applyPendingWrites<FloorPlanPoint>(
        mergedPoints,
        'floor_plan_point',
        (item) => (item.payload as FloorPlanPoint)?.floorPlanId === floorPlanId
      );
    } catch (err) {
      if (isAuthError(err)) throw err;
      console.warn('[online-first] getFloorPlanPoints: fallback su IndexedDB', err);
    }
  }

  return await db.floorPlanPoints.where('floorPlanId').equals(floorPlanId).toArray();
}

/**
 * Get points for multiple floor plans in a single query.
 * Usa .in() per evitare N chiamate Supabase sequenziali nei loop dei componenti.
 * Online-first con fallback IndexedDB.
 */
export async function getFloorPlanPointsForPlans(
  floorPlanIds: string[]
): Promise<Record<string, FloorPlanPoint[]>> {
  if (floorPlanIds.length === 0) return {};

  if (isOnlineAndConfigured()) {
    try {
      const { data, error } = await supabase
        .from('floor_plan_points')
        .select('*')
        .in('floor_plan_id', floorPlanIds);

      if (error) throw error;

      const remotePoints = (data || []).map(convertRemoteToLocalFloorPlanPoint);

      const pendingIds = await getPendingEntityIds('floor_plan_point');

      const mergedPoints = await writeThroughCache(
        remotePoints,
        pendingIds,
        db.floorPlanPoints,
        mergeFloorPlanPointLocalFields
      );

      const withOverlay = await applyPendingWrites<FloorPlanPoint>(
        mergedPoints,
        'floor_plan_point',
        (item) => floorPlanIds.includes((item.payload as FloorPlanPoint)?.floorPlanId)
      );

      // Raggruppa per floorPlanId
      const result: Record<string, FloorPlanPoint[]> = {};
      for (const id of floorPlanIds) result[id] = [];
      for (const point of withOverlay) {
        if (result[point.floorPlanId]) {
          result[point.floorPlanId].push(point);
        }
      }
      return result;
    } catch (err) {
      if (isAuthError(err)) throw err;
      console.warn('[online-first] getFloorPlanPointsForPlans: fallback su IndexedDB', err);
    }
  }

  // Offline fallback
  const result: Record<string, FloorPlanPoint[]> = {};
  for (const id of floorPlanIds) {
    result[id] = await db.floorPlanPoints.where('floorPlanId').equals(id).toArray();
  }
  return result;
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
 * Get a displayable URL for a floor plan image.
 * Preferisce il blob locale (createObjectURL), ma se assente cade in fallback
 * sull'URL remoto Supabase Storage (visibile solo quando online).
 * Ritorna null se né blob né URL sono disponibili.
 */
export function getFloorPlanBlobUrl(
  imageBlob: Blob | null | undefined,
  imageUrl?: string | null
): string | null {
  if (imageBlob) return URL.createObjectURL(imageBlob);
  if (imageUrl) return imageUrl;
  return null;
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
