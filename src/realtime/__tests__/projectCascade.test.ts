/**
 * Test per src/realtime/projectCascade.ts
 *
 * Usa il database Dexie reale con fake-indexeddb (configurato in setupTests.ts).
 * Ogni test pulisce il db prima di popolare i propri dati.
 */
import { db } from '../../db/database';
import { handleProjectDeleteLocal } from '../projectCascade';
import type { ChangeLogRow } from '../eventStream';

// ---------------------------------------------------------------------------
// Helpers per creare record minimali validi per le tabelle Dexie
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

function makeStructureEntry(id: string, projectId: string) {
  return {
    id,
    projectId,
    floor: '0',
    photoIds: [],
    structures: [],
    timestamp: 1000,
    createdBy: 'user-1',
    lastModified: 1000,
    modifiedBy: 'user-1',
    version: 1,
    synced: 0 as const,
  };
}

function makeFloorPlan(id: string, projectId: string) {
  return {
    id,
    projectId,
    floor: '0',
    originalFilename: 'piano.png',
    originalFormat: 'image/png',
    width: 100,
    height: 100,
    createdBy: 'user-1',
    createdAt: 1000,
    updatedAt: 1000,
    synced: 0 as const,
  };
}

function makeFloorPlanPoint(id: string, floorPlanId: string) {
  return {
    id,
    floorPlanId,
    pointType: 'generico' as const,
    pointX: 0.5,
    pointY: 0.5,
    labelX: 0.5,
    labelY: 0.5,
    createdBy: 'user-1',
    createdAt: 1000,
    updatedAt: 1000,
    synced: 0 as const,
  };
}

function makeSal(id: string, projectId: string) {
  return {
    id,
    projectId,
    number: 1,
    date: 1000,
    createdAt: 1000,
    synced: 0 as const,
  };
}

function makeTypologyPrice(id: string, projectId: string) {
  return {
    id,
    projectId,
    attraversamento: 'Tubo metallico NUDO',
    pricePerUnit: 10,
    unit: 'piece' as const,
    synced: 0 as const,
  };
}

/**
 * Photo: usa mappingEntryId per riferimento sia a mappingEntry che a structureEntry
 * (come fa la cascade: anyOf([...meIds, ...seIds]) su mappingEntryId).
 */
function makePhoto(id: string, refId: string) {
  return {
    id,
    mappingEntryId: refId,
    metadata: {
      width: 10,
      height: 10,
      size: 100,
      mimeType: 'image/jpeg',
      captureTimestamp: 1000,
    },
    uploaded: false,
  };
}

// ---------------------------------------------------------------------------
// Evento DELETE di progetto
// ---------------------------------------------------------------------------

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
// Setup dati di test per proj-1
// ---------------------------------------------------------------------------

