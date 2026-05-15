import { Hono } from 'hono';
import { DeleteObjectsCommand } from '@aws-sdk/client-s3';
import type { Variables } from '../auth/middleware.js';
import { getMinioClient, VALID_BUCKETS } from '../storage/minioClient.js';
import { getSignedReadUrl } from '../storage/signedUrl.js';
import { sql } from '../db/client.js';

const storageRoute = new Hono<{ Variables: Variables }>();

/**
 * Verifica che user abbia accesso allo storage path indicato.
 * Lookup nel DB per identificare entity → project → controllo owner_id/accessible_users.
 * Admin bypass. Ritorna true se autorizzato, false altrimenti.
 */
async function userCanAccessStoragePath(
  bucket: string,
  path: string,
  userId: string,
  role: string | undefined | null,
): Promise<boolean> {
  if (role === 'admin') return true;

  if (bucket === 'photos') {
    const rows = await sql.unsafe(
      `SELECT 1 FROM photos p
       LEFT JOIN mapping_entries m ON m.id = p.mapping_entry_id
       LEFT JOIN structure_entries s ON s.id = p.structure_entry_id
       LEFT JOIN projects proj ON proj.id = COALESCE(m.project_id, s.project_id)
       WHERE (p.storage_path = $1 OR p.thumbnail_storage_path = $1)
         AND (proj.owner_id = $2 OR (proj.accessible_users)::jsonb ? $3)
       LIMIT 1`,
      [path, userId, userId] as any[],
    );
    return rows.length > 0;
  }

  if (bucket === 'planimetrie') {
    // Floor plans: scope via project; standalone_maps: scope via user_id.
    const rows = await sql.unsafe(
      `SELECT 1 FROM floor_plans fp
       JOIN projects proj ON proj.id = fp.project_id
       WHERE (fp.image_storage_path = $1 OR fp.thumbnail_storage_path = $1 OR fp.pdf_storage_path = $1)
         AND (proj.owner_id = $2 OR (proj.accessible_users)::jsonb ? $3)
       LIMIT 1`,
      [path, userId, userId] as any[],
    );
    if (rows.length > 0) return true;

    const smRows = await sql.unsafe(
      `SELECT 1 FROM standalone_maps
       WHERE (image_storage_path = $1 OR thumbnail_storage_path = $1 OR pdf_storage_path = $1)
         AND user_id = $2
       LIMIT 1`,
      [path, userId] as any[],
    );
    return smRows.length > 0;
  }

  return false;
}

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

  // Scope check: verifica che user abbia accesso al path richiesto
  const user = c.var.user;
  if (!(await userCanAccessStoragePath(bucket, cleanPath, user.id, user.role))) {
    return c.json({ signedUrl: null, error: 'forbidden' }, 403);
  }

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

  // Scope check: verifica che user abbia accesso al path richiesto
  const user = c.var.user;
  if (!(await userCanAccessStoragePath(bucket, objectKey, user.id, user.role))) {
    return c.json({ error: 'forbidden' }, 403);
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

  // Scope check su ogni path: blocca eliminazioni di asset di altri utenti
  const user = c.var.user;
  for (const p of cleanPaths) {
    if (!(await userCanAccessStoragePath(bucket, p, user.id, user.role))) {
      return c.json({ error: 'forbidden' }, 403);
    }
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
