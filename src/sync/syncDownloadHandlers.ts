import { db, Project, Photo, Sal, FloorPlan, FloorPlanPoint, TypologyPrice, StandaloneMap } from '../db/database';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { convertRemoteToLocalMapping, convertRemoteToLocalProject } from './conflictResolution';
import { getPendingEntityIds } from '../db/onlineFirst';
import { pruneProjectLocal } from '../db/projects';

const SUPABASE_IN_BATCH_SIZE = 150;
async function downloadStorageBlobFromPublicUrl(publicUrl: string): Promise<Blob | null> {
  const parsedUrl = new URL(publicUrl);
  const match = parsedUrl.pathname.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.+)/);

  if (!match) {
    return null;
  }

  const [, bucketName, rawObjectPath] = match;
  const objectPath = decodeURIComponent(rawObjectPath);
  const { data: blob, error } = await supabase.storage
    .from(bucketName)
    .download(objectPath);

  if (error || !blob) {
    console.warn(`⚠️  Failed to download storage object ${objectPath}: ${error?.message}`);
    return null;
  }

  return blob;
}

async function downloadStoragePdfBase64(publicUrl: string): Promise<string | undefined> {
  const pdfBlob = await downloadStorageBlobFromPublicUrl(publicUrl);
  if (!pdfBlob) {
    return undefined;
  }

  const arrayBuffer = await pdfBlob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }

  return btoa(binary);
}

function normalizeStandaloneMapGridConfig(gridConfig: any): StandaloneMap['gridConfig'] {
  return {
    rows: typeof gridConfig?.rows === 'number' ? gridConfig.rows : 10,
    cols: typeof gridConfig?.cols === 'number' ? gridConfig.cols : 10,
    offsetX: typeof gridConfig?.offsetX === 'number' ? gridConfig.offsetX : 0,
    offsetY: typeof gridConfig?.offsetY === 'number' ? gridConfig.offsetY : 0,
  };
}

function normalizeStandaloneMapPoints(points: any): StandaloneMap['points'] {
  if (!Array.isArray(points)) {
    return [];
  }

  return points.map((point: any) => ({
    id: point.id,
    pointType: point.pointType,
    pointX: point.pointX,
    pointY: point.pointY,
    labelX: point.labelX,
    labelY: point.labelY,
    perimeterPoints: point.perimeterPoints,
    customText: point.customText,
    labelText: point.labelText,
    labelBackgroundColor: point.labelBackgroundColor,
    labelTextColor: point.labelTextColor,
    eiRating: point.eiRating ?? undefined,
  }));
}

// ============================================
// SEZIONE: Download Progetti (Project Download)
// Scarica tutti i progetti accessibili dall'utente (o tutti se admin).
// Preserva la preferenza locale syncEnabled e risolve i conflitti.
// ============================================

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
// ============================================
// SEZIONE: Download Mappe Standalone (Standalone Maps Download)
// Scarica le mappe standalone dell'utente e idrata lazy il PDF originale.
// ============================================

