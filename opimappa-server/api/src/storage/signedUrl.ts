import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getMinioClient, VALID_BUCKETS } from './minioClient.js';

const DEFAULT_TTL_SEC = 3600;

/**
 * Estrae il bucket e la chiave S3 da un percorso di storage.
 *
 * storagePath può essere:
 *  - "photos/abc/def.jpg"          → bucket=photos, key=abc/def.jpg
 *  - "planimetrie/abc/def.jpg"     → bucket=planimetrie, key=abc/def.jpg
 *  - "abc/def.jpg"                 → usa defaultBucket
 *  - "def.jpg"                     → usa defaultBucket, key=def.jpg
 */
function parseBucketAndKey(
  storagePath: string,
  defaultBucket: string,
): { bucket: string; key: string } {
  const slashIdx = storagePath.indexOf('/');
  if (slashIdx !== -1) {
    const prefix = storagePath.slice(0, slashIdx);
    if (VALID_BUCKETS.has(prefix)) {
      // Il prefisso è un nome bucket noto — separalo dalla chiave
      return { bucket: prefix, key: storagePath.slice(slashIdx + 1) };
    }
  }
  // Nessun prefisso bucket riconoscibile — usa defaultBucket
  return { bucket: defaultBucket, key: storagePath };
}

/**
 * Genera un URL firmato per la lettura di un oggetto da MinIO.
 *
 * @param bucket      - Bucket di fallback se storagePath non include il nome bucket
 * @param storagePath - Percorso canonico (con o senza prefisso bucket)
 * @param ttlSec      - Durata validità URL in secondi (default: 3600)
 */
export async function getSignedReadUrl(
  bucket: string,
  storagePath: string,
  ttlSec: number = DEFAULT_TTL_SEC,
): Promise<string> {
  const { bucket: resolvedBucket, key } = parseBucketAndKey(storagePath, bucket);

  const client = getMinioClient();
  const command = new GetObjectCommand({ Bucket: resolvedBucket, Key: key });
  return getSignedUrl(client, command, { expiresIn: ttlSec });
}
