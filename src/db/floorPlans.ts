import { db, generateId, now, FloorPlan, FloorPlanPoint, StandaloneMap } from './database';
import { processFloorPlan, uploadFloorPlan, uploadStandaloneMap, blobToBase64 } from '../utils/floorPlanUtils';
import { triggerImmediateUpload } from '../sync/syncEngine';
import { supabase } from '../lib/supabase';
import {
  applyPendingWrites,
  getPendingEntityIds,
  isAuthError,
  isOnlineAndConfigured,
  writeThroughCache,
} from './onlineFirst';

type FloorPlanAssetMode = 'thumbnail' | 'full' | 'pdf';
const FLOOR_PLAN_SIGN_BATCH_SIZE = 300;

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

function convertRemoteToLocalFloorPlan(remote: any): FloorPlan {
  return {
    id: remote.id,
    projectId: remote.project_id,
    floor: remote.floor,
    imageBlob: undefined,
    thumbnailBlob: undefined,
    imageUrl: remote.image_url || undefined,
    thumbnailUrl: remote.thumbnail_url || undefined,
    pdfBlobBase64: undefined,
    pdfUrl: remote.pdf_url || undefined,
    originalFilename: remote.original_filename || '',
    originalFormat: remote.original_format || 'image',
    width: remote.width || 0,
    height: remote.height || 0,
    gridEnabled: undefined,
    gridConfig: undefined,
    metadata: remote.metadata || {},
    createdBy: remote.created_by,
    createdAt: new Date(remote.created_at).getTime(),
    updatedAt: new Date(remote.updated_at).getTime(),
    remoteUpdatedAt: new Date(remote.updated_at).getTime(),
    assetDirty: 0,
    synced: 1,
  };
}

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
    eiRating: remote.ei_rating ?? remote.metadata?.eiRating ?? undefined,
    metadata: remote.metadata || {},
    createdBy: remote.created_by,
    createdAt: new Date(remote.created_at).getTime(),
    updatedAt: new Date(remote.updated_at).getTime(),
    remoteUpdatedAt: new Date(remote.updated_at).getTime(),
    synced: 1,
  };
}

function mergeFloorPlanLocalFields(remote: FloorPlan, existing: FloorPlan | undefined): FloorPlan {
  return {
    ...remote,
    imageBlob: existing?.imageBlob ?? remote.imageBlob,
    thumbnailBlob: existing?.thumbnailBlob ?? remote.thumbnailBlob,
    pdfBlobBase64: existing?.pdfBlobBase64 ?? remote.pdfBlobBase64,
    gridEnabled: existing?.gridEnabled ?? remote.gridEnabled,
    gridConfig: existing?.gridConfig ?? remote.gridConfig,
    assetDirty: existing?.assetDirty ?? remote.assetDirty,
  };
}

function mergeFloorPlanPointLocalFields(
  remote: FloorPlanPoint,
  existing: FloorPlanPoint | undefined
): FloorPlanPoint {
  return {
    ...remote,
    eiRating: existing?.eiRating ?? remote.eiRating,
  };
}

function extractStorageLocation(
  url: string | undefined
): { bucket: string; path: string } | null {
  if (!url) {
    return null;
  }

  const fullMatch = url.match(/\/storage\/v1\/object\/(?:sign|public)\/([^/]+)\/([^?]+)/);
  if (fullMatch) {
    return {
      bucket: decodeURIComponent(fullMatch[1]),
      path: decodeURIComponent(fullMatch[2]),
    };
  }

  const legacyMatch = url.match(/\/(planimetrie|floor-plans)\/([^?]+)/);
  if (legacyMatch) {
    return {
      bucket: decodeURIComponent(legacyMatch[1]),
      path: decodeURIComponent(legacyMatch[2]),
    };
  }

  return null;
}

