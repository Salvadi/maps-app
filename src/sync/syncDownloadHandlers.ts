/**
 * @file Gestori di download per la sincronizzazione (Download Handlers)
 * @description Contiene le funzioni per il download dei dati da Supabase verso IndexedDB:
 * progetti, mapping entries, foto, planimetrie e punti planimetria.
 * Include la gestione dei conflitti, il supporto admin/utente e il download dei blob
 * da Supabase Storage con parsing dinamico del bucket name.
 */

import { db, Project, MappingEntry, Photo } from '../db/database';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { resolveProjectConflict, resolveMappingEntryConflict } from './conflictResolution';

// ============================================
// SEZIONE: Download Progetti (Project Download)
// Scarica tutti i progetti accessibili dall'utente (o tutti se admin).
// Preserva la preferenza locale syncEnabled e risolve i conflitti.
// ============================================

export async function downloadProjectsFromSupabase(userId: string, isAdmin: boolean = false): Promise<number> {
  if (!isSupabaseConfigured()) {
    console.warn('⚠️  Download skipped: Supabase not configured');
    return 0;
  }

  if (!navigator.onLine) {
    console.warn('⚠️  Download skipped: No internet connection');
    return 0;
  }

  console.log(`⬇️  Downloading projects from Supabase for user ${userId}${isAdmin ? ' (admin)' : ''}...`);

  try {
    // Download ALL projects and filter client-side
    // This is less efficient but more reliable than PostgREST array queries
    const { data: allProjects, error } = await supabase
      .from('projects')
      .select('*');

    if (error) {
      throw new Error(`Failed to download projects: ${error.message}`);
    }

    if (!allProjects || allProjects.length === 0) {
      console.log('✅ No projects to download');
      return 0;
    }

    // Filter projects: admins see all, regular users see only accessible
    let userProjects;
    if (isAdmin) {
      console.log('👑 Admin user: downloading all projects');
      userProjects = allProjects;
    } else {
      userProjects = allProjects.filter((p: any) =>
        p.owner_id === userId ||
        (p.accessible_users && Array.isArray(p.accessible_users) && p.accessible_users.includes(userId))
      );
    }

    if (userProjects.length === 0) {
      console.log('✅ No projects accessible to this user');
      return 0;
    }

    console.log(`📥 Found ${userProjects.length} projects for user`);

    let downloadedCount = 0;

    for (const supabaseProject of userProjects) {
      // Convert Supabase format to IndexedDB format
      const project: Project = {
        id: supabaseProject.id,
        title: supabaseProject.title,
        client: supabaseProject.client,
        address: supabaseProject.address,
        notes: supabaseProject.notes,
        floors: supabaseProject.floors,
        plans: supabaseProject.plans,
        useRoomNumbering: supabaseProject.use_room_numbering,
        useInterventionNumbering: supabaseProject.use_intervention_numbering,
        typologies: supabaseProject.typologies,
        ownerId: supabaseProject.owner_id,
        accessibleUsers: supabaseProject.accessible_users || [],
        archived: supabaseProject.archived || 0,
        syncEnabled: 0, // Always default to 0 for newly downloaded projects (per-device preference)
        createdAt: new Date(supabaseProject.created_at).getTime(),
        updatedAt: new Date(supabaseProject.updated_at).getTime(),
        version: supabaseProject.version || 1,
        lastModified: supabaseProject.last_modified || new Date(supabaseProject.updated_at).getTime(),
        synced: 1
      };

      // Check if project exists locally
      const existingProject = await db.projects.get(project.id);

      if (existingProject) {
        // IMPORTANT: Preserve local syncEnabled preference when updating from remote
        project.syncEnabled = existingProject.syncEnabled;

        // Check for conflicts and resolve using conflict resolution strategy
        const hasConflict =
          existingProject.updatedAt !== project.updatedAt ||
          (existingProject.version || 1) !== (project.version || 1);

        if (hasConflict) {
          console.log(`⚠️  Conflict detected for project ${project.id} during download`);
          const resolved = await resolveProjectConflict(existingProject, supabaseProject, 'last-modified-wins');
          resolved.syncEnabled = existingProject.syncEnabled;
          await db.projects.put(resolved);
          console.log(`✅ Updated project from server with conflict resolution: ${project.title}`);
          downloadedCount++;
        } else if (project.updatedAt > existingProject.updatedAt) {
          await db.projects.put(project);
          console.log(`✅ Updated project from server: ${project.title}`);
          downloadedCount++;
        }
      } else {
        await db.projects.put(project);
        console.log(`✅ Downloaded new project: ${project.title}`);
        downloadedCount++;
      }
    }

    console.log(`✅ Downloaded ${downloadedCount} projects from Supabase`);
    return downloadedCount;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error('❌ Failed to download projects:', errorMessage);
    throw err;
  }
}

