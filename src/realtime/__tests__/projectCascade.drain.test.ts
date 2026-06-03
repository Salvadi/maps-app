/**
 * Test per drainPendingCascades e retry cascade (B8)
 *
 * Usa il database Dexie reale con fake-indexeddb.
 */
import { db } from '../../db/database';
import { handleProjectDeleteLocal, drainPendingCascades } from '../projectCascade';
import type { ChangeLogRow } from '../eventStream';

// ---------------------------------------------------------------------------
// Helpers minimi
// ---------------------------------------------------------------------------

function makeProject(id: string) {
  return {
    id,
    title: 'Progetto test',
    client: 'Cliente test',
    address: 'Via test 1',
    notes: '',
    floors: ['0'],
    plans: [],
    useRoomNumbering: false,
    useInterventionNumbering: false,
    typologies: [],
    ownerId: 'user-1',
    accessibleUsers: [],
    archived: 0,
    syncEnabled: 0,
    createdAt: 1000,
    updatedAt: 1000,
    synced: 0,
  };
}

function makeMappingEntry(id: string, projectId: string) {
  return {
    id,
    projectId,
    floor: '0',
    photoIds: [],
    crossings: [],
    timestamp: 1000,
    createdBy: 'user-1',
    lastModified: 1000,
    modifiedBy: 'user-1',
    version: 1,
    synced: 0,
  };
}

function makeDeleteEvent(rowId: string): ChangeLogRow {
  return {
    seq: '1',
    table_name: 'projects',
    row_id: rowId,
    op: 'DELETE',
    project_id: rowId,
    user_id: null,
    originator: null,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(async () => {
  await db.projects.clear();
  await db.mappingEntries.clear();
  await db.structureEntries.clear();
  await db.floorPlans.clear();
  await db.floorPlanPoints.clear();
  await db.sals.clear();
  await db.typologyPrices.clear();
  await db.photos.clear();
  await db.metadata.clear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('drainPendingCascades', () => {
  test('drainPendingCascades esegue il cascade e rimuove il marker', async () => {
    await db.projects.put(makeProject('proj-1'));
    await db.mappingEntries.put(makeMappingEntry('me-1', 'proj-1'));

    await db.metadata.put({
      key: 'pendingCascade:proj-1',
      value: {
        projectId: 'proj-1',
        attempts: 0,
        lastError: 'quota',
        scheduledAt: 1000,
      },
    });

    await drainPendingCascades();

    const proj = await db.projects.get('proj-1');
    expect(proj).toBeUndefined();

    const marker = await db.metadata.get('pendingCascade:proj-1');
    expect(marker).toBeUndefined();
  });

  test('handleProjectDeleteLocal persiste un marker e rilancia quando la transazione fallisce', async () => {
    const spy = jest.spyOn(db, 'transaction').mockRejectedValueOnce(new Error('QuotaExceededError'));
    const ev = makeDeleteEvent('proj-1');

    await expect(handleProjectDeleteLocal(ev)).rejects.toThrow('QuotaExceededError');

    const marker = await db.metadata.get('pendingCascade:proj-1');
    expect(marker).toBeDefined();
    expect(marker!.value.attempts).toBe(0);
    expect(marker!.value.projectId).toBe('proj-1');

    spy.mockRestore();
  });

  test('drainPendingCascades incrementa attempts e mantiene il marker se il cascade fallisce', async () => {
    await db.metadata.put({
      key: 'pendingCascade:proj-1',
      value: {
        projectId: 'proj-1',
        attempts: 1,
        lastError: 'previous',
        scheduledAt: 1000,
      },
    });

    const spy = jest.spyOn(db, 'transaction').mockRejectedValueOnce(new Error('lock'));

    await drainPendingCascades();

    const marker = await db.metadata.get('pendingCascade:proj-1');
    expect(marker).toBeDefined();
    expect(marker!.value.attempts).toBe(2);

    spy.mockRestore();
  });
});