import { Hono } from 'hono';
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getMinioClient, VALID_BUCKETS } from './minioClient.js';
import type { Variables } from '../auth/middleware.js';
import { userCanAccessStoragePath } from '../routes/storage.js';

// H5 — Costanti multipart S3
// 5 MiB minimum per S3 multipart (min per part eccetto ultima); max part 5 GiB; max 10000 parts; soglia attivazione consigliata >50 MB
const PART_SIZE = 5 * 1024 * 1024;

// Endpoint interno MinIO (lato server/Tailscale)
const MINIO_INTERNAL_ENDPOINT = process.env.MINIO_ENDPOINT ?? '';
// Endpoint Tailscale di MinIO (per riscrittura URL presigned verso client VPN)
const MINIO_TAILSCALE_ENDPOINT = process.env.MINIO_TAILSCALE_ENDPOINT ?? MINIO_INTERNAL_ENDPOINT;

// TTL massimo consentito per signed URL (24h)
const MAX_TTL_SEC = 86400;

// CIDR Tailscale: 100.64.0.0/10
const TAILSCALE_CIDR = '100.64.0.0/10';

/**
 * Controlla se un indirizzo IPv4 (stringa) appartiene al CIDR indicato.
 * Implementazione inline con bigint per evitare dipendenze esterne.
 */
function isInCidr(ip: string, cidr: string): boolean {
  try {
    const [cidrBase, prefixStr] = cidr.split('/');
    const prefix = parseInt(prefixStr, 10);
    if (isNaN(prefix) || prefix < 0 || prefix > 32) return false;

    const ipToNum = (s: string): number => {
      const parts = s.split('.').map(Number);
      if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) return -1;
      return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
    };

    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    const network = (ipToNum(cidrBase) & mask) >>> 0;
    const addr = ipToNum(ip);
    if (addr < 0) return false;
    return ((addr & mask) >>> 0) === network;
  } catch {
    return false;
  }
}

const presignRoute = new Hono<{ Variables: Variables }>();

/**
 * H6 — POST /upload-presigned
 *
 * Routing presigned URL:
 *  - Client Tailscale (VPN, CIDR 100.64.0.0/10): restituisce presigned PUT diretto verso MinIO
 *  - Client esterni (via Cloudflare/internet): restituisce URL proxy API con chunk size limitato
 *
 * Il client usa il campo `direct` per scegliere il metodo di upload.
 */
presignRoute.post('/upload-presigned', async (c) => {
  let bucket: string;
  let key: string;
  let ttl: number;

  try {
    const body = await c.req.json();
    bucket = body.bucket;
    key = body.key;
    ttl = typeof body.ttl === 'number' ? body.ttl : 600;
  } catch {
    return c.json({ error: 'body JSON non valido' }, 400);
  }

  // Validazione bucket
  if (!bucket || !VALID_BUCKETS.has(bucket)) {
    return c.json({ error: `bucket non valido: ${bucket}` }, 400);
  }

  // Validazione chiave — C1: path traversal guard
  if (!key || typeof key !== 'string' || key.trim() === '') {
    return c.json({ error: 'key mancante o non valida' }, 400);
  }
  if (key.includes('..') || key.includes('\0')) {
    return c.json({ error: 'key non valida' }, 400);
  }
  key = key.trim().replace(/^\/+/, '');

  // C2 — Cappa TTL a MAX_TTL_SEC
  ttl = Math.min(ttl, MAX_TTL_SEC);

  // Scope applicativo: senza RLS ogni presign deve validare la key target.
  const user = c.var.user;
  if (!(await userCanAccessStoragePath(bucket, key, user.id, user.role))) {
    return c.json({ error: 'forbidden' }, 403);
  }

  // H1 — Leggi IP reale dal socket TCP (non da CF-Connecting-IP, forgiabile su Tailscale)
  // NESSUN fallback a header: se socketIp non disponibile → tratta come esterno (sicuro)
  const rawSocketIp = (c.env as any)?.incoming?.socket?.remoteAddress ?? '';
  const socketIp = rawSocketIp.replace(/^::ffff:/, '');

  const fromTailscale = socketIp !== '' && isInCidr(socketIp, TAILSCALE_CIDR);

  if (fromTailscale) {
    // Tailscale: genera presigned PUT diretto verso MinIO e riscrivi endpoint
    // affinché il client usi l'indirizzo Tailscale raggiungibile
    const s3 = getMinioClient();
    const signedUrl = await getSignedUrl(
      s3,
      // M3 — usa key.trim() per evitare spazi nascosti nella chiave S3
      new PutObjectCommand({ Bucket: bucket, Key: key.trim() }),
      { expiresIn: ttl },
    );

    // H3 — Sostituisce endpoint interno MinIO con quello Tailscale
    const tailscaleUrl = MINIO_INTERNAL_ENDPOINT && MINIO_TAILSCALE_ENDPOINT
      ? signedUrl.replace(MINIO_INTERNAL_ENDPOINT, MINIO_TAILSCALE_ENDPOINT)
      : signedUrl;

    return c.json({
      url: tailscaleUrl,
      method: 'PUT',
      direct: true,
    });
  }

  // Esterni: restituisce URL proxy API con chunk size sotto il limite CF (100 MB body)
  return c.json({
    url: '/api/storage/proxy-upload',
    method: 'POST',
    direct: false,
    chunkSize: PART_SIZE,   // 5 MiB per chunk
    maxParts: 100,           // limite pratico per upload proxy
  });
});

