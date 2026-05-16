/**
 * Test per src/lib/storageShim.ts
 *
 * Mocka fetch globalmente per testare i metodi di apiStorageFrom senza
 * dipendenze di rete.
 */
import { apiStorageFrom } from '../storageShim';

// ---------------------------------------------------------------------------
// Helper per mockare fetch con una risposta semplice
// ---------------------------------------------------------------------------

function mockFetchOk(body: object, status = 200) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    blob: async () => new Blob(['test-data'], { type: 'image/jpeg' }),
  } as any);
}

function mockFetchFail(status: number) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: false,
    status,
    json: async () => ({}),
    blob: async () => new Blob(),
  } as any);
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  global.fetch = jest.fn();
});

afterEach(() => {
  jest.resetAllMocks();
});

// ---------------------------------------------------------------------------
// getPublicUrl
// ---------------------------------------------------------------------------

describe('apiStorageFrom.getPublicUrl', () => {
  test('path già prefissato con bucket non genera doppio prefisso', () => {
    const storage = apiStorageFrom('photos');
    // path già include il bucket
    const result = storage.getPublicUrl('photos/img.jpg');
    expect(result.data.publicUrl).toBe('/api/storage/proxy/photos/img.jpg');
    // non deve comparire "photos/photos/"
    expect(result.data.publicUrl).not.toContain('photos/photos/');
  });

  test('path senza prefisso bucket → URL contiene bucket/path', () => {
    const storage = apiStorageFrom('photos');
    const result = storage.getPublicUrl('img.jpg');
    expect(result.data.publicUrl).toBe('/api/storage/proxy/photos/img.jpg');
    expect(result.data.publicUrl).toContain('photos/img.jpg');
  });

  test('bucket planimetrie con path già prefissato → nessun doppio prefisso', () => {
    const storage = apiStorageFrom('planimetrie');
    const result = storage.getPublicUrl('planimetrie/plan.png');
    expect(result.data.publicUrl).toBe('/api/storage/proxy/planimetrie/plan.png');
    expect(result.data.publicUrl).not.toContain('planimetrie/planimetrie/');
  });
});

// ---------------------------------------------------------------------------
// createSignedUrl
// ---------------------------------------------------------------------------

