import { db, Project, Photo, Sal, FloorPlan, FloorPlanPoint, TypologyPrice, StandaloneMap } from '../db/database';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { convertRemoteToLocalMapping, convertRemoteToLocalProject } from './conflictResolution';
import { getPendingEntityIds } from '../db/onlineFirst';
import { pruneProjectLocal } from '../db/projects';

const SUPABASE_IN_BATCH_SIZE = 150;

function ensureOnline(): void {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase not configured');
  }
  if (!navigator.onLine) {
    throw new Error('No internet connection');
  }
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

async function fetchRowsByIds(
  table: string,
  column: string,
  ids: string[]
): Promise<any[]> {
  const rows: any[] = [];
  const batches = chunkArray(ids, SUPABASE_IN_BATCH_SIZE);

  for (const batch of batches) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .in(column, batch);

    if (error) {
      throw new Error(`Failed to download ${table}: ${error.message}`);
    }

    rows.push(...(data || []));
  }

  return rows;
}

async function getAccessibleProjectsFromRemote(userId: string, isAdmin: boolean): Promise<any[]> {
  const { data: allProjects, error } = await supabase
    .from('projects')
    .select('*');

  if (error) {
    throw new Error(`Failed to download projects: ${error.message}`);
  }

  const projects = allProjects || [];
  if (isAdmin) {
    return projects;
  }

  return projects.filter((project: any) =>
    project.owner_id === userId ||
    (Array.isArray(project.accessible_users) && project.accessible_users.includes(userId))
  );
}

async function getAccessibleLocalProjects(userId: string, isAdmin: boolean): Promise<Project[]> {
  if (isAdmin) {
    return db.projects.toArray();
  }

  return db.projects
    .where('ownerId')
    .equals(userId)
    .or('accessibleUsers')
    .equals(userId)
    .toArray();
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

  const legacyMatch = url.match(/\/(planimetrie|floor-plans|photos)\/([^?]+)/);
  if (legacyMatch) {
    return {
      bucket: decodeURIComponent(legacyMatch[1]),
      path: decodeURIComponent(legacyMatch[2]),
    };
  }

  return null;
}

async function fetchStorageBlob(
  storagePath: string | undefined,
  fallbackUrl?: string | undefined
): Promise<Blob | undefined> {
  if (storagePath) {
    const { data, error } = await supabase.storage.from('photos').download(storagePath);
    if (error) {
      throw error;
    }
    return data;
  }

  if (fallbackUrl) {
    const response = await fetch(fallbackUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch asset: ${response.status}`);
    }
    return response.blob();
  }

  return undefined;
}

async function fetchBucketBlob(
  location: { bucket: string; path: string } | null,
  fallbackUrl?: string | undefined
): Promise<Blob | undefined> {
  if (location) {
    const { data, error } = await supabase.storage.from(location.bucket).download(location.path);
    if (error) {
      throw error;
    }
    return data;
  }

  if (fallbackUrl) {
    const response = await fetch(fallbackUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch asset: ${response.status}`);
    }
    return response.blob();
  }

  return undefined;
}

export async function downloadProjectsFromSupabase(userId: string, isAdmin = false): Promise<number> {
  ensureOnline();

  const remoteProjects = await getAccessibleProjectsFromRemote(userId, isAdmin);
  const pendingIds = await getPendingEntityIds('project');

  let downloadedCount = 0;

  for (const remoteProject of remoteProjects) {
    const converted = convertRemoteToLocalProject(remoteProject);
    const existingProject = await db.projects.get(converted.id);
    const projectToStore: Project = {
      ...converted,
      syncEnabled: existingProject?.syncEnabled ?? 1,
    };

    if (pendingIds.has(projectToStore.id)) {
      continue;
    }

    await db.projects.put(projectToStore);
    downloadedCount += 1;
  }

  // Pruning: rimuovere localmente i progetti non più accessibili remoto
  const remoteProjectIds = new Set(remoteProjects.map((p) => p.id));
  const localProjects = await db.projects.toArray();
  for (const local of localProjects) {
    if (!remoteProjectIds.has(local.id) && !pendingIds.has(local.id)) {
      await pruneProjectLocal(local.id);
    }
  }

  return downloadedCount;
}

