import {
  getSalsForProject,
  createSal,
  updateSal,
  deleteSal,
  assignCrossingsToSal,
  assignStructuresToSal,
} from '../sal';

describe('db/sal module exports', () => {
  test('exports SAL API functions (regression: module must compile)', () => {
    expect(typeof getSalsForProject).toBe('function');
    expect(typeof createSal).toBe('function');
    expect(typeof updateSal).toBe('function');
    expect(typeof deleteSal).toBe('function');
    expect(typeof assignCrossingsToSal).toBe('function');
    expect(typeof assignStructuresToSal).toBe('function');
  });
});

