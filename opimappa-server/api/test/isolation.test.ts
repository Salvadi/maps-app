import { describe, it, expect, vi } from 'vitest';
import { parseFilters } from '../src/query/parser.js';
import { TABLE_SCHEMA } from '../src/query/schema.js';

vi.mock('../src/db/client.js', () => ({ sql: vi.fn(), db: {} }));

// Importa addScope dopo il mock del db
const { addScope } = await import('../src/routes/crud.js');

describe('isolation - addScope reale', () => {
  it('admin bypassa tutti i filtri scope', () => {
    const clauses: string[] = [];
    const values: unknown[] = [];
    addScope('projects', 'admin-user', 'admin', clauses, values);
    expect(clauses).toHaveLength(0);
    expect(values).toHaveLength(0);
  });

  it('projects: utente normale riceve filtro owner_id + accessible_users', () => {
    const clauses: string[] = [];
    const values: unknown[] = [];
    addScope('projects', 'user-123', 'user', clauses, values);
    expect(clauses).toHaveLength(1);
    expect(clauses[0]).toContain('owner_id');
    expect(clauses[0]).toContain('accessible_users');
    expect(values).toContain('user-123');
  });

  it('photos: utente normale riceve filtro che limita per project via mapping_entry_id e structure_entry_id', () => {
    const clauses: string[] = [];
    const values: unknown[] = [];
    addScope('photos', 'user-abc', 'user', clauses, values);
    expect(clauses).toHaveLength(1);
    expect(clauses[0]).toContain('mapping_entry_id');
    expect(clauses[0]).toContain('structure_entry_id');
    expect(clauses[0]).toContain('projects');
    expect(clauses[0]).toContain('owner_id');
    // userId deve comparire nei valori (4 volte: 2 per mapping_entry, 2 per structure_entry)
    expect(values.filter(v => v === 'user-abc')).toHaveLength(4);
  });

  it('photos: admin non riceve filtri aggiuntivi', () => {
    const clauses: string[] = [];
    const values: unknown[] = [];
    addScope('photos', 'admin-id', 'admin', clauses, values);
    expect(clauses).toHaveLength(0);
  });

  it('standalone_maps: filtro per user_id', () => {
    const clauses: string[] = [];
    const values: unknown[] = [];
    addScope('standalone_maps', 'user-xyz', 'user', clauses, values);
    expect(clauses).toHaveLength(1);
    expect(clauses[0]).toContain('user_id');
    expect(values).toContain('user-xyz');
    expect(clauses[0]).not.toContain('owner_id');
  });

  it('dropdown_options: nessun filtro scope (tabella globale)', () => {
    const clauses: string[] = [];
    const values: unknown[] = [];
    addScope('dropdown_options', 'user-123', 'user', clauses, values);
    expect(clauses).toHaveLength(0);
    expect(values).toHaveLength(0);
  });

  it('mapping_entries: scope via project_id subquery', () => {
    const clauses: string[] = [];
    const values: unknown[] = [];
    addScope('mapping_entries', 'user-123', 'user', clauses, values);
    expect(clauses).toHaveLength(1);
    expect(clauses[0]).toContain('project_id');
    expect(clauses[0]).toContain('projects');
    expect(values).toContain('user-123');
  });

  it('tabelle project-scoped: sals, typology_prices, floor_plan_points', () => {
    for (const table of ['sals', 'typology_prices', 'floor_plan_points']) {
      const clauses: string[] = [];
      const values: unknown[] = [];
      addScope(table, 'user-123', 'user', clauses, values);
      expect(clauses).toHaveLength(1);
      expect(clauses[0]).toContain('project_id');
      expect(clauses[0]).toContain('projects');
    }
  });

  it('utente A non può vedere dati utente B', () => {
    const clausesA: string[] = [];
    const valuesA: unknown[] = [];
    addScope('projects', 'user-aaa', 'user', clausesA, valuesA);
    expect(valuesA).toContain('user-aaa');
    expect(valuesA).not.toContain('user-bbb');
  });
});

describe('isolation - parseFilters reale', () => {
  it('parseFilters costruisce filtro diretto correttamente', () => {
    const params = new URLSearchParams('id=eq.test-id-123');
    const filters = parseFilters(params, TABLE_SCHEMA.projects);
    expect(filters).toHaveLength(1);
    expect(filters[0].type).toBe('direct');
    expect(filters[0].col).toBe('id');
    expect(filters[0].value).toBe('test-id-123');
  });
});