// ============================================
// SEZIONE: Download Mapping Entries (Mapping Entry Download)
// Scarica le mapping entries solo per i progetti con syncEnabled=1.
// Risolve i conflitti con la strategia last-modified-wins.
// ============================================

export async function downloadMappingEntriesFromSupabase(userId: string, isAdmin: boolean = false): Promise<number> {
  if (!isSupabaseConfigured()) {
    console.warn('⚠️  Download skipped: Supabase not configured');
    return 0;
  }

  if (!navigator.onLine) {
    console.warn('⚠️  Download skipped: No internet connection');
    return 0;
  }

  console.log(`⬇️  Downloading mapping entries from Supabase for user ${userId}${isAdmin ? ' (admin)' : ''}...`);

  try {
    // Get all project IDs that have syncEnabled = 1 (full sync)
    let userProjects;
    if (isAdmin) {
      console.log('👑 Admin user: downloading mapping entries for all sync-enabled projects');
      userProjects = await db.projects.where('syncEnabled').equals(1).toArray();
    } else {
      const allUserProjects = await db.projects
        .where('ownerId')
        .equals(userId)
        .or('accessibleUsers')
        .equals(userId)
        .toArray();

      userProjects = allUserProjects.filter(p => p.syncEnabled === 1);
    }

    if (userProjects.length === 0) {
      console.log('✅ No sync-enabled projects found, skipping mapping entries download');
      return 0;
    }

    const projectIds = userProjects.map(p => p.id);
    console.log(`📥 Downloading mapping entries for ${projectIds.length} sync-enabled projects`);

    const { data: mappingEntries, error } = await supabase
      .from('mapping_entries')
      .select('*')
      .in('project_id', projectIds);

    if (error) {
      throw new Error(`Failed to download mapping entries: ${error.message}`);
    }

    if (!mappingEntries || mappingEntries.length === 0) {
      console.log('✅ No mapping entries to download');
      return 0;
    }

    let downloadedCount = 0;

    for (const supabaseEntry of mappingEntries) {
      const mappingEntry: MappingEntry = {
        id: supabaseEntry.id,
        projectId: supabaseEntry.project_id,
        floor: supabaseEntry.floor,
        room: supabaseEntry.room || undefined,
        intervention: supabaseEntry.intervention || undefined,
        photos: supabaseEntry.photos || [],
        crossings: supabaseEntry.crossings || [],
        toComplete: supabaseEntry.to_complete || false,
        timestamp: new Date(supabaseEntry.created_at).getTime(),
        createdBy: supabaseEntry.created_by,
        lastModified: new Date(supabaseEntry.updated_at).getTime(),
        modifiedBy: supabaseEntry.modified_by,
        version: supabaseEntry.version || 1,
        synced: 1
      };

      const existingEntry = await db.mappingEntries.get(mappingEntry.id);

      if (existingEntry) {
        const hasConflict =
          existingEntry.lastModified !== mappingEntry.lastModified ||
          existingEntry.version !== mappingEntry.version;

        if (hasConflict) {
          console.log(`⚠️  Conflict detected for mapping entry ${mappingEntry.id} during download`);
          const resolved = await resolveMappingEntryConflict(existingEntry, supabaseEntry, 'last-modified-wins');
          await db.mappingEntries.put(resolved);
          console.log(`✅ Updated mapping entry from server with conflict resolution: ${mappingEntry.id}`);
          downloadedCount++;
        } else if (mappingEntry.lastModified > existingEntry.lastModified) {
          await db.mappingEntries.put(mappingEntry);
          console.log(`✅ Updated mapping entry from server: ${mappingEntry.id}`);
          downloadedCount++;
        }
      } else {
        await db.mappingEntries.put(mappingEntry);
        console.log(`✅ Downloaded new mapping entry: ${mappingEntry.id}`);
        downloadedCount++;
      }
    }

    console.log(`✅ Downloaded ${downloadedCount} mapping entries from Supabase`);
    return downloadedCount;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error('❌ Failed to download mapping entries:', errorMessage);
    throw err;
  }
}

