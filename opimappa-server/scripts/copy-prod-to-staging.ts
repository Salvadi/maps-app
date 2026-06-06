/**
 * copy-prod-to-staging.ts
 *
 * Copia one-off dal DB/Storage PROD homeserver → STAGING, per popolare dati di test.
 * Entrambi i Postgres girano sullo stesso container (db diversi: opimappa / opimappa_staging);
 * entrambi i MinIO sono S3-compatibili (minio / minio-staging).
 *
 * Cosa copia:
 *   1. Reference tables COMPLETE: dropdown_options, products (TRUNCATE staging + reinsert).
 *   2. Un progetto per titolo (default "CANTIERE PROVA") con TUTTO il sottoalbero
 *      (mapping_entries, structure_entries, typology_prices, floor_plans,
 *       floor_plan_points, photos, sals) — delete+insert idempotente per project id.
 *   3. Blob storage dei record copiati: photos (bucket photos) + floor_plans (bucket planimetrie),
 *      MinIO prod → minio-staging (HeadObject skip se già presente).
 *
 * NON tocca PROD (sola lettura su src + storage src). Scrive solo su STAGING.
 *
 * ENV richiesti:
 *   SRC_DB_URL  postgres://opimappa:<pw>@postgres:5432/opimappa
 *   DST_DB_URL  postgres://opimappa:<pw>@postgres:5432/opimappa_staging
 *   SRC_MINIO_ENDPOINT / SRC_MINIO_ACCESS_KEY / SRC_MINIO_SECRET_KEY
 *   DST_MINIO_ENDPOINT / DST_MINIO_ACCESS_KEY / DST_MINIO_SECRET_KEY
 *   PROJECT_TITLE  (opzionale, default "CANTIERE PROVA")
 *
 * Uso (container one-off su rete opimappa_net):
 *   npx tsx scripts/copy-prod-to-staging.ts
 */

import postgres from 'postgres';

const SRC_DB_URL = reqEnv('SRC_DB_URL');
const DST_DB_URL = reqEnv('DST_DB_URL');
const PROJECT_TITLE = process.env.PROJECT_TITLE ?? 'CANTIERE PROVA';

const STORAGE = {
  srcEndpoint: process.env.SRC_MINIO_ENDPOINT,
  srcAccess: process.env.SRC_MINIO_ACCESS_KEY,
  srcSecret: process.env.SRC_MINIO_SECRET_KEY,
  dstEndpoint: process.env.DST_MINIO_ENDPOINT,
  dstAccess: process.env.DST_MINIO_ACCESS_KEY,
  dstSecret: process.env.DST_MINIO_SECRET_KEY,
};

function reqEnv(name: string): string {
  const v = process.env[name];
  if (!v) { console.error(`ERRORE: env ${name} mancante`); process.exit(1); }
  return v;
}

const src = postgres(SRC_DB_URL);
const dst = postgres(DST_DB_URL);

// Colonne jsonb di una tabella (per wrapping sql.json al bind).
async function jsonbCols(sql: postgres.Sql, table: string): Promise<Set<string>> {
  const rows = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table} AND data_type = 'jsonb'
  `;
  return new Set(rows.map(r => r.column_name as string));
}

// Colonne effettive (lettura) di una tabella.
async function colsOf(sql: postgres.Sql, table: string): Promise<string[]> {
  const rows = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table}
  `;
  return rows.map(r => r.column_name as string);
}

// Prepara una riga per l'insert su dst: tiene solo le colonne comuni, wrappa i jsonb.
function prepRow(row: Record<string, unknown>, cols: string[], dstJsonb: Set<string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of cols) {
    const v = row[c];
    out[c] = (v !== null && v !== undefined && dstJsonb.has(c)) ? dst.json(v as any) : (v ?? null);
  }
  return out;
}

// Inserisce righe su dst (batch). Le righe sono già filtrate alle colonne comuni.
async function insertRows(table: string, rows: Record<string, unknown>[], cols: string[], dstJsonb: Set<string>): Promise<number> {
  if (rows.length === 0) return 0;
  const prepared = rows.map(r => prepRow(r, cols, dstJsonb));
  const BATCH = 200;
  for (let i = 0; i < prepared.length; i += BATCH) {
    const chunk = prepared.slice(i, i + BATCH);
    await dst`INSERT INTO ${dst(table)} ${dst(chunk, ...cols)}`;
  }
  return prepared.length;
}

