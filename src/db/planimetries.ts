import { db, generateId, now, Planimetry, PlanimetryPoint, PlanimetryLine } from './database';

// ============ PLANIMETRY CRUD ============

export async function createPlanimetry(
  projectId: string,
  floor: string,
  planName: string,
  imageName: string,
  imageData: string
): Promise<Planimetry> {
  const planimetry: Planimetry = {
    id: generateId(),
    projectId,
    floor,
    planName,
    imageName,
    imageData,
    rotation: 0,
    markerScale: 1,
    createdAt: now(),
    updatedAt: now(),
    synced: 0
  };

  await db.planimetries.add(planimetry);
  return planimetry;
}

export async function getPlanimetry(id: string): Promise<Planimetry | undefined> {
  return db.planimetries.get(id);
}

export async function getPlanimetriesByProject(projectId: string): Promise<Planimetry[]> {
  return db.planimetries.where('projectId').equals(projectId).toArray();
}

export async function getPlanimetryByProjectAndFloor(
  projectId: string,
  floor: string
): Promise<Planimetry | undefined> {
  return db.planimetries
    .where(['projectId', 'floor'])
    .equals([projectId, floor])
    .first();
}

export async function updatePlanimetry(
  id: string,
  updates: Partial<Omit<Planimetry, 'id' | 'projectId' | 'createdAt'>>
): Promise<void> {
  await db.planimetries.update(id, {
    ...updates,
    updatedAt: now(),
    synced: 0
  });
}

export async function deletePlanimetry(id: string): Promise<void> {
  // Delete associated points and lines first
  await db.planimetryPoints.where('planimetryId').equals(id).delete();
  await db.planimetryLines.where('planimetryId').equals(id).delete();
  // Then delete the planimetry
  await db.planimetries.delete(id);
}

// ============ PLANIMETRY POINTS CRUD ============

export async function addPlanimetryPoint(
  planimetryId: string,
  point: Omit<PlanimetryPoint, 'id' | 'planimetryId' | 'createdAt' | 'synced'>
): Promise<PlanimetryPoint> {
  const newPoint: PlanimetryPoint = {
    id: generateId(),
    planimetryId,
    ...point,
    createdAt: now(),
    synced: 0
  };

  await db.planimetryPoints.add(newPoint);
  return newPoint;
}

export async function getPlanimetryPoints(planimetryId: string): Promise<PlanimetryPoint[]> {
  return db.planimetryPoints.where('planimetryId').equals(planimetryId).toArray();
}

export async function updatePlanimetryPoint(
  id: string,
  updates: Partial<Omit<PlanimetryPoint, 'id' | 'planimetryId' | 'createdAt'>>
): Promise<void> {
  await db.planimetryPoints.update(id, {
    ...updates,
    synced: 0
  });
}

export async function deletePlanimetryPoint(id: string): Promise<void> {
  await db.planimetryPoints.delete(id);
}

export async function deleteAllPlanimetryPoints(planimetryId: string): Promise<void> {
  await db.planimetryPoints.where('planimetryId').equals(planimetryId).delete();
}

// ============ PLANIMETRY LINES CRUD ============

export async function addPlanimetryLine(
  planimetryId: string,
  line: Omit<PlanimetryLine, 'id' | 'planimetryId' | 'synced'>
): Promise<PlanimetryLine> {
  const newLine: PlanimetryLine = {
    id: generateId(),
    planimetryId,
    ...line,
    synced: 0
  };

  await db.planimetryLines.add(newLine);
  return newLine;
}

export async function getPlanimetryLines(planimetryId: string): Promise<PlanimetryLine[]> {
  return db.planimetryLines.where('planimetryId').equals(planimetryId).toArray();
}

export async function deletePlanimetryLine(id: string): Promise<void> {
  await db.planimetryLines.delete(id);
}

export async function deleteAllPlanimetryLines(planimetryId: string): Promise<void> {
  await db.planimetryLines.where('planimetryId').equals(planimetryId).delete();
}

// ============ BULK OPERATIONS ============

export async function savePlanimetryWithData(
  planimetryId: string,
  imageData: string,
  imageName: string,
  points: Array<Omit<PlanimetryPoint, 'id' | 'planimetryId' | 'createdAt' | 'synced'>>,
  lines: Array<Omit<PlanimetryLine, 'id' | 'planimetryId' | 'synced'>>,
  rotation: number,
  markerScale: number
): Promise<void> {
  // Update planimetry
  await updatePlanimetry(planimetryId, {
    imageData,
    imageName,
    rotation,
    markerScale
  });

  // Clear existing points and lines
  await deleteAllPlanimetryPoints(planimetryId);
  await deleteAllPlanimetryLines(planimetryId);

  // Add new points
  for (const point of points) {
    await addPlanimetryPoint(planimetryId, point);
  }

  // Add new lines
  for (const line of lines) {
    await addPlanimetryLine(planimetryId, line);
  }
}

export async function getFullPlanimetry(planimetryId: string): Promise<{
  planimetry: Planimetry;
  points: PlanimetryPoint[];
  lines: PlanimetryLine[];
} | null> {
  const planimetry = await getPlanimetry(planimetryId);
  if (!planimetry) return null;

  const [points, lines] = await Promise.all([
    getPlanimetryPoints(planimetryId),
    getPlanimetryLines(planimetryId)
  ]);

  return { planimetry, points, lines };
}

// ============ HELPER FUNCTIONS ============

export async function hasPlanimetryForFloor(projectId: string, floor: string): Promise<boolean> {
  const planimetry = await getPlanimetryByProjectAndFloor(projectId, floor);
  return planimetry !== undefined;
}

export async function getPlanimetryCount(projectId: string): Promise<number> {
  return db.planimetries.where('projectId').equals(projectId).count();
}
