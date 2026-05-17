import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChangeLogRow } from '../src/realtime/listener.js';

const sqlMock = vi.fn();
vi.mock('../src/db/client.js', () => ({ sql: sqlMock, db: {} }));

const { canSee } = await import('../src/realtime/visibility.js');

function row(overrides: Partial<ChangeLogRow>): ChangeLogRow {
  return {
    seq: 1n,
    table_name: 'standalone_maps',
    row_id: 'row-1',
    op: 'UPDATE',
    project_id: null,
    user_id: null,
    originator: null,
    ...overrides,
  };
}

describe('realtime canSee visibility', () => {
  beforeEach(() => {
    sqlMock.mockReset();
  });

  it('admin vede tutte le righe senza interrogare il db', async () => {
    await expect(canSee('admin-1', 'admin', row({ project_id: null, user_id: null }))).resolves.toBe(true);
    await expect(canSee('admin-1', 'admin', row({ table_name: 'photos', project_id: 'project-1', user_id: null }))).resolves.toBe(true);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('standalone_maps con project_id null e user_id valorizzato e visibile solo al proprietario', async () => {
    const change = row({ table_name: 'standalone_maps', project_id: null, user_id: 'user-1' });

    await expect(canSee('user-1', 'user', change)).resolves.toBe(true);
    await expect(canSee('user-2', 'user', change)).resolves.toBe(false);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('project_id null e user_id null e visibile solo agli admin', async () => {
    const change = row({ table_name: 'photos', project_id: null, user_id: null, op: 'DELETE' });

    await expect(canSee('user-1', 'user', change)).resolves.toBe(false);
    await expect(canSee('admin-1', 'admin', change)).resolves.toBe(true);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('tabelle globali (dropdown_options, products) con project_id/user_id null sono visibili a tutti', async () => {
    for (const table of ['dropdown_options', 'products']) {
      const change = row({ table_name: table, project_id: null, user_id: null, op: 'UPDATE' });
      await expect(canSee('user-1', 'user', change)).resolves.toBe(true);
      await expect(canSee('admin-1', 'admin', change)).resolves.toBe(true);
    }
    // Guardia regressione HIGH2: tabelle non globali con null/null restano solo admin.
    const orphan = row({ table_name: 'photos', project_id: null, user_id: null, op: 'DELETE' });
    await expect(canSee('user-1', 'user', orphan)).resolves.toBe(false);
    await expect(canSee('admin-1', 'admin', orphan)).resolves.toBe(true);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('projects DELETE e visibile al proprietario salvato in user_id e agli admin', async () => {
    const change = row({ table_name: 'projects', op: 'DELETE', project_id: 'project-1', user_id: 'owner-1' });

    await expect(canSee('owner-1', 'user', change)).resolves.toBe(true);
    await expect(canSee('user-2', 'user', change)).resolves.toBe(false);
    await expect(canSee('admin-1', 'admin', change)).resolves.toBe(true);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('righe project-scoped non DELETE restano filtrate dalla query accesso progetto', async () => {
    const change = row({ table_name: 'projects', op: 'UPDATE', project_id: 'project-1', user_id: 'owner-1' });

    sqlMock.mockResolvedValueOnce([{ id: 'project-1' }]);
    await expect(canSee('user-1', 'user', change)).resolves.toBe(true);

    sqlMock.mockResolvedValueOnce([]);
    await expect(canSee('user-2', 'user', change)).resolves.toBe(false);

    expect(sqlMock).toHaveBeenCalledTimes(2);
  });
});