export async function downloadStandaloneMapsFromSupabase(userId: string, isAdmin: boolean = false): Promise<number> {
  if (!isSupabaseConfigured()) {
    console.warn('⚠️  Download skipped: Supabase not configured');
    return 0;
  }

  if (!navigator.onLine) {
    console.warn('⚠️  Download skipped: No internet connection');
    return 0;
  }

  console.log(`⬇️  Downloading standalone maps from Supabase for user ${userId}${isAdmin ? ' (admin)' : ''}...`);

  try {
    let query = supabase
      .from('standalone_maps')
      .select('*');

    if (!isAdmin) {
      query = query.eq('user_id', userId);
    }

    const { data: standaloneMaps, error } = await query;

    if (error) {
      throw new Error(`Failed to download standalone maps: ${error.message}`);
    }

    if (!standaloneMaps || standaloneMaps.length === 0) {
      console.log('✅ No standalone maps to download');
      return 0;
    }

    let downloadedCount = 0;

    for (const supabaseMap of standaloneMaps) {
      try {
        const existingMap = await db.standaloneMaps.get(supabaseMap.id);
        const remoteUpdated = new Date(supabaseMap.updated_at).getTime();
        const shouldKeepLocalData = !!existingMap && remoteUpdated <= existingMap.updatedAt;
        const shouldHydrateMissingPdf = !!supabaseMap.pdf_url && !existingMap?.pdfBlobBase64;
        const shouldHydrateMissingImage = !!supabaseMap.image_url && !existingMap?.imageBlob;
        const shouldHydrateMissingThumbnail = !!supabaseMap.thumbnail_url && !existingMap?.thumbnailBlob;

        if (
          existingMap &&
          shouldKeepLocalData &&
          existingMap.imageBlob &&
          !shouldHydrateMissingPdf &&
          !shouldHydrateMissingImage &&
          !shouldHydrateMissingThumbnail
        ) {
          console.log(`⏭️  Standalone map ${supabaseMap.id} is up to date, skipping`);
          continue;
        }

        let imageBlob = existingMap?.imageBlob;
        if (supabaseMap.image_url && (!imageBlob || remoteUpdated > (existingMap?.updatedAt || 0))) {
          try {
            imageBlob = (await downloadStorageBlobFromPublicUrl(supabaseMap.image_url)) || imageBlob;
          } catch (imageErr) {
            console.warn(`⚠️  Failed to download standalone image for ${supabaseMap.id}:`, imageErr);
          }
        }

        let thumbnailBlob = existingMap?.thumbnailBlob;
        if (supabaseMap.thumbnail_url && (!thumbnailBlob || remoteUpdated > (existingMap?.updatedAt || 0))) {
          try {
            thumbnailBlob = (await downloadStorageBlobFromPublicUrl(supabaseMap.thumbnail_url)) || thumbnailBlob;
          } catch (thumbnailErr) {
            console.warn(`⚠️  Failed to download standalone thumbnail for ${supabaseMap.id}:`, thumbnailErr);
          }
        }

        let pdfBlobBase64 = existingMap?.pdfBlobBase64;
        if (supabaseMap.pdf_url && (!pdfBlobBase64 || remoteUpdated > (existingMap?.updatedAt || 0))) {
          try {
            pdfBlobBase64 = (await downloadStoragePdfBase64(supabaseMap.pdf_url)) || pdfBlobBase64;
            if (pdfBlobBase64) {
              console.log(`📄 Downloaded PDF originale for standalone map ${supabaseMap.id}`);
            }
          } catch (pdfErr) {
            console.warn(`⚠️  Failed to download standalone PDF for ${supabaseMap.id}:`, pdfErr);
          }
        }

        const resolvedImageBlob = imageBlob || existingMap?.imageBlob;
        if (!resolvedImageBlob) {
          console.warn(`⚠️  Skipping standalone map ${supabaseMap.id}: image blob unavailable`);
          continue;
        }

        const baseMap = shouldKeepLocalData ? existingMap : undefined;
        const remotePoints = normalizeStandaloneMapPoints(supabaseMap.points);
        const remoteGridConfig = normalizeStandaloneMapGridConfig(supabaseMap.grid_config);

        const standaloneMap: StandaloneMap = {
          id: supabaseMap.id,
          userId: baseMap?.userId ?? supabaseMap.user_id,
          name: baseMap?.name ?? supabaseMap.name,
          description: baseMap?.description ?? supabaseMap.description ?? undefined,
          imageBlob: resolvedImageBlob,
          thumbnailBlob: thumbnailBlob || baseMap?.thumbnailBlob,
          pdfBlobBase64,
          imageUrl: baseMap?.imageUrl ?? supabaseMap.image_url ?? undefined,
          thumbnailUrl: baseMap?.thumbnailUrl ?? supabaseMap.thumbnail_url ?? undefined,
          pdfUrl: baseMap?.pdfUrl ?? supabaseMap.pdf_url ?? undefined,
          originalFilename: baseMap?.originalFilename ?? supabaseMap.original_filename,
          originalFormat: baseMap?.originalFormat ?? supabaseMap.original_format ?? undefined,
          width: baseMap?.width ?? supabaseMap.width,
          height: baseMap?.height ?? supabaseMap.height,
          points: baseMap?.points ?? remotePoints,
          gridEnabled: baseMap?.gridEnabled ?? !!supabaseMap.grid_enabled,
          gridConfig: baseMap?.gridConfig ?? remoteGridConfig,
          metadata: baseMap?.metadata ?? supabaseMap.metadata ?? {},
          createdAt: baseMap?.createdAt ?? new Date(supabaseMap.created_at).getTime(),
          updatedAt: baseMap?.updatedAt ?? remoteUpdated,
          synced: baseMap?.synced ?? (1 as 0 | 1),
        };

        await db.standaloneMaps.put(standaloneMap);
        downloadedCount++;
        console.log(`✅ Downloaded standalone map: ${supabaseMap.id}`);
      } catch (mapErr) {
        const errorMessage = mapErr instanceof Error ? mapErr.message : String(mapErr);
        console.error(`❌ Error downloading standalone map ${supabaseMap.id}:`, errorMessage);
      }
    }

    console.log(`✅ Downloaded ${downloadedCount} standalone maps from Supabase`);
    return downloadedCount;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error('❌ Failed to download standalone maps:', errorMessage);
    throw err;
  }
}

// ============================================
// SEZIONE: Aggiornamento flag foto remote (Remote Photo Flags)
// Confronta il conteggio foto sul server con quello locale.
// Imposta hasRemotePhotos=true sulle entries che hanno foto non scaricate.
// Chiamata quando l'utente sceglie di non scaricare le foto durante il sync manuale.
// ============================================

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