// ============================================
// SEZIONE: Download Foto (Photo Download)
// Scarica i blob delle foto da Supabase Storage per i progetti con syncEnabled=1.
// Le query vengono eseguite in batch da 100 per evitare limiti URL di PostgREST.
// Salta le foto già presenti localmente (uploaded=true).
// ============================================

export async function downloadPhotosFromSupabase(userId: string, isAdmin: boolean = false): Promise<{ downloaded: number; failed: number }> {
  if (!isSupabaseConfigured()) {
    console.warn('⚠️  Download skipped: Supabase not configured');
    return { downloaded: 0, failed: 0 };
  }

  if (!navigator.onLine) {
    console.warn('⚠️  Download skipped: No internet connection');
    return { downloaded: 0, failed: 0 };
  }

  console.log(`⬇️  Downloading photos from Supabase for user ${userId}${isAdmin ? ' (admin)' : ''}...`);

  try {
    let userProjects;
    if (isAdmin) {
      console.log('👑 Admin user: downloading photos for all sync-enabled projects');
      userProjects = await db.projects.where('syncEnabled').equals(1).toArray();
    } else {
      const allUserProjects = await db.projects
        .where('ownerId')
        .equals(userId)
        .or('accessibleUsers')
        .equals(userId)
        .toArray();

      userProjects = allUserProjects.filter(p => p.syncEnabled === 1);
    }

    if (userProjects.length === 0) {
      console.log('✅ No sync-enabled projects found, skipping photos download');
      return { downloaded: 0, failed: 0 };
    }

    const projectIds = userProjects.map(p => p.id);
    console.log(`📥 Downloading photos for ${projectIds.length} sync-enabled projects`);

    const mappingEntries = await db.mappingEntries
      .where('projectId')
      .anyOf(projectIds)
      .toArray();

    if (mappingEntries.length === 0) {
      console.log('✅ No mapping entries found, skipping photos download');
      return { downloaded: 0, failed: 0 };
    }

    const mappingEntryIds = mappingEntries.map(e => e.id);
    console.log(`📥 Downloading photos for ${mappingEntryIds.length} mapping entries`);

    // Split into batches to avoid URL length limits (PostgREST has a limit on query string length)
    const BATCH_SIZE = 100;
    const allPhotoMetadata: any[] = [];

    for (let i = 0; i < mappingEntryIds.length; i += BATCH_SIZE) {
      const batch = mappingEntryIds.slice(i, i + BATCH_SIZE);
      console.log(`📥 Fetching photos batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(mappingEntryIds.length / BATCH_SIZE)} (${batch.length} entries)`);

      const { data: batchData, error: batchError } = await supabase
        .from('photos')
        .select('*')
        .in('mapping_entry_id', batch);

      if (batchError) {
        throw new Error(`Failed to download photo metadata (batch ${Math.floor(i / BATCH_SIZE) + 1}): ${batchError.message}`);
      }

      if (batchData && batchData.length > 0) {
        allPhotoMetadata.push(...batchData);
      }
    }

    if (allPhotoMetadata.length === 0) {
      console.log('✅ No photos to download');
      return { downloaded: 0, failed: 0 };
    }

    console.log(`📥 Found ${allPhotoMetadata.length} photos to download`);

    let downloadedCount = 0;
    let failedCount = 0;

    for (const photoMeta of allPhotoMetadata) {
      try {
        // Skip photos already present locally
        const existingPhoto = await db.photos.get(photoMeta.id);
        if (existingPhoto && existingPhoto.uploaded) {
          console.log(`⏭️  Photo ${photoMeta.id} already exists locally, skipping`);
          continue;
        }

        const { data: blob, error: downloadError } = await supabase.storage
          .from('photos')
          .download(photoMeta.storage_path);

        if (downloadError) {
          console.error(`❌ Failed to download photo ${photoMeta.id}:`, downloadError.message);
          failedCount++;
          continue;
        }

        if (!blob) {
          console.error(`❌ No blob returned for photo ${photoMeta.id}`);
          failedCount++;
          continue;
        }

        const photo: Photo = {
          id: photoMeta.id,
          blob: blob,
          mappingEntryId: photoMeta.mapping_entry_id,
          metadata: photoMeta.metadata,
          uploaded: true,
          remoteUrl: photoMeta.url
        };

        await db.photos.put(photo);
        console.log(`✅ Downloaded photo: ${photoMeta.id}`);
        downloadedCount++;
      } catch (photoErr) {
        const photoErrorMessage = photoErr instanceof Error ? photoErr.message : String(photoErr);
        console.error(`❌ Error downloading photo ${photoMeta.id}:`, photoErrorMessage);
        failedCount++;
      }
    }

    console.log(`✅ Downloaded ${downloadedCount} photos from Supabase${failedCount > 0 ? ` (${failedCount} failed)` : ''}`);
    return { downloaded: downloadedCount, failed: failedCount };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error('❌ Failed to download photos:', errorMessage);
    throw err;
  }
}