/**
 * POST /proxy-upload — upload proxy per client esterni (non Tailscale)
 *
 * Riceve il blob binario nel body HTTP + parametri bucket e key come query string.
 * Esegue un PutObjectCommand diretto verso MinIO lato server (nessun presigned URL esposto).
 * Risposta: { data: { path: string }, error: null } oppure { error: string }.
 *
 * Esempio: POST /api/storage/proxy-upload?bucket=photos&key=mappingId/photoId.jpg
 * Header: Content-Type: image/jpeg
 * Body: blob binario del file
 */
presignRoute.post('/proxy-upload', async (c) => {
  // Leggi bucket e key dai query params
  const bucket = c.req.query('bucket') ?? '';
  const key = c.req.query('key') ?? '';

  // Validazione bucket
  if (!bucket || !VALID_BUCKETS.has(bucket)) {
    return c.json({ error: `bucket non valido: ${bucket}` }, 400);
  }

  // Validazione chiave — C1: path traversal guard (stesso schema di /upload-presigned)
  if (!key || typeof key !== 'string' || key.trim() === '') {
    return c.json({ error: 'key mancante o non valida' }, 400);
  }
  const cleanKey = key.trim().replace(/^\/+/, '');
  if (!cleanKey || cleanKey.includes('..') || cleanKey.includes('\0')) {
    return c.json({ error: 'key non valida' }, 400);
  }

  // Scope applicativo: valida anche upload proxy esterni sulla key normalizzata.
  const user = c.var.user;
  if (!(await userCanAccessStoragePath(bucket, cleanKey, user.id, user.role))) {
    return c.json({ error: 'forbidden' }, 403);
  }

  // Limite dimensione body: 50 MiB (foto max ~1 MiB, planimetrie ~10 MiB)
  const MAX_BODY_BYTES = 50 * 1024 * 1024;
  const contentLength = parseInt(c.req.header('content-length') ?? '0', 10);
  if (contentLength > MAX_BODY_BYTES) {
    return c.json({ error: `body troppo grande: max ${MAX_BODY_BYTES} byte` }, 413);
  }

  // Leggi il body come ArrayBuffer e determina content type
  let buffer: Buffer;
  try {
    const arrayBuf = await c.req.arrayBuffer();
    buffer = Buffer.from(arrayBuf);
    if (buffer.length > MAX_BODY_BYTES) {
      return c.json({ error: `body troppo grande: max ${MAX_BODY_BYTES} byte` }, 413);
    }
  } catch {
    return c.json({ error: 'impossibile leggere il body della richiesta' }, 400);
  }

  if (buffer.length === 0) {
    return c.json({ error: 'body vuoto' }, 400);
  }

  const contentType = c.req.header('content-type') ?? 'application/octet-stream';

  // PutObject diretto verso MinIO (nessun presigned URL, upload server-side)
  try {
    const s3 = getMinioClient();
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: cleanKey,
      Body: buffer,
      ContentType: contentType,
      ContentLength: buffer.length,
    }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: `upload MinIO fallito: ${msg}` }, 500);
  }

  return c.json({ data: { path: cleanKey }, error: null });
});

/**
 * POST /sign-read — genera URL firmato per lettura oggetto
 * Usato dallo shim apiClient.storage.from(bucket).createSignedUrl(path, ttl)
 */
presignRoute.post('/sign-read', async (c) => {
  let bucket: string;
  let path: string;
  let ttl: number;

  try {
    const body = await c.req.json();
    bucket = body.bucket;
    path = body.path;
    ttl = typeof body.ttl === 'number' ? body.ttl : 3600;
  } catch {
    return c.json({ error: 'body JSON non valido' }, 400);
  }

  if (!bucket || !VALID_BUCKETS.has(bucket)) {
    return c.json({ error: `bucket non valido: ${bucket}` }, 400);
  }
  if (!path || typeof path !== 'string') {
    return c.json({ error: 'path mancante' }, 400);
  }

  // M-NEW-1 — Path traversal guard (stesso schema di /upload-presigned)
  const cleanPath = path.trim().replace(/^\/+/, '');
  if (!cleanPath || cleanPath.includes('..') || cleanPath.includes('\0')) {
    return c.json({ error: 'path non valido' }, 400);
  }

  // Scope applicativo: la lettura firmata non deve esporre asset fuori tenant.
  const user = c.var.user;
  if (!(await userCanAccessStoragePath(bucket, cleanPath, user.id, user.role))) {
    return c.json({ error: 'forbidden' }, 403);
  }

  // H2 — Cappa TTL a MAX_TTL_SEC
  ttl = Math.min(ttl, MAX_TTL_SEC);

  const s3 = getMinioClient();
  const signedUrl = await getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: bucket, Key: cleanPath }),
    { expiresIn: ttl },
  );

  return c.json({ signedUrl });
});

export default presignRoute;
