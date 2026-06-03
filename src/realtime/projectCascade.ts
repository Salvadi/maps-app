import { db } from '../db';
import type { ChangeLogRow } from './eventStream';

// B8: chiave marker in db.metadata per i cascade falliti (es. quota IndexedDB).
// La tabella metadata sopravvive ai sync reset, quindi il marker resiste al riavvio.
const PENDING_CASCADE_PREFIX = 'pendingCascade:';
const MAX_CASCADE_ATTEMPTS = 5;

interface PendingCascade {
  projectId: string;
  attempts: number;
  lastError: string;
  scheduledAt: number;
}

// Esegue la cancellazione a cascata su Dexie. Isolata cosi' da poter essere
// ritentata dal drain senza dover ricostruire un ChangeLogRow fittizio.
async function runProjectCascade(projectId: string): Promise<void> {
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

// Best-effort: persiste un marker per ritentare il cascade al boot successivo.
// Non deve mai lanciare a sua volta (es. se anche metadata e' in quota).
async function markPendingCascade(projectId: string, err: unknown): Promise<void> {
  try {
    const key = `${PENDING_CASCADE_PREFIX}${projectId}`;
    const existing = await db.metadata.get(key);
    const prev = existing?.value as PendingCascade | undefined;
    const value: PendingCascade = {
      projectId,
      attempts: prev?.attempts ?? 0,
      lastError: String((err as any)?.message ?? err),
      scheduledAt: Date.now(),
    };
    await db.metadata.put({ key, value });
  } catch (markErr) {
    console.error('[projectCascade] impossibile persistere il marker di retry', markErr);
  }
}

export async function handleProjectDeleteLocal(ev: ChangeLogRow): Promise<void> {
  if (ev.table_name !== 'projects' || ev.op !== 'DELETE') return;
  const projectId = ev.row_id;
  try {
    await runProjectCascade(projectId);
  } catch (err) {
    // B8: la transazione puo' fallire (QuotaExceededError / lock conteso).
    // Persistiamo il marker per il retry al boot e rilanciamo per il log di eventStream.
    console.error('[projectCascade] cascade fallito, schedulo retry', err);
    await markPendingCascade(projectId, err);
    throw err;
  }
}

// B8: al boot riprova i cascade rimasti in sospeso. Da chiamare dopo eventStream.init().
export async function drainPendingCascades(): Promise<void> {
  let items: { key: string; value: any }[];
  try {
    items = await db.metadata.where('key').startsWith(PENDING_CASCADE_PREFIX).toArray();
  } catch (err) {
    console.error('[projectCascade] impossibile leggere i cascade pendenti', err);
    return;
  }

  for (const item of items) {
    const pending = item.value as PendingCascade;
    try {
      await runProjectCascade(pending.projectId);
      await db.metadata.delete(item.key);
    } catch (err) {
      const attempts = (pending.attempts ?? 0) + 1;
      if (attempts >= MAX_CASCADE_ATTEMPTS) {
        console.error(`[projectCascade] retry esauriti per ${pending.projectId} dopo ${attempts} tentativi`, err);
        // Lasciamo il marker: verra' risolto dal prossimo clearAndSync (redownload pulito).
        await db.metadata.put({
          key: item.key,
          value: { ...pending, attempts, lastError: String((err as any)?.message ?? err) },
        });
      } else {
        await db.metadata.put({
          key: item.key,
          value: { ...pending, attempts, lastError: String((err as any)?.message ?? err), scheduledAt: Date.now() },
        });
      }
    }
  }
}
