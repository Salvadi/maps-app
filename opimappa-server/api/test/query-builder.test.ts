import { describe, it, expect, vi } from 'vitest';
import type { FilterClause } from '../src/query/parser.js';

vi.mock('../src/db/client.js', () => ({ sql: vi.fn(), db: {} }));

const { addFilter } = await import('../src/query/builder.js');

function inFilter(value: string): FilterClause {
  return { type: 'direct', col: 'id', colType: 'text', op: 'in', value };
}

function runAddFilter(value: string) {
  const build = { clauses: [] as string[], values: [] as unknown[] };
  addFilter(inFilter(value), build);
  return build;
}

describe('query builder in operator', () => {
  it.each(['', '()', '(,)'])('rifiuta lista vuota %s con 400', (value) => {
    let caughtErr: any;
    try { runAddFilter(value); } catch (e: any) { caughtErr = e; }
    expect(caughtErr?.status).toBe(400);
  });

  it('accetta lista parenthesized valida', () => {
    const build = runAddFilter('(a,b)');
    expect(build.values).toEqual(['a', 'b']);
    expect(build.clauses[0]).toContain('= ANY');
  });

  it('accetta lista non parenthesized valida', () => {
    const build = runAddFilter('a,b');
    expect(build.values).toEqual(['a', 'b']);
    expect(build.clauses[0]).toContain('= ANY');
  });
});