// ============================================
// SEZIONE: Download Planimetrie (Floor Plan Download)
// Scarica planimetrie e relativi blob immagine da Supabase Storage.
// Supporta bucket multipli (floor-plans, planimetrie) con parsing dinamico del path.
// Scarica il blob anche se i metadati sono aggiornati ma imageBlob è null.
// ============================================

export async function downloadFloorPlansFromSupabase(userId: string, isAdmin: boolean = false): Promise<number> {
  if (!isSupabaseConfigured()) {
    console.warn('⚠️  Download skipped: Supabase not configured');
    return 0;
  }

  if (!navigator.onLine) {
    console.warn('⚠️  Download skipped: No internet connection');
    return 0;
  }

  console.log(`⬇️  Downloading floor plans from Supabase for user ${userId}${isAdmin ? ' (admin)' : ''}...`);

  try {
    let userProjects;
    if (isAdmin) {
      console.log('👑 Admin user: downloading floor plans for all sync-enabled projects');
      userProjects = await db.projects.where('syncEnabled').equals(1).toArray();
    } else {
      const allUserProjects = await db.projects
        .where('ownerId')
        .equals(userId)
        .or('accessibleUsers')
        .equals(userId)
        .toArray();

      userProjects = allUserProjects.filter(p => p.syncEnabled === 1);
    }

    if (userProjects.length === 0) {
      console.log('✅ No sync-enabled projects found, skipping floor plans download');
      return 0;
    }

    const projectIds = userProjects.map(p => p.id);
    console.log(`📥 Downloading floor plans for ${projectIds.length} sync-enabled projects`);

    const { data: floorPlans, error } = await supabase
      .from('floor_plans')
      .select('*')
      .in('project_id', projectIds);

    if (error) {
      throw new Error(`Failed to download floor plans: ${error.message}`);
    }

    if (!floorPlans || floorPlans.length === 0) {
      console.log('✅ No floor plans to download');
      return 0;
    }

    console.log(`📥 Found ${floorPlans.length} floor plans to download`);

    let downloadedCount = 0;

    for (const supabaseFloorPlan of floorPlans) {
      try {
        const existingFloorPlan = await db.floorPlans.get(supabaseFloorPlan.id);

        if (existingFloorPlan) {
          const remoteUpdated = new Date(supabaseFloorPlan.updated_at).getTime();
          const localUpdated = existingFloorPlan.updatedAt;

          // Skip only if up to date AND imageBlob exists
          if (remoteUpdated <= localUpdated && existingFloorPlan.imageBlob) {
            console.log(`⏭️  Floor plan ${supabaseFloorPlan.id} is up to date, skipping`);
            continue;
          }

          // If imageBlob is missing, download it even if metadata is up to date
          if (remoteUpdated <= localUpdated && !existingFloorPlan.imageBlob) {
            console.log(`📥 Floor plan ${supabaseFloorPlan.id} metadata is up to date but imageBlob is missing, downloading image...`);
          }
        }

        // Download image blob from Supabase Storage
        let imageBlob = null;
        let thumbnailBlob = null;

        if (supabaseFloorPlan.image_url) {
          try {
            console.log(`📥 Attempting to download floor plan image for ${supabaseFloorPlan.id}`);
            console.log(`   Image URL: ${supabaseFloorPlan.image_url}`);

            const imageUrl = new URL(supabaseFloorPlan.image_url);
            console.log(`   Parsed URL pathname: ${imageUrl.pathname}`);

            // Support both 'floor-plans' and 'planimetrie' bucket names (dynamic parsing)
            let imagePath: string | undefined;
            let bucketName = 'floor-plans'; // default

            if (imageUrl.pathname.includes('/storage/v1/object/public/floor-plans/')) {
              imagePath = imageUrl.pathname.split('/storage/v1/object/public/floor-plans/')[1];
              bucketName = 'floor-plans';
            } else if (imageUrl.pathname.includes('/storage/v1/object/public/planimetrie/')) {
              imagePath = imageUrl.pathname.split('/storage/v1/object/public/planimetrie/')[1];
              bucketName = 'planimetrie';
            } else {
              const match = imageUrl.pathname.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.*)/);
              if (match) {
                bucketName = match[1];
                imagePath = match[2];
              }
            }

            console.log(`   Extracted image path: ${imagePath}`);
            console.log(`   Using bucket: ${bucketName}`);

            if (imagePath) {
              const { data: blob, error: downloadError } = await supabase.storage
                .from(bucketName)
                .download(imagePath);

              if (!downloadError && blob) {
                imageBlob = blob;
                console.log(`✅ Successfully downloaded floor plan image for ${supabaseFloorPlan.id} (size: ${blob.size} bytes)`);
              } else {
                console.error(`❌ Failed to download floor plan image for ${supabaseFloorPlan.id}:`);
                console.error(`   Error: ${downloadError?.message || 'Unknown error'}`);
                console.error(`   Blob: ${blob}`);
              }
            } else {
              console.error(`❌ Failed to extract image path from URL for ${supabaseFloorPlan.id}`);
            }
          } catch (urlErr) {
            console.error(`❌ Failed to parse floor plan image URL for ${supabaseFloorPlan.id}:`, urlErr);
            console.error(`   URL was: ${supabaseFloorPlan.image_url}`);
          }
        } else {
          console.warn(`⚠️  No image_url for floor plan ${supabaseFloorPlan.id}`);
        }

        // Download thumbnail blob
        if (supabaseFloorPlan.thumbnail_url) {
          try {
            const thumbnailUrl = new URL(supabaseFloorPlan.thumbnail_url);
            let thumbnailPath: string | undefined;
            let bucketName = 'floor-plans';

            if (thumbnailUrl.pathname.includes('/storage/v1/object/public/floor-plans/')) {
              thumbnailPath = thumbnailUrl.pathname.split('/storage/v1/object/public/floor-plans/')[1];
              bucketName = 'floor-plans';
            } else if (thumbnailUrl.pathname.includes('/storage/v1/object/public/planimetrie/')) {
              thumbnailPath = thumbnailUrl.pathname.split('/storage/v1/object/public/planimetrie/')[1];
              bucketName = 'planimetrie';
            } else {
              const match = thumbnailUrl.pathname.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.*)/);
              if (match) {
                bucketName = match[1];
                thumbnailPath = match[2];
              }
            }

            if (thumbnailPath) {
              const { data: blob, error: downloadError } = await supabase.storage
                .from(bucketName)
                .download(thumbnailPath);

              if (!downloadError && blob) {
                thumbnailBlob = blob;
              } else {
                console.warn(`⚠️  Failed to download floor plan thumbnail for ${supabaseFloorPlan.id}: ${downloadError?.message}`);
              }
            }
          } catch (urlErr) {
            console.warn(`⚠️  Failed to parse floor plan thumbnail URL: ${urlErr}`);
          }
        }

        // Convert Supabase format to IndexedDB format
        const floorPlan = {
          id: supabaseFloorPlan.id,
          projectId: supabaseFloorPlan.project_id,
          floor: supabaseFloorPlan.floor,
          imageUrl: supabaseFloorPlan.image_url,
          thumbnailUrl: supabaseFloorPlan.thumbnail_url,
          imageBlob: imageBlob,
          thumbnailBlob: thumbnailBlob,
          originalFilename: supabaseFloorPlan.original_filename,
          originalFormat: supabaseFloorPlan.original_format,
          width: supabaseFloorPlan.width,
          height: supabaseFloorPlan.height,
          metadata: supabaseFloorPlan.metadata || {},
          createdBy: supabaseFloorPlan.created_by,
          createdAt: new Date(supabaseFloorPlan.created_at).getTime(),
          updatedAt: new Date(supabaseFloorPlan.updated_at).getTime(),
          synced: 1 as 0 | 1
        };

        if (!imageBlob && supabaseFloorPlan.image_url) {
          console.warn(`⚠️  WARNING: Saving floor plan ${supabaseFloorPlan.id} with NULL imageBlob even though image_url exists!`);
          console.warn(`   This floor plan will not be viewable until the image is downloaded successfully.`);
        }

        await db.floorPlans.put(floorPlan);
        console.log(`✅ Downloaded floor plan: ${supabaseFloorPlan.id} for project ${supabaseFloorPlan.project_id}, floor ${supabaseFloorPlan.floor} (imageBlob: ${imageBlob ? 'YES' : 'NO'})`);
        downloadedCount++;
      } catch (floorPlanErr) {
        const errorMessage = floorPlanErr instanceof Error ? floorPlanErr.message : String(floorPlanErr);
        console.error(`❌ Error downloading floor plan ${supabaseFloorPlan.id}:`, errorMessage);
        // Continue with next floor plan even if one fails
      }
    }

    console.log(`✅ Downloaded ${downloadedCount} floor plans from Supabase`);
    return downloadedCount;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error('❌ Failed to download floor plans:', errorMessage);
    throw err;
  }
}