async function signFloorPlanUrls(plans: FloorPlan[]): Promise<FloorPlan[]> {
  const groupedPaths = new Map<string, Set<string>>();

  for (const plan of plans) {
    for (const candidate of [plan.imageUrl, plan.thumbnailUrl, plan.pdfUrl]) {
      const location = extractStorageLocation(candidate);
      if (!location) {
        continue;
      }
      if (!groupedPaths.has(location.bucket)) {
        groupedPaths.set(location.bucket, new Set());
      }
      groupedPaths.get(location.bucket)?.add(location.path);
    }
  }

  if (groupedPaths.size === 0) {
    return plans;
  }

  const signedByLocation = new Map<string, string>();

  for (const [bucket, paths] of Array.from(groupedPaths.entries())) {
    const pathList = Array.from(paths);
    for (const batch of chunkArray(pathList, FLOOR_PLAN_SIGN_BATCH_SIZE)) {
      const { data, error } = await supabase.storage.from(bucket).createSignedUrls(batch, 60 * 60);
      if (error) {
        console.warn('[online-first] signFloorPlanUrls failed', bucket, error);
        continue;
      }
      for (const item of data || []) {
        if (item.path && item.signedUrl) {
          signedByLocation.set(`${bucket}:${item.path}`, item.signedUrl);
        }
      }
    }
  }

  return plans.map((plan) => {
    const imageLocation = extractStorageLocation(plan.imageUrl);
    const thumbLocation = extractStorageLocation(plan.thumbnailUrl);
    const pdfLocation = extractStorageLocation(plan.pdfUrl);
    return {
      ...plan,
      imageUrl: imageLocation ? signedByLocation.get(`${imageLocation.bucket}:${imageLocation.path}`) || plan.imageUrl : plan.imageUrl,
      thumbnailUrl: thumbLocation ? signedByLocation.get(`${thumbLocation.bucket}:${thumbLocation.path}`) || plan.thumbnailUrl : plan.thumbnailUrl,
      pdfUrl: pdfLocation ? signedByLocation.get(`${pdfLocation.bucket}:${pdfLocation.path}`) || plan.pdfUrl : plan.pdfUrl,
    };
  });
}

export async function createFloorPlan(
  projectId: string,
  floor: string,
  file: File,
  userId: string
): Promise<FloorPlan> {
  try {
    const { fullRes, thumbnail, width, height, originalFormat, pdfBlob } = await processFloorPlan(file);

    let imageUrl: string | undefined;
    let thumbnailUrl: string | undefined;

    try {
      const urls = await uploadFloorPlan(projectId, floor, fullRes, thumbnail, userId);
      imageUrl = urls.fullResUrl;
      thumbnailUrl = urls.thumbnailUrl;
    } catch (uploadError) {
      console.warn('Failed to upload floor plan to storage, keeping local copy', uploadError);
    }

    let pdfBlobBase64: string | undefined;
    if (pdfBlob) {
      try {
        pdfBlobBase64 = await blobToBase64(pdfBlob);
      } catch (error) {
        console.warn('Failed to serialize original PDF for local cache', error);
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
      assetDirty: imageUrl && !pdfBlobBase64 ? 0 : 1,
      synced: imageUrl && !pdfBlobBase64 ? 1 : 0,
    };

    await db.floorPlans.add(floorPlan);
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
    triggerImmediateUpload();

    return floorPlan;
  } catch (error) {
    console.error('Error creating floor plan:', error);
    throw error;
  }
}

export async function getFloorPlan(id: string): Promise<FloorPlan | undefined> {
  return db.floorPlans.get(id);
}

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
        if (error.code === 'PGRST116') {
          return db.floorPlans
            .where('[projectId+floor]')
            .equals([projectId, floor])
            .first();
        }
        throw error;
      }

      const [signedRemote] = await signFloorPlanUrls([convertRemoteToLocalFloorPlan(data)]);
      const pendingIds = await getPendingEntityIds('floor_plan');
      const existing = await db.floorPlans.get(signedRemote.id);
      const merged = mergeFloorPlanLocalFields(signedRemote, existing);

      if (pendingIds.has(signedRemote.id) && existing) {
        return existing;
      }

      if (pendingIds.has(signedRemote.id) && !existing) {
        return undefined;
      }

      if (!pendingIds.has(signedRemote.id)) {
        const toPersist = {
          ...merged,
          imageUrl: undefined,
          thumbnailUrl: undefined,
          pdfUrl: undefined,
        };
        await db.floorPlans.put(toPersist);
      }

      return merged;
    } catch (err) {
      if (isAuthError(err)) {
        throw err;
      }
      console.warn('[online-first] getFloorPlanByProjectAndFloor fallback to IndexedDB', err);
    }
  }

  return db.floorPlans
    .where('[projectId+floor]')
    .equals([projectId, floor])
    .first();
}

