import { db } from '../db';
import type { ChangeLogRow } from './eventStream';

export async function handleProjectDeleteLocal(ev: ChangeLogRow): Promise<void> {
  if (ev.table_name !== 'projects' || ev.op !== 'DELETE') return;
  const projectId = ev.row_id;
  await db.transaction('rw', [
    db.projects,
    db.mappingEntries,
    db.structureEntries,
    db.photos,
    db.floorPlans,
    db.floorPlanPoints,
    db.sals,
    db.typologyPrices,
  ], async () => {
    const fpIds = await db.floorPlans.where('projectId').equals(projectId).primaryKeys() as string[];
    const meIds = await db.mappingEntries.where('projectId').equals(projectId).primaryKeys() as string[];
    const seIds = await db.structureEntries.where('projectId').equals(projectId).primaryKeys() as string[];
    await db.photos.where('mappingEntryId').anyOf([...meIds, ...seIds]).delete();
    await db.floorPlanPoints.where('floorPlanId').anyOf(fpIds).delete();
    await db.mappingEntries.where('projectId').equals(projectId).delete();
    await db.structureEntries.where('projectId').equals(projectId).delete();
    await db.floorPlans.where('projectId').equals(projectId).delete();
    await db.sals.where('projectId').equals(projectId).delete();
    await db.typologyPrices.where('projectId').equals(projectId).delete();
    await db.projects.delete(projectId);
  });
}