export async function downloadMappingEntriesFromSupabase(userId: string, isAdmin = false): Promise<number> {
  ensureOnline();

  const projects = await getAccessibleLocalProjects(userId, isAdmin);
  const projectIds = projects.map((project) => project.id);
  if (projectIds.length === 0) {
    return 0;
  }

  const data = await fetchRowsByIds('mapping_entries', 'project_id', projectIds);

  const pendingIds = await getPendingEntityIds('mapping_entry');
  let downloadedCount = 0;

  for (const remoteEntry of data || []) {
    if (pendingIds.has(remoteEntry.id)) {
      continue;
    }

    const entry = convertRemoteToLocalMapping(remoteEntry);
    await db.mappingEntries.put(entry);
    downloadedCount += 1;
  }

  // Pruning: rimuovere localmente le mapping entries non più presenti remoto
  const remoteEntryIds = new Set((data || []).map((r: any) => r.id));
  const localEntryIds = projectIds.length > 0
    ? await db.mappingEntries.where('projectId').anyOf(projectIds).primaryKeys() as string[]
    : [];
  const toDeleteEntries = localEntryIds.filter((id) => !remoteEntryIds.has(id) && !pendingIds.has(id));
  if (toDeleteEntries.length > 0) await db.mappingEntries.bulkDelete(toDeleteEntries);

  return downloadedCount;
}

export async function downloadPhotosFromSupabase(
  userId: string,
  isAdmin = false,
  options?: { includeBlobs?: boolean }
): Promise<{ downloaded: number; failed: number }> {
  ensureOnline();

  const projects = await getAccessibleLocalProjects(userId, isAdmin);
  const projectIds = projects.map((project) => project.id);
  if (projectIds.length === 0) {
    return { downloaded: 0, failed: 0 };
  }

  const mappingEntries = await db.mappingEntries.where('projectId').anyOf(projectIds).toArray();
  const mappingEntryIds = mappingEntries.map((entry) => entry.id);
  if (mappingEntryIds.length === 0) {
    return { downloaded: 0, failed: 0 };
  }

  const photoRows: any[] = [];
  const mappingEntryIdBatches = chunkArray(mappingEntryIds, SUPABASE_IN_BATCH_SIZE);

  for (const batch of mappingEntryIdBatches) {
    const { data, error } = await supabase
      .from('photos')
      .select('*')
      .in('mapping_entry_id', batch);

    if (error) {
      throw new Error(`Failed to download photos: ${error.message}`);
    }

    photoRows.push(...(data || []));
  }

  const pendingIds = await getPendingEntityIds('photo');
  let downloaded = 0;
  let failed = 0;

  for (const remotePhoto of photoRows) {
    try {
      if (pendingIds.has(remotePhoto.id)) {
        continue;
      }

      const existingPhoto = await db.photos.get(remotePhoto.id);
      let blob = existingPhoto?.blob;
      let thumbnailBlob = existingPhoto?.thumbnailBlob;

      if (options?.includeBlobs && !blob) {
        blob = await fetchStorageBlob(remotePhoto.storage_path || undefined, remotePhoto.url || undefined);
      }

      if (options?.includeBlobs && !thumbnailBlob) {
        thumbnailBlob = await fetchStorageBlob(
          remotePhoto.thumbnail_storage_path || undefined,
          remotePhoto.thumbnail_url || undefined
        );
      }

      const photo: Photo = {
        id: remotePhoto.id,
        mappingEntryId: remotePhoto.mapping_entry_id,
        blob,
        thumbnailBlob,
        metadata: remotePhoto.metadata,
        uploaded: true,
        remoteUrl: remotePhoto.url || undefined,
        thumbnailRemoteUrl: remotePhoto.thumbnail_url || undefined,
        storagePath: remotePhoto.storage_path || undefined,
        thumbnailStoragePath: remotePhoto.thumbnail_storage_path || undefined,
      };

      await db.photos.put(photo);
      downloaded += 1;
    } catch (error) {
      console.warn(`Failed to hydrate photo ${remotePhoto.id}`, error);
      failed += 1;
    }
  }

  // Pruning: rimuovere localmente le foto non più presenti remoto
  const remotePhotoIds = new Set(photoRows.map((r: any) => r.id));
  const localPhotoIds = mappingEntryIds.length > 0
    ? await db.photos.where('mappingEntryId').anyOf(mappingEntryIds).primaryKeys() as string[]
    : [];
  const toDeletePhotos = localPhotoIds.filter((id) => !remotePhotoIds.has(id) && !pendingIds.has(id));
  if (toDeletePhotos.length > 0) await db.photos.bulkDelete(toDeletePhotos);

  return { downloaded, failed };
}

