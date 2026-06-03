import { describe, it, expect, vi, beforeEach } from 'vitest';

// B3 — Regressione copertura originator.
// Ogni handler CRUD mutante (POST/PUT/PATCH/DELETE) deve eseguire la sua scrittura
// dentro withOriginatorTransaction, che imposta opimappa.originator_session = sessionId.
// Se un handler dimentica il wrap, il set_config non viene chiamato e questo test fallisce.

const setConfigValues: string[] = [];
const beginSpy = vi.fn();

function makeTx() {
  // tx è callable come tagged-template (per set_config) e ha .unsafe.
  const tx: any = (_strings: TemplateStringsArray, ...vals: unknown[]) => {
    // withOriginatorTransaction chiama: tx`SELECT set_config('opimappa.originator_session', ${sessionId}, true)`
    setConfigValues.push(String(vals[0]));
    return Promise.resolve([]);
  };
  tx.unsafe = (_text: string, _params?: unknown[]) => Promise.resolve([{ id: 'row-1' }]);
  return tx;
}

const sqlMock: any = {
  begin: (fn: (tx: any) => Promise<unknown>) => {
    beginSpy();
    return fn(makeTx());
  },
  // exists-check del PUT e altri SELECT diretti
  unsafe: (_text: string, _params?: unknown[]) => Promise.resolve([]),
};

vi.mock('../src/db/client.js', () => ({ sql: sqlMock, db: {} }));

const { createCrudHandler } = await import('../src/routes/crud.js');

const SESSION_ID = 'sess-abc-123';

function makeCtx(opts: { url: string; body?: unknown; sessionId?: string | undefined }) {
  const store = new Map<string, unknown>([
    ['user', { id: 'admin-1', email: 'a@opifiresafe.com', role: 'admin' }],
    ['sessionId', 'sessionId' in opts ? opts.sessionId : SESSION_ID],
  ]);
  return {
    get: (k: string) => store.get(k),
    var: { user: store.get('user') },
    req: {
      url: opts.url,
      json: async () => opts.body ?? {},
    },
    header: () => {},
    json: (data: unknown, status = 200) => ({ __response: true, data, status }),
  } as any;
}

describe('B3 — copertura originator su tutte le mutazioni CRUD', () => {
  beforeEach(() => {
    setConfigValues.length = 0;
    beginSpy.mockClear();
  });

  it('POST imposta originator_session = sessionId nella transazione', async () => {
    const c = makeCtx({ url: 'http://localhost/api/projects', body: { title: 'Test' } });
    await createCrudHandler('projects').post(c);
    expect(beginSpy).toHaveBeenCalledTimes(1);
    expect(setConfigValues).toContain(SESSION_ID);
  });

  it('PUT imposta originator_session = sessionId nella transazione', async () => {
    const c = makeCtx({ url: 'http://localhost/api/projects', body: { id: 'row-1', title: 'Test' } });
    await createCrudHandler('projects').put(c);
    expect(beginSpy).toHaveBeenCalledTimes(1);
    expect(setConfigValues).toContain(SESSION_ID);
  });

  it('PATCH imposta originator_session = sessionId nella transazione', async () => {
    const c = makeCtx({ url: 'http://localhost/api/projects?id=eq.row-1', body: { title: 'Aggiornato' } });
    await createCrudHandler('projects').patch(c);
    expect(beginSpy).toHaveBeenCalledTimes(1);
    expect(setConfigValues).toContain(SESSION_ID);
  });

  it('DELETE imposta originator_session = sessionId nella transazione', async () => {
    const c = makeCtx({ url: 'http://localhost/api/projects?id=eq.row-1' });
    await createCrudHandler('projects').delete(c);
    expect(beginSpy).toHaveBeenCalledTimes(1);
    expect(setConfigValues).toContain(SESSION_ID);
  });

  it('fallisce in modo rumoroso se sessionId manca (requireUser non applicato)', async () => {
    const c = makeCtx({ url: 'http://localhost/api/projects', body: { title: 'Test' }, sessionId: undefined });
    const res = await createCrudHandler('projects').post(c);
    // L'errore viene catturato da handleError → 500, e NON viene scritto alcun originator.
    expect(res.status).toBe(500);
    expect(setConfigValues).not.toContain(SESSION_ID);
    expect(beginSpy).not.toHaveBeenCalled();
  });
});
