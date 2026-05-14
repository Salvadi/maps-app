// Forward-copy storage: Supabase Storage → MinIO
// Idempotente: skip se file già presente in MinIO (HeadObject).
// Usage:
//   npx ts-node scripts/forward-storage-copy.ts                # tutte le tabelle
//   npx ts-node scripts/forward-storage-copy.ts photos         # solo photos
//   npx ts-node scripts/forward-storage-copy.ts photos floor_plans
//
// Env vars richieste:
//   DATABASE_URL                 postgres locale homeserver
//   SUPABASE_URL                 https://xxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY    service role key (bucket privato photos)
//   MINIO_ENDPOINT               http://localhost:9000 o nome container
//   MINIO_API_ACCESS_KEY
//   MINIO_API_SECRET_KEY
//
// Eseguire più volte è sicuro: solo file mancanti vengono copiati.
// Ideale prima del cutover DNS per ri-allineare delta accumulate.

import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';

const DATABASE_URL = process.env.DATABASE_URL!;
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT!;
const MINIO_ACCESS_KEY = process.env.MINIO_API_ACCESS_KEY!;
const MINIO_SECRET_KEY = process.env.MINIO_API_SECRET_KEY!;
const CONCURRENCY = Number(process.env.FORWARD_COPY_CONCURRENCY ?? '5');

if (!DATABASE_URL || !SUPABASE_URL || !SERVICE_ROLE_KEY || !MINIO_ENDPOINT || !MINIO_ACCESS_KEY || !MINIO_SECRET_KEY) {
  console.error('Env mancanti: DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MINIO_ENDPOINT, MINIO_API_ACCESS_KEY, MINIO_API_SECRET_KEY');
  process.exit(1);
}

type TableSpec = { table: string; bucket: string; pathColumns: string[] };

const ALL_SPECS: TableSpec[] = [
  { table: 'photos', bucket: 'photos', pathColumns: ['storage_path', 'thumbnail_storage_path'] },
  { table: 'floor_plans', bucket: 'planimetrie', pathColumns: ['image_storage_path', 'thumbnail_storage_path', 'pdf_storage_path'] },
  { table: 'standalone_maps', bucket: 'planimetrie', pathColumns: ['image_storage_path', 'thumbnail_storage_path', 'pdf_storage_path'] },
];

const argsFilter = process.argv.slice(2);
const specs = argsFilter.length > 0
  ? ALL_SPECS.filter((s) => argsFilter.includes(s.table))
  : ALL_SPECS;

if (specs.length === 0) {
  console.error(`Nessuna tabella valida. Disponibili: ${ALL_SPECS.map((s) => s.table).join(', ')}`);
  process.exit(1);
}

const local = postgres(DATABASE_URL);
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

type Stats = { table: string; total: number; copied: number; skipped: number; missingSrc: number; errors: number };

async function copyOne(
  s3: any,
  HeadObjectCommand: any,
  PutObjectCommand: any,
  spec: TableSpec,
  col: string,
  storagePath: string,
  stats: Stats
): Promise<void> {
  try {
    try {
      await s3.send(new HeadObjectCommand({ Bucket: spec.bucket, Key: storagePath }));
      stats.skipped++;
      return;
    } catch (e: any) {
      const code = e?.$metadata?.httpStatusCode ?? e?.statusCode;
      if (code !== 404 && code !== 403) throw e;
    }

    const { data, error } = await sb.storage.from(spec.bucket).download(storagePath);
    if (error || !data) {
      stats.missingSrc++;
      console.warn(`  [${spec.table}/${col}] sorgente mancante: ${storagePath}`);
      return;
    }
    const buffer = Buffer.from(await data.arrayBuffer());

    await s3.send(new PutObjectCommand({
      Bucket: spec.bucket,
      Key: storagePath,
      Body: buffer,
      ContentType: data.type || 'application/octet-stream',
    }));
    stats.copied++;
    if (stats.copied % 50 === 0) {
      console.log(`  [${spec.table}] progresso: ${stats.copied} copiate, ${stats.skipped} skip, ${stats.missingSrc} src-mancanti, ${stats.errors} err`);
    }
  } catch (e) {
    stats.errors++;
    console.error(`  [${spec.table}/${col}] errore ${storagePath}: ${(e as Error).message}`);
  }
}

async function runSpec(s3: any, HeadObjectCommand: any, PutObjectCommand: any, spec: TableSpec): Promise<Stats> {
  const stats: Stats = { table: spec.table, total: 0, copied: 0, skipped: 0, missingSrc: 0, errors: 0 };

  const colSelect = spec.pathColumns.map((c) => `"${c}"`).join(', ');
  const whereAny = spec.pathColumns.map((c) => `"${c}" IS NOT NULL`).join(' OR ');
  const rows = await local.unsafe<Array<Record<string, string | null>>>(
    `SELECT id, ${colSelect} FROM ${spec.table} WHERE ${whereAny}`
  );

  const jobs: Array<{ col: string; path: string }> = [];
  for (const row of rows) {
    for (const col of spec.pathColumns) {
      const p = row[col];
      if (p) jobs.push({ col, path: p });
    }
  }
  stats.total = jobs.length;
  console.log(`[${spec.table}] ${jobs.length} oggetti da verificare (${rows.length} righe)`);

  let cursor = 0;
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (cursor < jobs.length) {
      const idx = cursor++;
      const job = jobs[idx];
      await copyOne(s3, HeadObjectCommand, PutObjectCommand, spec, job.col, job.path, stats);
    }
  });
  await Promise.all(workers);

  console.log(`[${spec.table}] FINE: total=${stats.total} copied=${stats.copied} skipped=${stats.skipped} missingSrc=${stats.missingSrc} errors=${stats.errors}`);
  return stats;
}

async function main() {
  console.log(`Forward-copy Supabase → MinIO`);
  console.log(`  Tabelle: ${specs.map((s) => s.table).join(', ')}`);
  console.log(`  Concurrency: ${CONCURRENCY}`);

  const { S3Client, HeadObjectCommand, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({
    endpoint: MINIO_ENDPOINT,
    region: 'us-east-1',
    credentials: { accessKeyId: MINIO_ACCESS_KEY, secretAccessKey: MINIO_SECRET_KEY },
    forcePathStyle: true,
  });

  const allStats: Stats[] = [];
  for (const spec of specs) {
    const stats = await runSpec(s3, HeadObjectCommand, PutObjectCommand, spec);
    allStats.push(stats);
  }

  console.log('\n=== RIEPILOGO ===');
  let totalErrors = 0;
  let totalMissingSrc = 0;
  for (const s of allStats) {
    console.log(`  ${s.table}: total=${s.total} copied=${s.copied} skipped=${s.skipped} missingSrc=${s.missingSrc} errors=${s.errors}`);
    totalErrors += s.errors;
    totalMissingSrc += s.missingSrc;
  }

  await local.end();
  if (totalErrors > 0) {
    console.error(`\nUscita 1: ${totalErrors} errori`);
    process.exit(1);
  }
  if (totalMissingSrc > 0) {
    console.warn(`\nAttenzione: ${totalMissingSrc} oggetti mancanti su Supabase (DB punta a file inesistenti)`);
  }
  console.log('\nForward-copy completato OK');
}

main().catch((e) => {
  console.error('Forward-copy fallito:', e);
  process.exit(1);
});