export async function downloadFloorPlansFromSupabase(
  userId: string,
  isAdmin = false,
  options?: { includeImageBlobs?: boolean; includeThumbnailBlobs?: boolean; includePdf?: boolean }
): Promise<number> {
  ensureOnline();

  const projects = await getAccessibleLocalProjects(userId, isAdmin);
  const projectIds = projects.map((project) => project.id);
  if (projectIds.length === 0) {
    return 0;
  }

  const data = await fetchRowsByIds('floor_plans', 'project_id', projectIds);

  const pendingIds = await getPendingEntityIds('floor_plan');
  let downloadedCount = 0;

  for (const remoteFloorPlan of data || []) {
    if (pendingIds.has(remoteFloorPlan.id)) {
      continue;
    }

    const existingFloorPlan = await db.floorPlans.get(remoteFloorPlan.id);
    const imageLocation = extractStorageLocation(remoteFloorPlan.image_url || undefined);
    const thumbnailLocation = extractStorageLocation(remoteFloorPlan.thumbnail_url || undefined);
    const pdfLocation = extractStorageLocation(remoteFloorPlan.pdf_url || undefined);

    let imageBlob = existingFloorPlan?.imageBlob;
    let thumbnailBlob = existingFloorPlan?.thumbnailBlob;
    let pdfBlobBase64 = existingFloorPlan?.pdfBlobBase64;

    if (options?.includeImageBlobs && !imageBlob) {
      imageBlob = await fetchBucketBlob(imageLocation, remoteFloorPlan.image_url || undefined);
    }

    if (options?.includeThumbnailBlobs && !thumbnailBlob) {
      thumbnailBlob = await fetchBucketBlob(thumbnailLocation, remoteFloorPlan.thumbnail_url || undefined);
    }

    if (options?.includePdf && !pdfBlobBase64) {
        const pdfBlob = await fetchBucketBlob(pdfLocation, remoteFloorPlan.pdf_url || undefined);
        if (pdfBlob) {
          const arrayBuffer = await pdfBlob.arrayBuffer();
          const bytes = new Uint8Array(arrayBuffer);
          let binary = '';
          for (let index = 0; index < bytes.length; index += 1) {
            binary += String.fromCharCode(bytes[index]);
          }
          pdfBlobBase64 = btoa(binary);
        }
      }

    const floorPlan: FloorPlan = {
      id: remoteFloorPlan.id,
      projectId: remoteFloorPlan.project_id,
      floor: remoteFloorPlan.floor,
      imageBlob,
      thumbnailBlob,
      imageUrl: remoteFloorPlan.image_url || undefined,
      thumbnailUrl: remoteFloorPlan.thumbnail_url || undefined,
      pdfBlobBase64,
      pdfUrl: remoteFloorPlan.pdf_url || undefined,
      originalFilename: remoteFloorPlan.original_filename,
      originalFormat: remoteFloorPlan.original_format,
      width: remoteFloorPlan.width,
      height: remoteFloorPlan.height,
      gridEnabled: existingFloorPlan?.gridEnabled,
      gridConfig: existingFloorPlan?.gridConfig,
      metadata: remoteFloorPlan.metadata || {},
      createdBy: remoteFloorPlan.created_by,
      createdAt: new Date(remoteFloorPlan.created_at).getTime(),
      updatedAt: new Date(remoteFloorPlan.updated_at).getTime(),
      remoteUpdatedAt: new Date(remoteFloorPlan.updated_at).getTime(),
      synced: 1,
    };

    await db.floorPlans.put(floorPlan);
    downloadedCount += 1;
  }

  // Pruning: rimuovere localmente i floor plan non più presenti remoto
  const remoteFloorPlanIds = new Set((data || []).map((r: any) => r.id));
  const localFloorPlanIds = projectIds.length > 0
    ? await db.floorPlans.where('projectId').anyOf(projectIds).primaryKeys() as string[]
    : [];
  const toDeleteFP = localFloorPlanIds.filter((id) => !remoteFloorPlanIds.has(id) && !pendingIds.has(id));
  if (toDeleteFP.length > 0) await db.floorPlans.bulkDelete(toDeleteFP);

  return downloadedCount;
}

