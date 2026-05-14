/**
 * migrate-storage-urls.ts
 *
 * Script one-shot: popola le colonne *_storage_path canoniche
 * a partire dagli URL legacy (*_url) per floor_plans e standalone_maps.
 *
 * Eseguire UNA VOLTA prima del cutover a MinIO.
 *
 * Uso:
 *   DATABASE_URL=postgres://... npx tsx scripts/migrate-storage-urls.ts
 */

import postgres from 'postgres';

// ────────────────────────────────────────────────────────────────────────────
// Pattern di estrazione percorso canonico (Fix C7, da plan-v4.1)
// ────────────────────────────────────────────────────────────────────────────
const PATTERNS: RegExp[] = [
  /\/storage\/v1\/object\/(?:public|sign)\/([^?]+)/,
  /^([a-z_-]+\/.+)$/i, // già nella forma bucket/percorso canonico
];

function extractPath(rawUrl: string | null, defaultBucket: string): string | null {
  if (!rawUrl) return null;

  // PATTERN[0]: URL Supabase storage con /storage/v1/object/...
  const m0 = rawUrl.match(PATTERNS[0]);
  if (m0) {
    const path = m0[1];
    if (!path.match(/^(photos|planimetrie)\//)) return `${defaultBucket}/${path}`;
    return path;
  }

  // Se è ancora un URL HTTP(S) ma non ha battuto PATTERN[0], è non riconoscibile — evita corruzione dati
  if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
    console.warn(`extractPath: URL HTTP(S) non riconosciuta, saltata: ${rawUrl}`);
    return null;
  }

  // PATTERN[1]: già nella forma bucket/percorso canonico
  const m1 = rawUrl.match(PATTERNS[1]);
  if (m1) {
    const path = m1[1];
    if (!path.match(/^(photos|planimetrie)\//)) return `${defaultBucket}/${path}`;
    return path;
  }

  // Fallback: anteponi bucket di default
  return `${defaultBucket}/${rawUrl}`;
}

// ────────────────────────────────────────────────────────────────────────────
// Helper di aggiornamento
// ────────────────────────────────────────────────────────────────────────────
async function migrateTable(
  sql: postgres.Sql,
  tableName: string,
  mappings: Array<{ storageCol: string; urlCol: string; defaultBucket: string }>,
): Promise<void> {
  console.log(`\n=== Migrazione tabella: ${tableName} ===`);

  for (const { storageCol, urlCol, defaultBucket } of mappings) {
    // Seleziona solo le righe dove storage_path è NULL ma url è presente
    const rows = await sql<Array<{ id: string; url: string }>>`
      SELECT id, ${sql(urlCol)} AS url
      FROM ${sql(tableName)}
      WHERE ${sql(storageCol)} IS NULL
        AND ${sql(urlCol)} IS NOT NULL
    `;

    if (rows.length === 0) {
      console.log(`  ${storageCol}: nessuna riga da aggiornare`);
      continue;
    }

    console.log(`  ${storageCol}: ${rows.length} righe da processare...`);

    // Raccoglie aggiornamenti validi prima di aprire la transazione
    const updates: Array<{ id: string; path: string }> = [];
    let extractErrors = 0;

    for (const row of rows) {
      const path = extractPath(row.url, defaultBucket);
      if (!path) {
        console.warn(`    WARN riga ${row.id}: impossibile estrarre path da "${row.url}"`);
        extractErrors++;
        continue;
      }
      updates.push({ id: row.id, path });
    }

    // Transazione atomica per tabella: se interrotta, il prossimo run riprova tutto
    let updated = 0;
    try {
      await sql.begin(async (tx) => {
        for (const { id, path } of updates) {
          await tx`
            UPDATE ${tx(tableName)}
            SET ${tx(storageCol)} = ${path}
            WHERE id = ${id}
          `;
          updated++;
        }
      });
    } catch (err) {
      console.error(`  ERRORE transazione ${storageCol}: ${err instanceof Error ? err.message : String(err)}`);
      throw err; // Rilancia per interrompere la migrazione su errori di DB
    }

    console.log(`  ${storageCol}: aggiornate ${updated}, errori estrazione ${extractErrors}`);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('Errore: DATABASE_URL non impostata');
    process.exit(1);
  }

  const sql = postgres(databaseUrl);

  try {
    // floor_plans
    await migrateTable(sql, 'floor_plans', [
      { storageCol: 'image_storage_path',     urlCol: 'image_url',     defaultBucket: 'planimetrie' },
      { storageCol: 'thumbnail_storage_path', urlCol: 'thumbnail_url', defaultBucket: 'planimetrie' },
      { storageCol: 'pdf_storage_path',       urlCol: 'pdf_url',       defaultBucket: 'planimetrie' },
    ]);

    // standalone_maps
    await migrateTable(sql, 'standalone_maps', [
      { storageCol: 'image_storage_path',     urlCol: 'image_url',     defaultBucket: 'planimetrie' },
      { storageCol: 'thumbnail_storage_path', urlCol: 'thumbnail_url', defaultBucket: 'planimetrie' },
      { storageCol: 'pdf_storage_path',       urlCol: 'pdf_url',       defaultBucket: 'planimetrie' },
    ]);

    // photos: i percorsi canonici dovrebbero già essere popolati dallo Sprint 1
    // Logga solo le eventuali righe ancora senza storage_path
    const photosWithoutPath = await sql<Array<{ count: string }>>`
      SELECT COUNT(*) AS count FROM photos
      WHERE storage_path IS NULL AND remote_url IS NOT NULL
    `;
    const missing = Number(photosWithoutPath[0]?.count ?? 0);
    if (missing > 0) {
      console.warn(`\nWARN photos: ${missing} righe con remote_url ma senza storage_path — verifica Sprint 1`);
    } else {
      console.log('\nphotos: storage_path OK (nessuna riga da migrare)');
    }

    console.log('\nMigrazione completata.');
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error('Errore fatale:', err);
  process.exit(1);
});