export async function getFloorPlansByProject(projectId: string): Promise<FloorPlan[]> {
  if (isOnlineAndConfigured()) {
    try {
      const { data, error } = await supabase
        .from('floor_plans')
        .select('*')
        .eq('project_id', projectId);

      if (error) {
        throw error;
      }

      const remotePlans = await signFloorPlanUrls((data || []).map(convertRemoteToLocalFloorPlan));
      const pendingIds = await getPendingEntityIds(
        'floor_plan',
        (item) => (item.payload as FloorPlan)?.projectId === projectId
      );
      const cached = await writeThroughCache(
        remotePlans,
        pendingIds,
        db.floorPlans,
        mergeFloorPlanLocalFields,
        (fp) => ({ ...fp, imageUrl: undefined, thumbnailUrl: undefined, pdfUrl: undefined })
      );
      return applyPendingWrites<FloorPlan>(
        cached,
        'floor_plan',
        (item) => (item.payload as FloorPlan)?.projectId === projectId
      );
    } catch (err) {
      if (isAuthError(err)) {
        throw err;
      }
      console.warn('[online-first] getFloorPlansByProject fallback to IndexedDB', err);
    }
  }

  return db.floorPlans.where('projectId').equals(projectId).toArray();
}

export async function ensureFloorPlanAsset(
  floorPlanId: string,
  mode: FloorPlanAssetMode
): Promise<FloorPlan | undefined> {
  const floorPlan = await db.floorPlans.get(floorPlanId);
  if (!floorPlan) {
    return undefined;
  }

  if (mode === 'thumbnail' && (floorPlan.thumbnailBlob || floorPlan.thumbnailUrl)) {
    return floorPlan;
  }
  if (mode === 'full' && (floorPlan.imageBlob || floorPlan.imageUrl)) {
    if (floorPlan.imageBlob) {
      return floorPlan;
    }
  }
  if (mode === 'pdf' && (floorPlan.pdfBlobBase64 || floorPlan.pdfUrl)) {
    if (floorPlan.pdfBlobBase64) {
      return floorPlan;
    }
  }

  if (!isOnlineAndConfigured()) {
    return floorPlan;
  }

  try {
    const refreshedPlan = (await getFloorPlan(floorPlanId)) || floorPlan;
    let updatedPlan = refreshedPlan;

    if (mode === 'thumbnail' && !refreshedPlan.thumbnailBlob && refreshedPlan.thumbnailUrl) {
      const location = extractStorageLocation(refreshedPlan.thumbnailUrl);
      if (location) {
        const { data, error } = await supabase.storage.from(location.bucket).download(location.path);
        if (error) {
          throw error;
        }
        updatedPlan = { ...updatedPlan, thumbnailBlob: data };
      }
    }

    if (mode === 'full' && !updatedPlan.imageBlob && updatedPlan.imageUrl) {
      const location = extractStorageLocation(updatedPlan.imageUrl);
      if (location) {
        const { data, error } = await supabase.storage.from(location.bucket).download(location.path);
        if (error) {
          throw error;
        }
        updatedPlan = { ...updatedPlan, imageBlob: data };
      }
    }

    if (mode === 'pdf' && !updatedPlan.pdfBlobBase64 && updatedPlan.pdfUrl) {
      const location = extractStorageLocation(updatedPlan.pdfUrl);
      if (location) {
        const { data, error } = await supabase.storage.from(location.bucket).download(location.path);
        if (error) {
          throw error;
        }
        updatedPlan = { ...updatedPlan, pdfBlobBase64: await blobToBase64(data) };
      }
    }

    if (updatedPlan !== refreshedPlan) {
      await db.floorPlans.put(updatedPlan);
    }

    return updatedPlan;
  } catch (error) {
    console.warn(`Failed to hydrate floor plan asset ${floorPlanId} (${mode})`, error);
    return floorPlan;
  }
}