export async function downloadFloorPlanPointsFromSupabase(userId: string, isAdmin = false): Promise<number> {
  ensureOnline();

  const floorPlans = await db.floorPlans.toArray();
  const localProjects = await getAccessibleLocalProjects(userId, isAdmin);
  const accessibleProjectIds = new Set(localProjects.map((project) => project.id));
  const floorPlanIds = floorPlans
    .filter((floorPlan) => accessibleProjectIds.has(floorPlan.projectId))
    .map((floorPlan) => floorPlan.id);

  if (floorPlanIds.length === 0) {
    return 0;
  }

  const data = await fetchRowsByIds('floor_plan_points', 'floor_plan_id', floorPlanIds);

  const pendingIds = await getPendingEntityIds('floor_plan_point');
  let downloadedCount = 0;

  for (const remotePoint of data || []) {
    if (pendingIds.has(remotePoint.id)) {
      continue;
    }

    const existingPoint = await db.floorPlanPoints.get(remotePoint.id);
    const point: FloorPlanPoint = {
      id: remotePoint.id,
      floorPlanId: remotePoint.floor_plan_id,
      mappingEntryId: remotePoint.mapping_entry_id,
      pointType: remotePoint.point_type,
      pointX: remotePoint.point_x,
      pointY: remotePoint.point_y,
      labelX: remotePoint.label_x,
      labelY: remotePoint.label_y,
      perimeterPoints: remotePoint.perimeter_points,
      customText: remotePoint.custom_text,
      eiRating: existingPoint?.eiRating ?? remotePoint.ei_rating ?? remotePoint.metadata?.eiRating,
      metadata: remotePoint.metadata || {},
      createdBy: remotePoint.created_by,
      createdAt: new Date(remotePoint.created_at).getTime(),
      updatedAt: new Date(remotePoint.updated_at).getTime(),
      remoteUpdatedAt: new Date(remotePoint.updated_at).getTime(),
      synced: 1,
    };

    await db.floorPlanPoints.put(point);
    downloadedCount += 1;
  }

  // Pruning: rimuovere localmente i points non più presenti remoto
  const remotePointIds = new Set((data || []).map((r: any) => r.id));
  const localPointIds = floorPlanIds.length > 0
    ? await db.floorPlanPoints.where('floorPlanId').anyOf(floorPlanIds).primaryKeys() as string[]
    : [];
  const toDeletePoints = localPointIds.filter((id) => !remotePointIds.has(id) && !pendingIds.has(id));
  if (toDeletePoints.length > 0) await db.floorPlanPoints.bulkDelete(toDeletePoints);

  return downloadedCount;
}

export async function updateRemotePhotosFlags(userId: string, isAdmin: boolean): Promise<void> {
  const projects = await getAccessibleLocalProjects(userId, isAdmin);
  const projectIds = projects.map((project) => project.id);
  if (projectIds.length === 0) {
    return;
  }

  const entries = await db.mappingEntries.where('projectId').anyOf(projectIds).toArray();
  const entryIds = entries.map((entry) => entry.id);
  if (entryIds.length === 0) {
    return;
  }

  const photos = await db.photos.where('mappingEntryId').anyOf(entryIds).toArray();
  const remoteOnlyMap = new Map<string, boolean>();

  for (const photo of photos) {
    if (!photo.blob && (photo.remoteUrl || photo.storagePath)) {
      remoteOnlyMap.set(photo.mappingEntryId, true);
    }
  }

  for (const entry of entries) {
    await db.mappingEntries.update(entry.id, {
      hasRemotePhotos: remoteOnlyMap.get(entry.id) ? true : false,
    });
  }
}

export async function downloadSalsFromSupabase(userId: string, isAdmin = false): Promise<number> {
  ensureOnline();

  const projects = await getAccessibleLocalProjects(userId, isAdmin);
  const projectIds = projects.map((project) => project.id);
  if (projectIds.length === 0) {
    return 0;
  }

  const data = await fetchRowsByIds('sals', 'project_id', projectIds);

  const pendingIds = await getPendingEntityIds('sal');
  let downloadedCount = 0;

  for (const remoteSal of data || []) {
    if (pendingIds.has(remoteSal.id)) {
      continue;
    }

    const sal: Sal = {
      id: remoteSal.id,
      projectId: remoteSal.project_id,
      number: remoteSal.number,
      name: remoteSal.name || undefined,
      date: remoteSal.date,
      notes: remoteSal.notes || undefined,
      createdAt: new Date(remoteSal.created_at).getTime(),
      synced: 1,
    };

    await db.sals.put(sal);
    downloadedCount += 1;
  }

  // Pruning: rimuovere localmente i SAL non più presenti remoto
  const remoteSalIds = new Set((data || []).map((r: any) => r.id));
  const localSalIds = projectIds.length > 0
    ? await db.sals.where('projectId').anyOf(projectIds).primaryKeys() as string[]
    : [];
  const toDeleteSals = localSalIds.filter((id) => !remoteSalIds.has(id) && !pendingIds.has(id));
  if (toDeleteSals.length > 0) await db.sals.bulkDelete(toDeleteSals);

  return downloadedCount;
}

