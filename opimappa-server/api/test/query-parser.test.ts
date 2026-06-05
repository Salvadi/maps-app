import { describe, it, expect } from 'vitest';
import { test as fcTest, fc } from '@fast-check/vitest';
import { parseQuery, parseSelect, parseFilters, httpError } from '../src/query/parser.js';
import { TABLE_SCHEMA } from '../src/query/schema.js';

describe('query-parser', () => {
  fcTest.prop([fc.string(), fc.string()])('arbitrary input never causes 500', (col, val) => {
    try {
      parseQuery('projects', new URLSearchParams(`${col}=${val}`));
    } catch (e: any) {
      expect(e).toBeDefined();
      expect(typeof e.status).toBe('number');
      expect(e.status).toBeLessThan(500);
    }
  });

  it('parseSelect trimma whitespace', () => {
    const result = parseSelect('id, title , notes', TABLE_SCHEMA.projects);
    expect(result.cols).toEqual(['id', 'title', 'notes']);
  });

  it('parseSelect ritorna * per null', () => {
    const result = parseSelect(null, TABLE_SCHEMA.projects);
    expect(result.cols).toBe('*');
    expect(result.joins).toHaveLength(0);
  });

  it('parseSelect join inner con subcolonne', () => {
    const result = parseSelect('id,mapping_entries!inner(id,label)', TABLE_SCHEMA.projects);
    expect(result.joins).toHaveLength(1);
    expect(result.joins[0].type).toBe('inner');
    expect(result.joins[0].cols).toEqual(['id', 'label']);
  });

  it('parseSelect join left', () => {
    const result = parseSelect('id,floor_plans!left(id,name)', TABLE_SCHEMA.projects);
    expect(result.joins[0].type).toBe('left');
  });

  it('parseSelect colonna sconosciuta lancia 400', () => {
    let caughtErr: any;
    try { parseSelect('nonexistent_col', TABLE_SCHEMA.projects); } catch (e: any) { caughtErr = e; }
    expect(caughtErr?.status).toBe(400);
  });

  it('parseFilters direct eq', () => {
    const params = new URLSearchParams('id=eq.abc-123');
    const filters = parseFilters(params, TABLE_SCHEMA.projects);
    expect(filters).toHaveLength(1);
    expect(filters[0].type).toBe('direct');
    expect(filters[0].op).toBe('eq');
    expect(filters[0].value).toBe('abc-123');
  });

  it('parseFilters salta reserved params', () => {
    const params = new URLSearchParams('select=id,title&order=id.asc&limit=10');
    const filters = parseFilters(params, TABLE_SCHEMA.projects);
    expect(filters).toHaveLength(0);
  });

  it('parseFilters op sconosciuto lancia 400', () => {
    let caughtErr: any;
    try { parseFilters(new URLSearchParams('id=invalid.val'), TABLE_SCHEMA.projects); } catch (e: any) { caughtErr = e; }
    expect(caughtErr?.status).toBe(400);
  });

  it('dotted filter su join', () => {
    const params = new URLSearchParams('mapping_entries.project_id=eq.abc-123');
    const filters = parseFilters(params, TABLE_SCHEMA.photos);
    expect(filters[0].type).toBe('join_filter');
    expect(filters[0].rel).toBeDefined();
  });

  it('parseQuery defaults', () => {
    const plan = parseQuery('projects', new URLSearchParams());
    expect(plan.limit).toBe(100);
    expect(plan.offset).toBe(0);
    expect(plan.countMode).toBe(false);
  });

  it('parseQuery limit max 1000', () => {
    const plan = parseQuery('projects', new URLSearchParams('limit=9999'));
    expect(plan.limit).toBe(1000);
  });
});