export async function updateFloorPlan(
  id: string,
  updates: Partial<FloorPlan>
): Promise<void> {
  try {
    const touchesAsset =
      updates.imageBlob !== undefined ||
      updates.thumbnailBlob !== undefined ||
      updates.pdfBlobBase64 !== undefined;

    await db.floorPlans.update(id, {
      ...updates,
      ...(touchesAsset ? { assetDirty: 1 } : {}),
      updatedAt: now(),
      synced: 0,
    });

    const floorPlan = await db.floorPlans.get(id);
    if (floorPlan) {
      const existingSyncItem = await db.syncQueue
        .where('entityType')
        .equals('floor_plan')
        .and((item) => item.entityId === id && item.synced === 0 && item.operation !== 'DELETE')
        .first();

      if (existingSyncItem) {
        await db.syncQueue.update(existingSyncItem.id, {
          payload: floorPlan,
          timestamp: now(),
        });
      } else {
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
      triggerImmediateUpload();
    }
  } catch (error) {
    console.error('Error updating floor plan:', error);
    throw error;
  }
}

export async function deleteFloorPlan(id: string): Promise<void> {
  try {
    const floorPlan = await db.floorPlans.get(id);
    if (!floorPlan) {
      throw new Error('Floor plan not found');
    }

    await db.floorPlanPoints.where('floorPlanId').equals(id).delete();
    await db.floorPlans.delete(id);

    await db.syncQueue.add({
      id: generateId(),
      operation: 'DELETE',
      entityType: 'floor_plan',
      entityId: id,
      payload: {
        id,
        projectId: floorPlan.projectId,
        imageUrl: floorPlan.imageUrl,
        thumbnailUrl: floorPlan.thumbnailUrl,
        pdfUrl: floorPlan.pdfUrl,
      },
      timestamp: now(),
      retryCount: 0,
      synced: 0,
    });
    triggerImmediateUpload();
  } catch (error) {
    console.error('Error deleting floor plan:', error);
    throw error;
  }
}

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
    eiRating?: 30 | 60 | 90 | 120 | 180 | 240;
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
      eiRating: options?.eiRating,
      metadata: options?.metadata,
      createdBy: userId,
      createdAt: now(),
      updatedAt: now(),
      synced: 0,
    };

    await db.floorPlanPoints.add(point);
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

    return point;
  } catch (error) {
    console.error('Error creating floor plan point:', error);
    throw error;
  }
}

export async function getFloorPlanPoint(id: string): Promise<FloorPlanPoint | undefined> {
  return db.floorPlanPoints.get(id);
}

export async function getFloorPlanPointByMappingEntry(
  mappingEntryId: string
): Promise<FloorPlanPoint | undefined> {
  return db.floorPlanPoints.where('mappingEntryId').equals(mappingEntryId).first();
}

export async function getFloorPlanPoints(floorPlanId: string): Promise<FloorPlanPoint[]> {
  if (isOnlineAndConfigured()) {
    try {
      const { data, error } = await supabase
        .from('floor_plan_points')
        .select('*')
        .eq('floor_plan_id', floorPlanId);

      if (error) {
        throw error;
      }

      const remotePoints = (data || []).map(convertRemoteToLocalFloorPlanPoint);
      const pendingIds = await getPendingEntityIds(
        'floor_plan_point',
        (item) => (item.payload as FloorPlanPoint)?.floorPlanId === floorPlanId
      );
      const cached = await writeThroughCache(remotePoints, pendingIds, db.floorPlanPoints, mergeFloorPlanPointLocalFields);

      return applyPendingWrites<FloorPlanPoint>(
        cached,
        'floor_plan_point',
        (item) => (item.payload as FloorPlanPoint)?.floorPlanId === floorPlanId
      );
    } catch (err) {
      if (isAuthError(err)) {
        throw err;
      }
      console.warn('[online-first] getFloorPlanPoints fallback to IndexedDB', err);
    }
  }

  return db.floorPlanPoints.where('floorPlanId').equals(floorPlanId).toArray();
}

export async function getFloorPlanPointsForPlans(
  floorPlanIds: string[]
): Promise<Record<string, FloorPlanPoint[]>> {
  if (floorPlanIds.length === 0) {
    return {};
  }

  if (isOnlineAndConfigured()) {
    try {
      const { data, error } = await supabase
        .from('floor_plan_points')
        .select('*')
        .in('floor_plan_id', floorPlanIds);

      if (error) {
        throw error;
      }

      const remotePoints = (data || []).map(convertRemoteToLocalFloorPlanPoint);
      const pendingIds = await getPendingEntityIds('floor_plan_point');
      const cached = await writeThroughCache(remotePoints, pendingIds, db.floorPlanPoints, mergeFloorPlanPointLocalFields);
      const withPending = await applyPendingWrites<FloorPlanPoint>(
        cached,
        'floor_plan_point',
        (item) => floorPlanIds.includes((item.payload as FloorPlanPoint)?.floorPlanId)
      );

      const grouped: Record<string, FloorPlanPoint[]> = {};
      for (const id of floorPlanIds) {
        grouped[id] = [];
      }
      for (const point of withPending) {
        if (!grouped[point.floorPlanId]) {
          grouped[point.floorPlanId] = [];
        }
        grouped[point.floorPlanId].push(point);
      }
      return grouped;
    } catch (err) {
      if (isAuthError(err)) {
        throw err;
      }
      console.warn('[online-first] getFloorPlanPointsForPlans fallback to IndexedDB', err);
    }
  }

  const grouped: Record<string, FloorPlanPoint[]> = {};
  for (const id of floorPlanIds) {
    grouped[id] = await db.floorPlanPoints.where('floorPlanId').equals(id).toArray();
  }
  return grouped;
}

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
      const existingSyncItem = await db.syncQueue
        .where('entityType')
        .equals('floor_plan_point')
        .and((item) => item.entityId === id && item.synced === 0 && item.operation !== 'DELETE')
        .first();

      if (existingSyncItem) {
        await db.syncQueue.update(existingSyncItem.id, {
          payload: point,
          timestamp: now(),
        });
      } else {
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
      triggerImmediateUpload();
    }
  } catch (error) {
    console.error('Error updating floor plan point:', error);
    throw error;
  }
}