// ============================================
// SEZIONE: Download Punti Planimetria (Floor Plan Points Download)
// Scarica i punti per tutte le planimetrie presenti localmente.
// Salta i punti già aggiornati confrontando updated_at.
// ============================================

export async function downloadFloorPlanPointsFromSupabase(userId: string, isAdmin: boolean = false): Promise<number> {
  if (!isSupabaseConfigured()) {
    console.warn('⚠️  Download skipped: Supabase not configured');
    return 0;
  }

  if (!navigator.onLine) {
    console.warn('⚠️  Download skipped: No internet connection');
    return 0;
  }

  console.log(`⬇️  Downloading floor plan points from Supabase for user ${userId}${isAdmin ? ' (admin)' : ''}...`);

  try {
    const localFloorPlans = await db.floorPlans.toArray();

    if (localFloorPlans.length === 0) {
      console.log('✅ No floor plans found locally, skipping floor plan points download');
      return 0;
    }

    const floorPlanIds = localFloorPlans.map(fp => fp.id);
    console.log(`📥 Downloading floor plan points for ${floorPlanIds.length} floor plans`);

    const { data: floorPlanPoints, error } = await supabase
      .from('floor_plan_points')
      .select('*')
      .in('floor_plan_id', floorPlanIds);

    if (error) {
      throw new Error(`Failed to download floor plan points: ${error.message}`);
    }

    if (!floorPlanPoints || floorPlanPoints.length === 0) {
      console.log('✅ No floor plan points to download');
      return 0;
    }

    console.log(`📥 Found ${floorPlanPoints.length} floor plan points to download`);

    let downloadedCount = 0;

    for (const supabasePoint of floorPlanPoints) {
      try {
        const existingPoint = await db.floorPlanPoints.get(supabasePoint.id);

        if (existingPoint) {
          const remoteUpdated = new Date(supabasePoint.updated_at).getTime();
          const localUpdated = existingPoint.updatedAt;

          if (remoteUpdated <= localUpdated) {
            console.log(`⏭️  Floor plan point ${supabasePoint.id} is up to date, skipping`);
            continue;
          }
        }

        const point = {
          id: supabasePoint.id,
          floorPlanId: supabasePoint.floor_plan_id,
          mappingEntryId: supabasePoint.mapping_entry_id,
          pointType: supabasePoint.point_type,
          pointX: supabasePoint.point_x,
          pointY: supabasePoint.point_y,
          labelX: supabasePoint.label_x,
          labelY: supabasePoint.label_y,
          perimeterPoints: supabasePoint.perimeter_points,
          customText: supabasePoint.custom_text,
          metadata: supabasePoint.metadata || {},
          createdBy: supabasePoint.created_by,
          createdAt: new Date(supabasePoint.created_at).getTime(),
          updatedAt: new Date(supabasePoint.updated_at).getTime(),
          synced: 1 as 0 | 1
        };

        await db.floorPlanPoints.put(point);
        console.log(`✅ Downloaded floor plan point: ${supabasePoint.id} (${supabasePoint.point_type})`);
        downloadedCount++;
      } catch (pointErr) {
        const errorMessage = pointErr instanceof Error ? pointErr.message : String(pointErr);
        console.error(`❌ Error downloading floor plan point ${supabasePoint.id}:`, errorMessage);
        // Continue with next point even if one fails
      }
    }

    console.log(`✅ Downloaded ${downloadedCount} floor plan points from Supabase`);
    return downloadedCount;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error('❌ Failed to download floor plan points:', errorMessage);
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
  try {
    let userProjects;
    if (isAdmin) {
      userProjects = await db.projects.where('syncEnabled').equals(1).toArray();
    } else {
      const allUserProjects = await db.projects
        .where('ownerId').equals(userId)
        .or('accessibleUsers').equals(userId)
        .toArray();
      userProjects = allUserProjects.filter(p => p.syncEnabled === 1);
    }

    if (userProjects.length === 0) return;

    const projectIds = userProjects.map(p => p.id);

    // Get photo presence from Supabase grouped by mapping_entry_id
    const { data: photoCounts, error } = await supabase
      .from('photos')
      .select('mapping_entry_id')
      .in('mapping_entry_id', (await db.mappingEntries.where('projectId').anyOf(projectIds).toArray()).map(e => e.id));

    if (error || !photoCounts) return;

    // Count remote photos per mapping entry
    const remotePhotoMap = new Map<string, number>();
    for (const row of photoCounts) {
      remotePhotoMap.set(row.mapping_entry_id, (remotePhotoMap.get(row.mapping_entry_id) || 0) + 1);
    }

    // Count local photos per mapping entry
    const localPhotos = await db.photos.toArray();
    const localPhotoMap = new Map<string, number>();
    for (const photo of localPhotos) {
      localPhotoMap.set(photo.mappingEntryId, (localPhotoMap.get(photo.mappingEntryId) || 0) + 1);
    }

    // Update hasRemotePhotos flag on entries where server has more photos than local
    const entries = await db.mappingEntries.where('projectId').anyOf(projectIds).toArray();
    for (const entry of entries) {
      const remoteCount = remotePhotoMap.get(entry.id) || 0;
      const localCount = localPhotoMap.get(entry.id) || 0;
      const hasRemotePhotos = remoteCount > localCount;

      if (entry.hasRemotePhotos !== hasRemotePhotos) {
        await db.mappingEntries.update(entry.id, { hasRemotePhotos });
      }
    }

    console.log('📷 Remote photo flags aggiornati');
  } catch (err) {
    console.warn('Failed to update remote photo flags:', err);
  }
}