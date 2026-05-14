import { S3Client } from '@aws-sdk/client-s3';

// Costanti bucket — corrispondono ai bucket MinIO/S3 reali
export const BUCKET_PHOTOS = 'photos';
export const BUCKET_PLANIMETRIE = 'planimetrie';

// Bucket validi per validazione nelle route
export const VALID_BUCKETS = new Set([BUCKET_PHOTOS, BUCKET_PLANIMETRIE]);

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variabile d'ambiente mancante: ${name}`);
  return value;
}

function buildS3Client(): S3Client {
  const endpoint = getRequiredEnv('MINIO_ENDPOINT');
  const accessKeyId = getRequiredEnv('MINIO_API_ACCESS_KEY');
  const secretAccessKey = getRequiredEnv('MINIO_API_SECRET_KEY');

  return new S3Client({
    endpoint,
    region: 'us-east-1', // MinIO ignora la region ma l'SDK la richiede
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true, // MinIO richiede path-style (non virtual-hosted)
  });
}

// Singleton lazy — non blocca l'avvio se MinIO non è configurato
let _client: S3Client | null = null;

export function getMinioClient(): S3Client {
  if (!_client) {
    _client = buildS3Client();
  }
  return _client;
}
