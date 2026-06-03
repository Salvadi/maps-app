/**
 * Test migration v14: MappingEntry/StructureEntry usano photoIds[] (riferimenti)
 * invece di photos[] embedded. La tabella `photos` resta la fonte di verità.
 *
 * Usa il db Dexie reale con fake-indexeddb (setupTests.ts).
 */

// Mock sync/homeserver per forzare il path locale e neutralizzare l'upload.
jest.mock('../../sync/syncEngine', () => ({
  triggerImmediateUpload: jest.fn(),
}));
jest.mock('../../lib/homeserver', () => ({
  isHomeserverConfigured: () => false,
  apiFetchJson: jest.fn(),
}));

import { db } from '../database';
import {
  createMappingEntry,
  getPhotosForMapping,
  addPhotosToMapping,
  removePhotoFromMapping,
} from '../mappings';
import { convertRemoteToLocalMapping } from '../../sync/conflictResolution';
import { convertRemoteToLocalStructure } from '../structures';

function blob(content = 'x'): Blob {
  return new Blob([content], { type: 'image/jpeg' });
}

beforeEach(async () => {
  await db.mappingEntries.clear();
  await db.structureEntries.clear();
  await db.photos.clear();
  await db.syncQueue.clear();
});

describe('migration v14 — photoIds', () => {
  test('createMappingEntry popola photoIds e le righe vivono nella tabella photos', async () => {
    const entry = await createMappingEntry(
      {
        projectId: 'proj-1',
        floor: '0',
        crossings: [],
        createdBy: 'user-1',
      } as any,
      [blob('a'), blob('b')]
    );

    expect(entry.photoIds).toHaveLength(2);
    expect((entry as any).photos).toBeUndefined();

    const photos = await getPhotosForMapping(entry.id);
    expect(photos).toHaveLength(2);
    expect(new Set(photos.map((p) => p.id))).toEqual(new Set(entry.photoIds));
  });

  test('addPhotosToMapping accoda gli id e removePhotoFromMapping li rimuove', async () => {
    const entry = await createMappingEntry(
      { projectId: 'proj-1', floor: '0', crossings: [], createdBy: 'user-1' } as any,
      [blob('a')]
    );

    const afterAdd = await addPhotosToMapping(entry.id, [blob('b')], 'user-1');
    expect(afterAdd.photoIds).toHaveLength(2);

    const toRemove = afterAdd.photoIds[0];
    const afterRemove = await removePhotoFromMapping(entry.id, toRemove, 'user-1');
    expect(afterRemove.photoIds).toEqual([afterAdd.photoIds[1]]);
    expect(await db.photos.get(toRemove)).toBeUndefined();
  });

  test('convertRemoteToLocalMapping estrae photoIds dall array remoto photos', () => {
    const local = convertRemoteToLocalMapping({
      id: 'me-1',
      project_id: 'proj-1',
      floor: '0',
      crossings: [],
      timestamp: 1000,
      last_modified: 1000,
      version: 1,
      created_by: 'user-1',
      modified_by: 'user-1',
      photos: [{ id: 'p1' }, { id: 'p2' }],
    });
    expect(local.photoIds).toEqual(['p1', 'p2']);
    expect((local as any).photos).toBeUndefined();
  });

  test('convertRemoteToLocalStructure estrae photoIds e regge photos mancante', () => {
    const withPhotos = convertRemoteToLocalStructure({
      id: 'se-1',
      project_id: 'proj-1',
      floor: '0',
      structures: [],
      timestamp: 1000,
      last_modified: 1000,
      version: 1,
      created_by: 'user-1',
      modified_by: 'user-1',
      photos: [{ id: 'p1' }],
    });
    expect(withPhotos.photoIds).toEqual(['p1']);

    const noPhotos = convertRemoteToLocalStructure({
      id: 'se-2',
      project_id: 'proj-1',
      floor: '0',
      structures: [],
      timestamp: 1000,
      last_modified: 1000,
      version: 1,
      created_by: 'user-1',
      modified_by: 'user-1',
    });
    expect(noPhotos.photoIds).toEqual([]);
  });
});