export async function deleteFloorPlanPoint(id: string): Promise<void> {
  try {
    await db.floorPlanPoints.delete(id);
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
  } catch (error) {
    console.error('Error deleting floor plan point:', error);
    throw error;
  }
}

export async function createStandaloneMap(
  userId: string,
  name: string,
  file: File,
  description?: string
): Promise<StandaloneMap> {
  try {
    const { fullRes, thumbnail, width, height } = await processFloorPlan(file);
    const mapId = generateId();

    let imageUrl: string | undefined;
    let thumbnailUrl: string | undefined;

    try {
      const urls = await uploadStandaloneMap(mapId, fullRes, thumbnail, userId);
      imageUrl = urls.fullResUrl;
      thumbnailUrl = urls.thumbnailUrl;
    } catch (uploadError) {
      console.warn('Failed to upload standalone map to storage, keeping local copy', uploadError);
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
      synced: imageUrl ? 1 : 0,
    };

    await db.standaloneMaps.add(map);
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
    triggerImmediateUpload();

    return map;
  } catch (error) {
    console.error('Error creating standalone map:', error);
    throw error;
  }
}

export async function getStandaloneMap(id: string): Promise<StandaloneMap | undefined> {
  return db.standaloneMaps.get(id);
}

export async function getStandaloneMaps(userId: string): Promise<StandaloneMap[]> {
  return db.standaloneMaps.where('userId').equals(userId).toArray();
}

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
  } catch (error) {
    console.error('Error updating standalone map:', error);
    throw error;
  }
}

export async function deleteStandaloneMap(id: string): Promise<void> {
  try {
    await db.standaloneMaps.delete(id);
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
  } catch (error) {
    console.error('Error deleting standalone map:', error);
    throw error;
  }
}

export async function hasFloorPlan(projectId: string, floor: string): Promise<boolean> {
  if (isOnlineAndConfigured()) {
    try {
      const { count, error } = await supabase
        .from('floor_plans')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', projectId)
        .eq('floor', floor);

      if (error) {
        throw error;
      }

      if ((count || 0) > 0) {
        return true;
      }
    } catch (err) {
      if (isAuthError(err)) {
        throw err;
      }
      console.warn('[online-first] hasFloorPlan fallback to IndexedDB', err);
    }
  }

  const count = await db.floorPlans
    .where('[projectId+floor]')
    .equals([projectId, floor])
    .count();
  return count > 0;
}

export function getFloorPlanBlobUrl(
  imageBlob: Blob | null | undefined,
  imageUrl?: string | null
): string | null {
  if (imageBlob) {
    return URL.createObjectURL(imageBlob);
  }
  if (imageUrl) {
    return imageUrl;
  }
  return null;
}

export function revokeFloorPlanBlobUrl(url: string): void {
  if (url.startsWith('blob:')) {
    URL.revokeObjectURL(url);
  }
}

export async function updateFloorPlanLabelsForMapping(
  mappingEntryId: string,
  generateLabelFn: () => string[]
): Promise<void> {
  try {
    const points = await db.floorPlanPoints
      .where('mappingEntryId')
      .equals(mappingEntryId)
      .toArray();

    if (points.length === 0) {
      return;
    }

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
  } catch (error) {
    console.error('Error updating floor plan labels for mapping:', error);
    throw error;
  }
}