export async function downloadTypologyPricesFromSupabase(userId: string, isAdmin = false): Promise<number> {
  ensureOnline();

  const projects = await getAccessibleLocalProjects(userId, isAdmin);
  const projectIds = projects.map((project) => project.id);
  if (projectIds.length === 0) {
    return 0;
  }

  const data = await fetchRowsByIds('typology_prices', 'project_id', projectIds);

  const pendingIds = await getPendingEntityIds('typology_price');
  let downloadedCount = 0;

  for (const remotePrice of data || []) {
    if (pendingIds.has(remotePrice.id)) {
      continue;
    }

    const price: TypologyPrice = {
      id: remotePrice.id,
      projectId: remotePrice.project_id,
      attraversamento: remotePrice.attraversamento,
      tipologicoId: remotePrice.tipologico_id || undefined,
      pricePerUnit: remotePrice.price_per_unit,
      unit: remotePrice.unit,
      createdAt: remotePrice.created_at ? new Date(remotePrice.created_at).getTime() : undefined,
      updatedAt: remotePrice.updated_at ? new Date(remotePrice.updated_at).getTime() : undefined,
      synced: 1,
    };

    await db.typologyPrices.put(price);
    downloadedCount += 1;
  }

  // Pruning: rimuovere localmente i prezzi non più presenti remoto
  const remotePriceIds = new Set((data || []).map((r: any) => r.id));
  const localPriceIds = projectIds.length > 0
    ? await db.typologyPrices.where('projectId').anyOf(projectIds).primaryKeys() as string[]
    : [];
  const toDeletePrices = localPriceIds.filter((id) => !remotePriceIds.has(id) && !pendingIds.has(id));
  if (toDeletePrices.length > 0) await db.typologyPrices.bulkDelete(toDeletePrices);

  return downloadedCount;
}

export async function downloadStandaloneMapsFromSupabase(userId: string): Promise<number> {
  ensureOnline();

  const { data, error } = await supabase
    .from('standalone_maps')
    .select('*')
    .eq('user_id', userId);

  if (error) {
    throw new Error(`Failed to download standalone_maps: ${error.message}`);
  }

  const pendingIds = await getPendingEntityIds('standalone_map');
  let downloadedCount = 0;

  for (const remote of data || []) {
    if (pendingIds.has(remote.id)) {
      continue;
    }

    const existingLocal = await db.standaloneMaps.get(remote.id);

    const localMap: StandaloneMap = {
      id: remote.id,
      userId: remote.user_id,
      name: remote.name,
      description: remote.description || undefined,
      imageBlob: existingLocal?.imageBlob,
      thumbnailBlob: existingLocal?.thumbnailBlob,
      imageUrl: remote.image_url || undefined,
      thumbnailUrl: remote.thumbnail_url || undefined,
      originalFilename: remote.original_filename || '',
      width: remote.width,
      height: remote.height,
      points: remote.points || [],
      gridEnabled: remote.grid_enabled,
      gridConfig: remote.grid_config || { rows: 10, cols: 10, offsetX: 0, offsetY: 0 },
      metadata: remote.metadata || {},
      createdAt: new Date(remote.created_at).getTime(),
      updatedAt: new Date(remote.updated_at).getTime(),
      synced: 1,
    };

    await db.standaloneMaps.put(localMap);
    downloadedCount += 1;
  }

  // Pruning: rimuovere localmente le mappe non più presenti remoto
  const remoteIds = new Set((data || []).map((r: any) => r.id));
  const localIds = await db.standaloneMaps.where('userId').equals(userId).primaryKeys() as string[];
  const toDelete = localIds.filter((id) => !remoteIds.has(id) && !pendingIds.has(id));
  if (toDelete.length > 0) await db.standaloneMaps.bulkDelete(toDelete);

  return downloadedCount;
}