// Colonne comuni src∩dst (evita di inserire colonne assenti su un lato, es. dropdown_options.unit).
async function commonCols(table: string): Promise<{ cols: string[]; dstJsonb: Set<string> }> {
  const [s, d, j] = await Promise.all([colsOf(src, table), colsOf(dst, table), jsonbCols(dst, table)]);
  const dset = new Set(d);
  return { cols: s.filter(c => dset.has(c)), dstJsonb: j };
}

// ─── Reference tables: TRUNCATE + reinsert ───────────────────────────────────
async function copyReferenceTable(table: string): Promise<void> {
  process.stdout.write(`  ${table}... `);
  const { cols, dstJsonb } = await commonCols(table);
  const rows = await src.unsafe<Record<string, unknown>[]>(`SELECT * FROM ${table}`);
  await dst.unsafe(`TRUNCATE TABLE ${table}`);
  const n = await insertRows(table, rows, cols, dstJsonb);
  console.log(`${n} righe (TRUNCATE+reinsert)`);
}

// ─── Project subtree: delete (reverse FK) poi insert (forward FK) ─────────────
type ChildSpec = { table: string; where: string };

async function copyProject(projectId: string): Promise<{ photos: Record<string, unknown>[]; floorPlans: Record<string, unknown>[] }> {
  // Filtri per ogni tabella, ancorati al project id.
  const mappingsWhere = `project_id = '${projectId}'`;
  const structuresWhere = `project_id = '${projectId}'`;
  const floorPlansWhere = `project_id = '${projectId}'`;
  const fpPointsWhere = `floor_plan_id IN (SELECT id FROM floor_plans WHERE project_id = '${projectId}')`;
  const photosWhere = `mapping_entry_id IN (SELECT id FROM mapping_entries WHERE project_id = '${projectId}')`
    + ` OR structure_entry_id IN (SELECT id FROM structure_entries WHERE project_id = '${projectId}')`;
  const projScoped = `project_id = '${projectId}'`;

  // Ordine di delete su dst (figli → padre).
  const deleteOrder: ChildSpec[] = [
    { table: 'floor_plan_points', where: fpPointsWhere },
    { table: 'photos', where: photosWhere },
    { table: 'sals', where: projScoped },
    { table: 'typology_prices', where: projScoped },
    { table: 'floor_plans', where: floorPlansWhere },
    { table: 'mapping_entries', where: mappingsWhere },
    { table: 'structure_entries', where: structuresWhere },
  ];
  console.log('  Pulizia eventuali dati esistenti su staging...');
  for (const { table, where } of deleteOrder) {
    if (!(await tableExists(dst, table))) continue;
    await dst.unsafe(`DELETE FROM ${table} WHERE ${where}`);
  }
  await dst.unsafe(`DELETE FROM projects WHERE id = '${projectId}'`);

  // Ordine di insert (padre → figli).
  const insertOrder: ChildSpec[] = [
    { table: 'projects', where: `id = '${projectId}'` },
    { table: 'mapping_entries', where: mappingsWhere },
    { table: 'structure_entries', where: structuresWhere },
    { table: 'typology_prices', where: projScoped },
    { table: 'floor_plans', where: floorPlansWhere },
    { table: 'floor_plan_points', where: fpPointsWhere },
    { table: 'photos', where: photosWhere },
    { table: 'sals', where: projScoped },
  ];

  let photos: Record<string, unknown>[] = [];
  let floorPlans: Record<string, unknown>[] = [];
  for (const { table, where } of insertOrder) {
    if (!(await tableExists(src, table)) || !(await tableExists(dst, table))) {
      console.log(`  ${table}... [skip] assente`);
      continue;
    }
    process.stdout.write(`  ${table}... `);
    const { cols, dstJsonb } = await commonCols(table);
    const rows = await src.unsafe<Record<string, unknown>[]>(`SELECT * FROM ${table} WHERE ${where}`);
    const n = await insertRows(table, rows, cols, dstJsonb);
    console.log(`${n} righe`);
    if (table === 'photos') photos = rows;
    if (table === 'floor_plans') floorPlans = rows;
  }
  return { photos, floorPlans };
}

async function tableExists(sql: postgres.Sql, table: string): Promise<boolean> {
  const rows = await sql`SELECT to_regclass(${'public.' + table}) AS t`;
  return rows[0]?.t != null;
}

