import { Hono } from 'hono';
import { DeleteObjectsCommand } from '@aws-sdk/client-s3';
import type { Variables } from '../auth/middleware.js';
import { getMinioClient, VALID_BUCKETS } from '../storage/minioClient.js';
import { getSignedReadUrl } from '../storage/signedUrl.js';

const storageRoute = new Hono<{ Variables: Variables }>();

// POST /api/storage/sign-one
// Genera un URL firmato per un singolo oggetto di storage.
// Body: { bucket: string, path: string, ttl?: number }
storageRoute.post('/sign-one', async (c) => {
  let body: { bucket?: unknown; path?: unknown; ttl?: unknown };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ signedUrl: null, error: 'body JSON non valido' }, 400);
  }

  const { bucket, path, ttl } = body;

  if (typeof bucket !== 'string' || !VALID_BUCKETS.has(bucket)) {
    return c.json(
      { signedUrl: null, error: `bucket non valido: usa 'photos' o 'planimetrie'` },
      400,
    );
  }
  if (typeof path !== 'string' || path.trim() === '') {
    return c.json({ signedUrl: null, error: 'path mancante o non valido' }, 400);
  }

  // Normalizza: rimuove slash iniziali e rifiuta path vuoti
  const cleanPath = path.replace(/^\/+/, '');
  if (!cleanPath) return c.json({ signedUrl: null, error: 'path non valido' }, 400);

  const ttlSec = typeof ttl === 'number' && ttl > 0 ? Math.floor(ttl) : undefined;
  // Cap TTL a 24 ore per evitare URL firmati con scadenza eccessiva
  const MAX_TTL_SEC = 86400;
  const ttl_final = Math.min(ttlSec ?? 3600, MAX_TTL_SEC);

  try {
    const signedUrl = await getSignedReadUrl(bucket, cleanPath, ttl_final);
    return c.json({ signedUrl, error: null });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ signedUrl: null, error: `errore generazione URL: ${msg}` }, 500);
  }
});

// GET /api/storage/proxy/:bucket/*
// Proxy trasparente per oggetti di storage — genera URL firmato e scarica l'oggetto.
// Il client riceve il contenuto binario con il Content-Type corretto.
storageRoute.get('/proxy/:bucket/*', async (c) => {
  const bucket = c.req.param('bucket');
  // c.req.param('*') returns empty in Hono nested sub-routers; fallback to URL parse
  const _wp = c.req.param('*') ?? '';
  const _um = new URL(c.req.url).pathname.match(/\/proxy\/[^/]+\/(.+)$/);
  const objectKey = _wp || (_um ? decodeURIComponent(_um[1]) : '');

  if (!VALID_BUCKETS.has(bucket)) {
    return c.json({ error: 'bucket non valido' }, 404);
  }
  if (!objectKey) {
    return c.json({ error: 'percorso oggetto mancante' }, 404);
  }

  // Protezione path traversal: blocca tentativi di uscire dalla chiave
  if (objectKey.includes('..') || objectKey.startsWith('/')) {
    return c.json({ error: 'invalid path' }, 400);
  }

  try {
    // storagePath già nella forma "key" (senza bucket prefix) poiché bucket viene da :bucket
    const signedUrl = await getSignedReadUrl(bucket, objectKey);

    const response = await fetch(signedUrl);
    if (!response.ok) {
      return c.json({ error: 'oggetto non trovato' }, 404);
    }

    const contentType = response.headers.get('content-type') ?? 'application/octet-stream';

    // Pipe ReadableStream direttamente — evita di bufferare l'intero oggetto in memoria
    return new Response(response.body, {
      status: 200,
      headers: { 'Content-Type': contentType },
    });
  } catch (e) {
    // Se l'errore indica oggetto non trovato (S3 NoSuchKey), ritorna 404
    // Altrimenti 502 (upstream non raggiungibile o errore MinIO)
    const isNotFound =
      e instanceof Error &&
      (e.name === 'NoSuchKey' || (e as any).$metadata?.httpStatusCode === 404);
    if (isNotFound) {
      return c.json({ error: 'not found' }, 404);
    }
    console.error('Storage proxy error:', e);
    return c.json({ error: 'upstream error' }, 502);
  }
});

// DELETE /api/storage/remove
// Elimina uno o più oggetti da MinIO/S3.
// Body: { bucket: string, paths: string[] }
storageRoute.delete('/remove', async (c) => {
  let body: { bucket?: unknown; paths?: unknown };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ error: 'body JSON non valido' }, 400);
  }

  const { bucket, paths } = body;

  if (typeof bucket !== 'string' || !VALID_BUCKETS.has(bucket)) {
    return c.json({ error: 'bucket non valido' }, 400);
  }
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > 100) {
    return c.json({ error: 'paths non valido' }, 400);
  }

  const cleanPaths: string[] = [];
  for (const path of paths) {
    if (typeof path !== 'string' || path.includes('..') || path.includes('\0')) {
      return c.json({ error: 'invalid path' }, 400);
    }

    const cleanPath = path.replace(/^\/+/, '');
    if (!cleanPath) {
      return c.json({ error: 'invalid path' }, 400);
    }
    cleanPaths.push(cleanPath);
  }

  try {
    const s3 = getMinioClient();
    const result = await s3.send(new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: {
        Objects: cleanPaths.map((Key) => ({ Key })),
      },
    }));

    const s3Errors = result.Errors ?? [];
    if (s3Errors.length > 0) {
      const msg = s3Errors.map(e => `${e.Key}: ${e.Message}`).join('; ');
      return c.json({ error: `eliminazione parziale fallita: ${msg}` }, 500);
    }

    return c.json({ deleted: cleanPaths.map((name) => ({ name })) }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return c.json({ error: message }, 500);
  }
});

export default storageRoute;