async function populateProj1() {
  const proj = makeProject('proj-1');
  const me1 = makeMappingEntry('me-1', 'proj-1');
  const me2 = makeMappingEntry('me-2', 'proj-1');
  const se1 = makeStructureEntry('se-1', 'proj-1');
  const fp1 = makeFloorPlan('fp-1', 'proj-1');
  const fp2 = makeFloorPlan('fp-2', 'proj-1');
  const fpp1 = makeFloorPlanPoint('fpp-1', 'fp-1');
  const fpp2 = makeFloorPlanPoint('fpp-2', 'fp-1');
  const fpp3 = makeFloorPlanPoint('fpp-3', 'fp-2');
  const sal1 = makeSal('sal-1', 'proj-1');
  const sal2 = makeSal('sal-2', 'proj-1');
  const tp1 = makeTypologyPrice('tp-1', 'proj-1');
  // 2 foto collegate a me-1, 1 foto collegata a se-1 (tramite mappingEntryId)
  const photo1 = makePhoto('photo-1', 'me-1');
  const photo2 = makePhoto('photo-2', 'me-1');
  const photo3 = makePhoto('photo-3', 'se-1');

  await db.projects.put(proj);
  await db.mappingEntries.bulkPut([me1, me2]);
  await db.structureEntries.put(se1);
  await db.floorPlans.bulkPut([fp1, fp2]);
  await db.floorPlanPoints.bulkPut([fpp1, fpp2, fpp3]);
  await db.sals.bulkPut([sal1, sal2]);
  await db.typologyPrices.put(tp1);
  await db.photos.bulkPut([photo1, photo2, photo3]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(async () => {
  // Svuota le tabelle rilevanti prima di ogni test
  await db.projects.clear();
  await db.mappingEntries.clear();
  await db.structureEntries.clear();
  await db.floorPlans.clear();
  await db.floorPlanPoints.clear();
  await db.sals.clear();
  await db.typologyPrices.clear();
  await db.photos.clear();
});

describe('handleProjectDeleteLocal', () => {
  // 1. Evento non-project → nessuna modifica (early return)
  test('evento non-project non tocca i dati', async () => {
    await populateProj1();

    const ev: ChangeLogRow = {
      seq: '2',
      table_name: 'mapping_entries',
      row_id: 'proj-1',
      op: 'DELETE',
      project_id: 'proj-1',
      user_id: null,
      originator: null,
    };

    await handleProjectDeleteLocal(ev);

    const proj = await db.projects.get('proj-1');
    expect(proj).toBeDefined();
    const meCount = await db.mappingEntries.where('projectId').equals('proj-1').count();
    expect(meCount).toBe(2);
  });

  // 2. Evento INSERT su projects → nessuna modifica (solo DELETE triggera cascata)
  test('evento projects INSERT non triggera cascade', async () => {
    await populateProj1();

    const ev: ChangeLogRow = {
      seq: '2',
      table_name: 'projects',
      row_id: 'proj-1',
      op: 'INSERT',
      project_id: 'proj-1',
      user_id: null,
      originator: null,
    };

    await handleProjectDeleteLocal(ev);

    const proj = await db.projects.get('proj-1');
    expect(proj).toBeDefined();
    const meCount = await db.mappingEntries.where('projectId').equals('proj-1').count();
    expect(meCount).toBe(2);
    const fpCount = await db.floorPlans.where('projectId').equals('proj-1').count();
    expect(fpCount).toBe(2);
  });

  // 3. Evento projects DELETE → cascata completa
  test('projects DELETE cancella tutti i dati del progetto', async () => {
    await populateProj1();

    await handleProjectDeleteLocal(makeDeleteEvent('proj-1'));

    // Progetto rimosso
    const proj = await db.projects.get('proj-1');
    expect(proj).toBeUndefined();

    // MappingEntries rimosse
    const meCount = await db.mappingEntries.where('projectId').equals('proj-1').count();
    expect(meCount).toBe(0);

    // StructureEntries rimosse
    const seCount = await db.structureEntries.where('projectId').equals('proj-1').count();
    expect(seCount).toBe(0);

    // FloorPlans rimossi
    const fpCount = await db.floorPlans.where('projectId').equals('proj-1').count();
    expect(fpCount).toBe(0);

    // FloorPlanPoints rimossi
    const fppCount = await db.floorPlanPoints.where('floorPlanId').anyOf(['fp-1', 'fp-2']).count();
    expect(fppCount).toBe(0);

    // SALs rimossi
    const salCount = await db.sals.where('projectId').equals('proj-1').count();
    expect(salCount).toBe(0);

    // TypologyPrices rimossi
    const tpCount = await db.typologyPrices.where('projectId').equals('proj-1').count();
    expect(tpCount).toBe(0);

    // Foto rimosse (inclusa quella collegata a se-1 via mappingEntryId)
    const photoCount = await db.photos.bulkGet(['photo-1', 'photo-2', 'photo-3']);
    expect(photoCount.filter(Boolean).length).toBe(0);
  });

  // 4. DELETE di progetto inesistente → nessun errore, nessun side effect
  test('DELETE di progetto inesistente non lancia errori e non modifica altri dati', async () => {
    await populateProj1();

    // Aggiunge un secondo progetto per verificare che non venga toccato
    await db.projects.put(makeProject('proj-other'));
    await db.mappingEntries.put(makeMappingEntry('me-other', 'proj-other'));

    await expect(
      handleProjectDeleteLocal(makeDeleteEvent('proj-not-exists'))
    ).resolves.toBeUndefined();

    // proj-1 intatto
    const proj1 = await db.projects.get('proj-1');
    expect(proj1).toBeDefined();

    // proj-other intatto
    const projOther = await db.projects.get('proj-other');
    expect(projOther).toBeDefined();

    const meOtherCount = await db.mappingEntries.where('projectId').equals('proj-other').count();
    expect(meOtherCount).toBe(1);
  });
});