// ─── Storage copy MinIO → minio-staging ──────────────────────────────────────
async function copyStorage(photos: Record<string, unknown>[], floorPlans: Record<string, unknown>[]): Promise<void> {
  const { srcEndpoint, srcAccess, srcSecret, dstEndpoint, dstAccess, dstSecret } = STORAGE;
  if (!srcEndpoint || !srcAccess || !srcSecret || !dstEndpoint || !dstAccess || !dstSecret) {
    console.warn('\n[storage] env MinIO mancanti → SALTO copia blob (solo DB copiato).');
    return;
  }
  const { S3Client, HeadObjectCommand, GetObjectCommand, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const mk = (endpoint: string, ak: string, sk: string) => new S3Client({
    endpoint, region: 'us-east-1', credentials: { accessKeyId: ak, secretAccessKey: sk }, forcePathStyle: true,
  });
  const s3src = mk(srcEndpoint, srcAccess, srcSecret);
  const s3dst = mk(dstEndpoint, dstAccess, dstSecret);

  const jobs: { bucket: string; key: string }[] = [];
  const add = (bucket: string, path: unknown) => {
    if (typeof path !== 'string' || !path) return;
    const prefix = bucket + '/';
    const key = path.startsWith(prefix) ? path.slice(prefix.length) : path;
    jobs.push({ bucket, key });
  };
  for (const p of photos) { add('photos', p.storage_path); add('photos', p.thumbnail_storage_path); }
  for (const f of floorPlans) {
    add('planimetrie', f.image_storage_path);
    add('planimetrie', f.thumbnail_storage_path);
    add('planimetrie', f.pdf_storage_path);
  }

  let copied = 0, skipped = 0, missing = 0, errors = 0;
  console.log(`\n[storage] ${jobs.length} oggetti da copiare`);
  for (const { bucket, key } of jobs) {
    try {
      try {
        await s3dst.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        skipped++; continue;
      } catch (e: any) {
        const code = e?.$metadata?.httpStatusCode ?? e?.statusCode;
        if (code !== 404 && code !== 403) throw e;
      }
      let obj;
      try {
        obj = await s3src.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      } catch {
        missing++; console.warn(`  [missing src] ${bucket}/${key}`); continue;
      }
      const body = Buffer.from(await obj.Body!.transformToByteArray());
      await s3dst.send(new PutObjectCommand({
        Bucket: bucket, Key: key, Body: body,
        ContentType: obj.ContentType || 'application/octet-stream',
      }));
      copied++;
      if (copied % 50 === 0) console.log(`  progresso: ${copied} copiate, ${skipped} skip`);
    } catch (e) {
      errors++; console.error(`  [errore] ${bucket}/${key}: ${(e as Error).message}`);
    }
  }
  console.log(`[storage] FINE: copied=${copied} skipped=${skipped} missingSrc=${missing} errors=${errors}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== Copia PROD → STAGING (dati di test) ===\n');

  // 0. Assicura colonna unit su staging (idempotente) per la feature unità.
  await dst.unsafe(`ALTER TABLE public.dropdown_options ADD COLUMN IF NOT EXISTS unit TEXT`);

  // 1. Reference tables
  console.log('Reference tables (TRUNCATE + reinsert):');
  await copyReferenceTable('dropdown_options');
  await copyReferenceTable('products');

  // 2. Progetto
  console.log(`\nProgetto "${PROJECT_TITLE}":`);
  const found = await src.unsafe<Record<string, unknown>[]>(
    `SELECT id, title FROM projects WHERE title = $1 ORDER BY created_at LIMIT 5`, [PROJECT_TITLE]
  );
  if (found.length === 0) {
    console.error(`  Nessun progetto con titolo "${PROJECT_TITLE}" trovato su PROD.`);
    await src.end(); await dst.end();
    process.exit(1);
  }
  if (found.length > 1) console.warn(`  Attenzione: ${found.length} progetti con questo titolo, uso il più vecchio.`);
  const projectId = found[0].id as string;
  console.log(`  id = ${projectId}`);
  const { photos, floorPlans } = await copyProject(projectId);

  // 3. Storage
  await copyStorage(photos, floorPlans);

  await src.end();
  await dst.end();
  console.log('\n=== Copia completata ===');
}

main().catch(err => { console.error('\nERRORE FATALE:', err); process.exit(1); });
