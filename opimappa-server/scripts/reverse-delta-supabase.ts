// C8: Reverse-delta migration — copia dati locali → Supabase durante cutover
// Usage: npx ts-node scripts/reverse-delta-supabase.ts <CUTOVER_ISO_TIMESTAMP>
// Esempio: npx ts-node scripts/reverse-delta-supabase.ts 2026-06-01T10:00:00Z
// IMPORTANTE: eseguire solo mentre Supabase è in freeze (supabase-freeze.sql applicato)

import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';

const LOCAL_DATABASE_URL = process.env.DATABASE_URL!;
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!LOCAL_DATABASE_URL || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Required env vars: DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const CUTOVER_TS = process.argv[2];
if (!CUTOVER_TS) {
  console.error('Usage: reverse-delta-supabase.ts <CUTOVER_ISO_TIMESTAMP>');
  process.exit(1);
}

const local = postgres(LOCAL_DATABASE_URL);
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// C8: ordine tabelle per rispettare FK (parent prima di figli)
const TABLE_ORDER: Record<string, number> = {
  dropdown_options: 0,
  products: 0,
  projects: 1,
  mapping_entries: 2,
  structure_entries: 2,
  floor_plans: 2,
  standalone_maps: 2,
  sals: 3,
  typology_prices: 3,
  photos: 4,
  floor_plan_points: 4,
};

async function reverseStorageCopy(cutoverTs: string): Promise<number> {
  const storageTables = ['photos', 'floor_plans', 'standalone_maps'] as const;
  const pathColumns: Record<string, string[]> = {
    photos: ['storage_path'],
    floor_plans: ['image_storage_path', 'thumbnail_storage_path', 'pdf_storage_path'],
    standalone_maps: ['image_storage_path', 'thumbnail_storage_path', 'pdf_storage_path'],
  };
  const buckets: Record<string, string> = {
    photos: 'photos',
    floor_plans: 'planimetrie',
    standalone_maps: 'planimetrie',
  };

  const endpoint = process.env.MINIO_ENDPOINT;
  const accessKeyId = process.env.MINIO_API_ACCESS_KEY;
  const secretAccessKey = process.env.MINIO_API_SECRET_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error('MINIO_ENDPOINT / MINIO_API_ACCESS_KEY / MINIO_API_SECRET_KEY mancanti');
  }

  const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({
    endpoint,
    region: 'us-east-1',
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });

  let storageErrors = 0;

  for (const table of storageTables) {
    const rows = await local<Array<{ row_id: string }>>`
      SELECT DISTINCT row_id FROM change_log
      WHERE table_name = ${table} AND op IN ('INSERT', 'UPDATE') AND changed_at > ${cutoverTs}
    `;
    console.log(`  Storage ${table}: ${rows.length} righe da copiare MinIO→Supabase`);

    for (const { row_id } of rows) {
      try {
        const [record] = await local`SELECT * FROM ${local(table)} WHERE id = ${row_id}`;
        if (!record) { console.warn(`  ${table} ${row_id}: riga non trovata, skip`); continue; }

        const cols = pathColumns[table];
        for (const col of cols) {
          const storagePath: string | undefined = record[col];
          if (!storagePath) continue;

          const bucket = buckets[table];
          const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: storagePath }));
          const chunks: Buffer[] = [];
          for await (const chunk of obj.Body as AsyncIterable<Buffer>) chunks.push(Buffer.from(chunk));
          const buffer = Buffer.concat(chunks);

          const { error } = await sb.storage.from(bucket).upload(storagePath, buffer, { upsert: true });
          if (error) throw error;
          console.log(`    ${table} ${row_id} [${col}]: copiato ${storagePath}`);
        }
      } catch (e) {
        console.error(`    ${table} ${row_id}: errore - ${(e as Error).message}`);
        storageErrors++;
      }
    }
  }

  return storageErrors;
}

async function main() {
  console.log(`Reverse-delta da cutover: ${CUTOVER_TS}`);

  // C8: prendi TUTTI gli eventi ordinati per seq (non DISTINCT per row)
  const allEvents = await local<Array<{
    seq: bigint; table_name: string; row_id: string; op: string; project_id: string | null; user_id: string | null;
  }>>`
    SELECT seq, table_name, row_id, op, project_id, user_id
    FROM change_log
    WHERE changed_at > ${CUTOVER_TS}
    ORDER BY seq ASC
  `;

  console.log(`Trovati ${allEvents.length} eventi nel change_log dopo ${CUTOVER_TS}`);

  // Compattazione: per ogni (table, row_id) prendi solo l'ultimo evento
  const lastByKey = new Map<string, typeof allEvents[number]>();
  const orderedKeys: string[] = [];
  for (const ev of allEvents) {
    const key = `${ev.table_name}:${ev.row_id}`;
    if (!lastByKey.has(key)) orderedKeys.push(key);
    lastByKey.set(key, ev);
  }

  // Ordina per TABLE_ORDER (parent prima), poi per seq
  orderedKeys.sort((a, b) => {
    const evA = lastByKey.get(a)!;
    const evB = lastByKey.get(b)!;
    const tA = TABLE_ORDER[evA.table_name] ?? 99;
    const tB = TABLE_ORDER[evB.table_name] ?? 99;
    if (tA !== tB) return tA - tB;
    return Number(evA.seq - evB.seq);
  });

  console.log(`Applicando ${orderedKeys.length} righe univoche in ordine FK-safe...`);
  let applied = 0;
  let errors = 0;

  for (const key of orderedKeys) {
    const ev = lastByKey.get(key)!;
    try {
      if (ev.op === 'DELETE') {
        const { error } = await sb.from(ev.table_name).delete().eq('id', ev.row_id);
        if (error) throw error;
      } else {
        const rows = await local`SELECT * FROM ${local(ev.table_name)} WHERE id = ${ev.row_id}`;
        if (rows.length > 0) {
          const { error } = await sb.from(ev.table_name).upsert(rows[0]);
          if (error) throw error;
        } else {
          // Riga non più presente localmente: probabilmente delete arrivato dopo. Tratta come delete.
          const { error } = await sb.from(ev.table_name).delete().eq('id', ev.row_id);
          if (error) throw error;
        }
      }
      applied++;
      if (applied % 100 === 0) console.log(`  ${applied}/${orderedKeys.length} righe applicate...`);
    } catch (e) {
      console.error(`  ERRORE su ${key} (op=${ev.op}):`, e);
      errors++;
    }
  }

  console.log(`\nRisultato: ${applied} righe applicate, ${errors} errori`);

  // Storage reverse sync
  console.log('\nAvvio storage reverse sync...');
  errors += await reverseStorageCopy(CUTOVER_TS);

  await local.end();
  if (errors > 0) {
    console.error(`\n⚠️  ${errors} errori durante il reverse-delta. Verificare prima di completare cutover.`);
    process.exit(1);
  }
  console.log('\n✅ Reverse-delta completato.');
}

main().catch((e) => {
  console.error('Errore fatale:', e);
  process.exit(1);
});