describe('apiStorageFrom.createSignedUrl', () => {
  test('successo → fetch chiamato con body corretto, ritorna signedUrl', async () => {
    const storage = apiStorageFrom('photos');
    mockFetchOk({ signedUrl: 'https://cdn.example.com/signed?tok=abc' });

    const result = await storage.createSignedUrl('img.jpg', 3600);

    expect(result.error).toBeNull();
    expect(result.data).not.toBeNull();
    expect(result.data!.signedUrl).toBe('https://cdn.example.com/signed?tok=abc');

    const [url, opts] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('/api/storage/sign-one');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.bucket).toBe('photos');
    expect(body.path).toBe('img.jpg');
    expect(body.ttl).toBe(3600);
  });

  test('risposta non-200 → ritorna { data: null, error: Error }', async () => {
    const storage = apiStorageFrom('photos');
    mockFetchFail(403);

    const result = await storage.createSignedUrl('img.jpg', 3600);

    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error!.message).toContain('403');
    expect((result.error as any).status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// createSignedUrls
// ---------------------------------------------------------------------------

describe('apiStorageFrom.createSignedUrls', () => {
  test('tutti successo → data array con lunghezza uguale all\'input', async () => {
    const storage = apiStorageFrom('photos');
    mockFetchOk({ signedUrl: 'https://cdn.example.com/1' });
    mockFetchOk({ signedUrl: 'https://cdn.example.com/2' });
    mockFetchOk({ signedUrl: 'https://cdn.example.com/3' });

    const result = await storage.createSignedUrls(['a.jpg', 'b.jpg', 'c.jpg'], 3600);

    expect(result.error).toBeNull();
    expect(result.data).not.toBeNull();
    expect(result.data!.length).toBe(3);
    result.data!.forEach(item => {
      expect(item.signedUrl).toBeTruthy();
    });
  });

  test('tutti falliscono → error di livello superiore (allFailed guard)', async () => {
    const storage = apiStorageFrom('photos');
    mockFetchFail(500);
    mockFetchFail(500);

    const result = await storage.createSignedUrls(['x.jpg', 'y.jpg'], 3600);

    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect((result.error as any).status).toBe(500);
  });

  test('fallimento parziale → data ritornato (non error top-level), items falliti hanno error', async () => {
    const storage = apiStorageFrom('photos');
    mockFetchOk({ signedUrl: 'https://cdn.example.com/ok' });
    mockFetchFail(500);

    const result = await storage.createSignedUrls(['ok.jpg', 'fail.jpg'], 3600);

    // allFailed è false quindi si entra nel ramo data
    expect(result.error).toBeNull();
    expect(result.data).not.toBeNull();
    expect(result.data!.length).toBe(2);

    const okItem = result.data!.find(i => i.path === 'ok.jpg');
    expect(okItem).toBeDefined();
    expect(okItem!.signedUrl).toBeTruthy();
    expect(okItem!.error).toBeNull();

    const failItem = result.data!.find(i => i.path === 'fail.jpg');
    expect(failItem).toBeDefined();
    expect(failItem!.error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// download
// ---------------------------------------------------------------------------

describe('apiStorageFrom.download', () => {
  test('successo → ritorna { data: Blob, error: null }', async () => {
    const storage = apiStorageFrom('photos');
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      blob: async () => new Blob(['img-data'], { type: 'image/jpeg' }),
    } as any);

    const result = await storage.download('img.jpg');

    expect(result.error).toBeNull();
    expect(result.data).toBeInstanceOf(Blob);
    expect(result.data!.size).toBeGreaterThan(0);
  });

  test('path già prefissato con bucket → nessun doppio prefisso nel fetch URL', async () => {
    const storage = apiStorageFrom('photos');
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      blob: async () => new Blob(['data']),
    } as any);

    await storage.download('photos/img.jpg');

    const [url] = (global.fetch as jest.Mock).mock.calls[0];
    // Non deve comparire "photos/photos/"
    expect(url).toBe('/api/storage/proxy/photos/img.jpg');
    expect(url).not.toContain('photos/photos/');
  });

  test('risposta non-200 → ritorna { data: null, error: Error }', async () => {
    const storage = apiStorageFrom('photos');
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 404,
      blob: async () => new Blob(),
    } as any);

    const result = await storage.download('img.jpg');

    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error!.message).toContain('404');
  });
});

// ---------------------------------------------------------------------------
// upload
// ---------------------------------------------------------------------------

describe('apiStorageFrom.upload', () => {
  test('successo → fetch chiamato x2 (presign + PUT), ritorna { data: { path }, error: null }', async () => {
    const storage = apiStorageFrom('planimetrie');
    const blob = new Blob(['img-data'], { type: 'image/png' });

    // Prima chiamata: presign — direct: true → client Tailscale, PUT diretto
    mockFetchOk({ url: 'https://storage.example.com/presigned-put-url?tok=abc', method: 'PUT', direct: true });
    // Seconda chiamata: PUT al presigned URL
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
    } as any);

    const result = await storage.upload('project/floor/fullres.png', blob, { contentType: 'image/png' });

    expect(result.error).toBeNull();
    expect(result.data).not.toBeNull();
    expect(result.data!.path).toBe('project/floor/fullres.png');

    // Verifica prima chiamata (presign): body usa "key" e "ttl" (non più "path"/"ttlSec")
    const [presignUrl, presignOpts] = (global.fetch as jest.Mock).mock.calls[0];
    expect(presignUrl).toBe('/api/storage/upload-presigned');
    expect(presignOpts.method).toBe('POST');
    const presignBody = JSON.parse(presignOpts.body);
    expect(presignBody.bucket).toBe('planimetrie');
    expect(presignBody.key).toBe('project/floor/fullres.png');
    expect(presignBody.ttl).toBe(3600);

    // Verifica seconda chiamata (PUT)
    const [putUrl, putOpts] = (global.fetch as jest.Mock).mock.calls[1];
    expect(putUrl).toBe('https://storage.example.com/presigned-put-url?tok=abc');
    expect(putOpts.method).toBe('PUT');
    expect(putOpts.headers['Content-Type']).toBe('image/png');
    expect(putOpts.body).toBe(blob);
  });

  test('presign POST fallisce → { data: null, error instanceof Error } senza chiamata PUT', async () => {
    const storage = apiStorageFrom('planimetrie');
    const blob = new Blob(['data'], { type: 'image/png' });

    mockFetchFail(500);

    const result = await storage.upload('some/path.png', blob);

    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error!.message).toContain('500');
    // Solo una chiamata fetch (presign), nessuna PUT
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(1);
  });

  test('PUT al presigned URL fallisce → { data: null, error instanceof Error }', async () => {
    const storage = apiStorageFrom('planimetrie');
    const blob = new Blob(['data'], { type: 'image/pdf' });

    // Presign successo — direct: true → client Tailscale, PUT diretto
    mockFetchOk({ url: 'https://storage.example.com/put-url', method: 'PUT', direct: true });
    // PUT fallisce
    mockFetchFail(403);

    const result = await storage.upload('some/doc.pdf', blob, { contentType: 'application/pdf' });

    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error!.message).toContain('403');
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(2);
  });

  test('content-type default da Blob.type quando options non fornito', async () => {
    const storage = apiStorageFrom('planimetrie');
    const blob = new Blob(['data'], { type: 'image/jpeg' });

    // direct: true → client Tailscale, PUT diretto
    mockFetchOk({ url: 'https://storage.example.com/put-url', method: 'PUT', direct: true });
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) } as any);

    await storage.upload('img.jpg', blob);

    const [, putOpts] = (global.fetch as jest.Mock).mock.calls[1];
    expect(putOpts.headers['Content-Type']).toBe('image/jpeg');
  });
});

// ---------------------------------------------------------------------------
// remove
// ---------------------------------------------------------------------------

describe('apiStorageFrom.remove', () => {
  test('successo → ritorna { data: [{name}], error: null }', async () => {
    const storage = apiStorageFrom('photos');
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ deleted: [{ name: 'a.jpg' }] }),
    } as any);

    const result = await storage.remove(['a.jpg']);

    expect(result.error).toBeNull();
    expect(result.data).toEqual([{ name: 'a.jpg' }]);
  });

  test('server 500 → { data: null, error instanceof Error }', async () => {
    const storage = apiStorageFrom('photos');
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'internal' }),
    } as any);

    const result = await storage.remove(['a.jpg']);

    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
  });

  test('deleted mancante nel json → { data: null, error: null }', async () => {
    const storage = apiStorageFrom('photos');
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
    } as any);

    const result = await storage.remove(['a.jpg']);

    expect(result.data).toBeNull();
    expect(result.error).toBeNull();
  });
});
