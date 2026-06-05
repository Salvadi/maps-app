/**
 * Test per le ottimizzazioni performance sync (F1, F2, F5).
 * Vedi ADR Brain: 2026-06-05-ottimizzazione-performance-sync.
 *
 * Strategia: mock di '../../lib/homeserver' per osservare quali endpoint vengono
 * colpiti. lockedUpload non deve scaricare (nessun apiFetch), lockedDownload sì.
 * F5: downloadMappingEntriesFromSupabase salta il put delle righe immutate.
 */

jest.mock('../../lib/homeserver', () => {
  const actual = jest.requireActual('../../lib/homeserver');
  return {
    __esModule: true,
    ...actual,
    isHomeserverConfigured: jest.fn(() => true),
    apiFetch: jest.fn(),
    apiFetchJson: jest.fn(),
  };
});

import { apiFetch, apiFetchJson, isHomeserverConfigured } from '../../lib/homeserver';
import { lockedUpload, lockedDownload, triggerImmediateUpload, triggerImmediateDownload } from '../syncEngine';
import { downloadMappingEntriesFromSupabase } from '../syncDownloadHandlers';
import { db } from '../../db/database';

const mockApiFetch = apiFetch as jest.Mock;
const mockApiFetchJson = apiFetchJson as jest.Mock;
const mockIsConfigured = isHomeserverConfigured as jest.Mock;

// Risposta apiFetch parametrica per URL; default { data: [] }.
// NB: CRA abilita resetMocks:true → le impl vanno (re)impostate in beforeEach.
let mappingRows: any[] = [];
function installApiFetch(): void {
  mockIsConfigured.mockReturnValue(true);
  mockApiFetch.mockImplementation(async (path: string) => {
    let data: any[] = [];
    if (path.startsWith('/api/mapping_entries')) data = mappingRows;
    return { ok: true, statusText: 'OK', json: async () => ({ data }) };
  });
  mockApiFetchJson.mockImplementation(async (path: string) => {
    if (path === '/api/me') return { id: 'u1', email: 'u1@opifiresafe.com', role: 'admin' };
    if (path === '/api/changes/head') return { currentSeq: '0' };
    return {};
  });
}

async function resetDb(): Promise<void> {
  await db.projects.clear();
  await db.mappingEntries.clear();
  await db.structureEntries.clear();
  await db.syncQueue.clear();
  await db.metadata.clear();
}

beforeEach(async () => {
  jest.clearAllMocks();
  mappingRows = [];
  installApiFetch();
  await resetDb();
});

describe('F1 — modifica locale fa solo upload', () => {
  test('lockedUpload non innesca alcun download remoto', async () => {
    await lockedUpload();
    // processSyncQueue contatta /api/me ma la coda è vuota: nessun apiFetch (download).
    expect(mockApiFetchJson).toHaveBeenCalledWith('/api/me');
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  test('triggerImmediateUpload (debounce) esegue upload senza download', async () => {
    triggerImmediateUpload();
    triggerImmediateUpload();
    await new Promise((r) => setTimeout(r, 2100)); // > debounce 2000ms
    expect(mockApiFetchJson).toHaveBeenCalledWith('/api/me'); // upload eseguito
    expect(mockApiFetch).not.toHaveBeenCalled(); // nessun download
  });
});

describe('F2 — realtime innesca download immediato', () => {
  test('lockedDownload scarica i progetti dal server', async () => {
    await lockedDownload();
    expect(mockApiFetch).toHaveBeenCalled();
    const urls = mockApiFetch.mock.calls.map((c) => c[0] as string);
    expect(urls.some((u) => u.startsWith('/api/projects'))).toBe(true);
  });

  test('triggerImmediateDownload coalesce più eventi ravvicinati in un solo ciclo', async () => {
    triggerImmediateDownload();
    triggerImmediateDownload();
    triggerImmediateDownload();
    await new Promise((r) => setTimeout(r, 500)); // > debounce 400ms
    // Un solo ciclo di download → /api/me chiamato una volta sola.
    const meCalls = mockApiFetchJson.mock.calls.filter((c) => c[0] === '/api/me').length;
    expect(meCalls).toBe(1);
  });
});

describe('F5 — skip re-put delle righe immutate', () => {
  const remoteRow = (lastModified: number) => ({
    id: 'e1',
    project_id: 'p1',
    floor: 'PT',
    crossings: [],
    to_complete: false,
    timestamp: 1000,
    last_modified: lastModified,
    version: 1,
    created_by: 'u1',
    modified_by: 'u1',
    photos: [],
  });

  beforeEach(async () => {
    await db.projects.put({ id: 'p1', syncEnabled: 1, archived: 0 } as any);
    await db.mappingEntries.put({
      id: 'e1',
      projectId: 'p1',
      floor: 'PT',
      crossings: [],
      lastModified: 1000,
      version: 1,
      synced: 1,
    } as any);
  });

  test('riga con stesso lastModified non viene riscritta (downloadedCount = 0)', async () => {
    mappingRows = [remoteRow(1000)];
    const count = await downloadMappingEntriesFromSupabase('u1', true);
    expect(count).toBe(0);
    const stored = await db.mappingEntries.get('e1');
    expect(stored?.lastModified).toBe(1000);
  });

  test('riga con lastModified diverso viene riscritta (downloadedCount = 1)', async () => {
    mappingRows = [remoteRow(2000)];
    const count = await downloadMappingEntriesFromSupabase('u1', true);
    expect(count).toBe(1);
    const stored = await db.mappingEntries.get('e1');
    expect(stored?.lastModified).toBe(2000);
  });
});
