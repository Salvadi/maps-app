/**
 * Migrazione URL di Storage da Supabase → chiavi MinIO canoniche
 *
 * Eseguire con:
 *   TARGET_DB_URL=postgres://... npx tsx scripts/migrate-storage-urls.ts [--apply]
 *
 * Default: dry-run (sola lettura). Passa --apply per eseguire le modifiche.
 *
 * Nota: usa il pacchetto `postgres` installato in opimappa-server/api/node_modules.
 * Se npx tsx non trova il modulo, eseguire da opimappa-server/api/:
 *   TARGET_DB_URL=postgres://... npx tsx ../../scripts/migrate-storage-urls.ts [--apply]
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

// Polyfill ESM __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Risolve `postgres` dal node_modules dell'API server, che è l'unico posto dove è installato.
const apiDir = path.resolve(__dirname, '../opimappa-server/api');
const requireFromApi = createRequire(apiDir + '/');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const postgres = requireFromApi('postgres') as typeof import('postgres');

// ─── Tipi ────────────────────────────────────────────────────────────────────

type Sql = ReturnType<typeof postgres>;

interface PhotoRow {
  id: string;
  url: string | null;
  thumbnail_url: string | null;
  storage_path: string | null;
  thumbnail_storage_path: string | null;
}

interface FloorPlanRow {
  id: string;
  image_url: string | null;
  thumbnail_url: string | null;
  pdf_url: string | null;
}

interface StandaloneMapRow {
  id: string;
  image_url: string | null;
  thumbnail_url: string | null;
}

interface MigrationResult {
  table: string;
  column: string;
  count: number;
}

// ─── Argomenti CLI ───────────────────────────────────────────────────────────

function parseArgs(): { apply: boolean } {
  const apply = process.argv.includes('--apply');
  return { apply };
}

// ─── Estrazione chiave da URL Supabase ───────────────────────────────────────

/**
 * Estrae la chiave MinIO (percorso file) da un URL Supabase Storage.
 *
 * Pattern supportati:
 *   1. Public:  https://<project>.supabase.co/storage/v1/object/public/<bucket>/<key>
 *   2. Signed:  https://<project>.supabase.co/storage/v1/object/sign/<bucket>/<key>?token=...
 *
 * Restituisce null se l'URL non contiene `supabase.co` (già una chiave MinIO o NULL).
 */
export function extractKey(url: string | null): string | null {
  if (!url) return null;
  if (!url.includes('supabase.co')) return null;

  // Rimuovi query string (es. ?token=... nei signed URL)
  const withoutQuery = url.split('?')[0];

  // Cerca il pattern /object/public/<bucket>/<key>, /object/sign/<bucket>/<key>
  // oppure /object/authenticated/<bucket>/<key>
  const match = withoutQuery.match(
    /\/storage\/v1\/object\/(?:public|sign|authenticated)\/[^/]+\/(.+)$/
  );

  if (!match) return null;
  return match[1];
}

// ─── Migrazione tabella photos ───────────────────────────────────────────────

async function migratePhotos(sql: Sql, apply: boolean): Promise<MigrationResult[]> {
  const results: MigrationResult[] = [];

  // Leggi tutte le righe con URL Supabase (tabella piccola ~1500 righe)
  const rows = await sql<PhotoRow[]>`
    SELECT id, url, thumbnail_url, storage_path, thumbnail_storage_path
    FROM photos
    WHERE url LIKE '%supabase.co%'
       OR thumbnail_url LIKE '%supabase.co%'
  `;

  // Prepara gli aggiornamenti
  const urlUpdates: Array<{ id: string; storage_path: string | null; canNullUrl: boolean }> = [];
  const thumbUpdates: Array<{ id: string; thumbnail_storage_path: string | null; canNullUrl: boolean }> = [];

  for (const row of rows) {
    if (row.url && row.url.includes('supabase.co')) {
      const key = extractKey(row.url);
      if (!key && row.storage_path === null) {
        console.warn(`[warn] photos riga ${row.id}: URL non riconosciuta e storage_path nullo — riga saltata: ${row.url}`);
      } else {
        urlUpdates.push({
          id: row.id,
          storage_path: row.storage_path ?? key,
          canNullUrl: key !== null || row.storage_path !== null,
        });
      }
    }
    if (row.thumbnail_url && row.thumbnail_url.includes('supabase.co')) {
      const key = extractKey(row.thumbnail_url);
      if (!key && row.thumbnail_storage_path === null) {
        console.warn(`[warn] photos riga ${row.id}: thumbnail_url non riconosciuta e thumbnail_storage_path nullo — riga saltata: ${row.thumbnail_url}`);
      } else {
        thumbUpdates.push({
          id: row.id,
          thumbnail_storage_path: row.thumbnail_storage_path ?? key,
          canNullUrl: key !== null || row.thumbnail_storage_path !== null,
        });
      }
    }
  }

  const prefix = apply ? '[apply]' : '[dry-run]';

  if (urlUpdates.length > 0) {
    console.log(
      `${prefix} photos.url: ${urlUpdates.length} righe da aggiornare` +
        (apply ? ' (storage_path estratto, url → NULL)' : '')
    );
    if (apply) {
      await sql.begin(async (tx) => {
        for (const u of urlUpdates) {
          if (u.canNullUrl) {
            await tx`
              UPDATE photos
              SET url = NULL,
                  storage_path = COALESCE(storage_path, ${u.storage_path})
              WHERE id = ${u.id}
            `;
          } else {
            await tx`
              UPDATE photos
              SET storage_path = COALESCE(storage_path, ${u.storage_path})
              WHERE id = ${u.id}
            `;
          }
        }
      });
      console.log(`[apply] photos.url: aggiornate ${urlUpdates.length} righe`);
    }
  } else {
    console.log(`${prefix} photos.url: nessuna riga da aggiornare`);
  }
  results.push({ table: 'photos', column: 'url', count: urlUpdates.length });

  if (thumbUpdates.length > 0) {
    console.log(
      `${prefix} photos.thumbnail_url: ${thumbUpdates.length} righe da aggiornare` +
        (apply ? ' (thumbnail_storage_path estratto, thumbnail_url → NULL)' : '')
    );
    if (apply) {
      await sql.begin(async (tx) => {
        for (const u of thumbUpdates) {
          if (u.canNullUrl) {
            await tx`
              UPDATE photos
              SET thumbnail_url = NULL,
                  thumbnail_storage_path = COALESCE(thumbnail_storage_path, ${u.thumbnail_storage_path})
              WHERE id = ${u.id}
            `;
          } else {
            await tx`
              UPDATE photos
              SET thumbnail_storage_path = COALESCE(thumbnail_storage_path, ${u.thumbnail_storage_path})
              WHERE id = ${u.id}
            `;
          }
        }
      });
      console.log(
        `[apply] photos.thumbnail_url: aggiornate ${thumbUpdates.length} righe`
      );
    }
  } else {
    console.log(`${prefix} photos.thumbnail_url: nessuna riga da aggiornare`);
  }
  results.push({
    table: 'photos',
    column: 'thumbnail_url',
    count: thumbUpdates.length,
  });

  return results;
}

// ─── Migrazione tabella floor_plans ─────────────────────────────────────────

async function migrateFloorPlans(sql: Sql, apply: boolean): Promise<MigrationResult[]> {
  const results: MigrationResult[] = [];
  const prefix = apply ? '[apply]' : '[dry-run]';

  const rows = await sql<FloorPlanRow[]>`
    SELECT id, image_url, thumbnail_url, pdf_url
    FROM floor_plans
    WHERE image_url   LIKE '%supabase.co%'
       OR thumbnail_url LIKE '%supabase.co%'
       OR pdf_url      LIKE '%supabase.co%'
  `;

  const imageUpdates: Array<{ id: string; image_url: string }> = [];
  const thumbUpdates: Array<{ id: string; thumbnail_url: string }> = [];
  const pdfUpdates: Array<{ id: string; pdf_url: string }> = [];

  for (const row of rows) {
    if (row.image_url && row.image_url.includes('supabase.co')) {
      const key = extractKey(row.image_url);
      if (key) imageUpdates.push({ id: row.id, image_url: key });
    }
    if (row.thumbnail_url && row.thumbnail_url.includes('supabase.co')) {
      const key = extractKey(row.thumbnail_url);
      if (key) thumbUpdates.push({ id: row.id, thumbnail_url: key });
    }
    if (row.pdf_url && row.pdf_url.includes('supabase.co')) {
      const key = extractKey(row.pdf_url);
      if (key) pdfUpdates.push({ id: row.id, pdf_url: key });
    }
  }

  // image_url (NOT NULL — sostituisce con chiave, non NULL)
  if (imageUpdates.length > 0) {
    console.log(
      `${prefix} floor_plans.image_url: ${imageUpdates.length} righe da aggiornare`
    );
    if (apply) {
      await sql.begin(async (tx) => {
        for (const u of imageUpdates) {
          await tx`UPDATE floor_plans SET image_url = ${u.image_url} WHERE id = ${u.id}`;
        }
      });
      console.log(
        `[apply] floor_plans.image_url: aggiornate ${imageUpdates.length} righe`
      );
    }
  } else {
    console.log(`${prefix} floor_plans.image_url: nessuna riga da aggiornare`);
  }
  results.push({ table: 'floor_plans', column: 'image_url', count: imageUpdates.length });

  if (thumbUpdates.length > 0) {
    console.log(
      `${prefix} floor_plans.thumbnail_url: ${thumbUpdates.length} righe da aggiornare`
    );
    if (apply) {
      await sql.begin(async (tx) => {
        for (const u of thumbUpdates) {
          await tx`UPDATE floor_plans SET thumbnail_url = ${u.thumbnail_url} WHERE id = ${u.id}`;
        }
      });
      console.log(
        `[apply] floor_plans.thumbnail_url: aggiornate ${thumbUpdates.length} righe`
      );
    }
  } else {
    console.log(
      `${prefix} floor_plans.thumbnail_url: nessuna riga da aggiornare`
    );
  }
  results.push({
    table: 'floor_plans',
    column: 'thumbnail_url',
    count: thumbUpdates.length,
  });

  if (pdfUpdates.length > 0) {
    console.log(
      `${prefix} floor_plans.pdf_url: ${pdfUpdates.length} righe da aggiornare`
    );
    if (apply) {
      await sql.begin(async (tx) => {
        for (const u of pdfUpdates) {
          await tx`UPDATE floor_plans SET pdf_url = ${u.pdf_url} WHERE id = ${u.id}`;
        }
      });
      console.log(`[apply] floor_plans.pdf_url: aggiornate ${pdfUpdates.length} righe`);
    }
  } else {
    console.log(`${prefix} floor_plans.pdf_url: nessuna riga da aggiornare`);
  }
  results.push({ table: 'floor_plans', column: 'pdf_url', count: pdfUpdates.length });

  return results;
}

// ─── Migrazione tabella standalone_maps ──────────────────────────────────────

async function migrateStandaloneMaps(
  sql: Sql,
  apply: boolean
): Promise<MigrationResult[]> {
  const results: MigrationResult[] = [];
  const prefix = apply ? '[apply]' : '[dry-run]';

  // Verifica se la tabella esiste
  const tableCheck = await sql<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'standalone_maps'
    ) AS exists
  `;
  const tableExists = tableCheck[0]?.exists ?? false;

  if (!tableExists) {
    console.log(`${prefix} standalone_maps: tabella non trovata, skip`);
    return results;
  }

  const rows = await sql<StandaloneMapRow[]>`
    SELECT id, image_url, thumbnail_url
    FROM standalone_maps
    WHERE image_url   LIKE '%supabase.co%'
       OR thumbnail_url LIKE '%supabase.co%'
  `;

  const imageUpdates: Array<{ id: string; image_url: string }> = [];
  const thumbUpdates: Array<{ id: string; thumbnail_url: string }> = [];

  for (const row of rows) {
    if (row.image_url && row.image_url.includes('supabase.co')) {
      const key = extractKey(row.image_url);
      if (key) imageUpdates.push({ id: row.id, image_url: key });
    }
    if (row.thumbnail_url && row.thumbnail_url.includes('supabase.co')) {
      const key = extractKey(row.thumbnail_url);
      if (key) thumbUpdates.push({ id: row.id, thumbnail_url: key });
    }
  }

  if (imageUpdates.length > 0) {
    console.log(
      `${prefix} standalone_maps.image_url: ${imageUpdates.length} righe da aggiornare`
    );
    if (apply) {
      await sql.begin(async (tx) => {
        for (const u of imageUpdates) {
          await tx`UPDATE standalone_maps SET image_url = ${u.image_url} WHERE id = ${u.id}`;
        }
      });
      console.log(
        `[apply] standalone_maps.image_url: aggiornate ${imageUpdates.length} righe`
      );
    }
  } else {
    console.log(
      `${prefix} standalone_maps.image_url: nessuna riga da aggiornare`
    );
  }
  results.push({
    table: 'standalone_maps',
    column: 'image_url',
    count: imageUpdates.length,
  });

  if (thumbUpdates.length > 0) {
    console.log(
      `${prefix} standalone_maps.thumbnail_url: ${thumbUpdates.length} righe da aggiornare`
    );
    if (apply) {
      await sql.begin(async (tx) => {
        for (const u of thumbUpdates) {
          await tx`UPDATE standalone_maps SET thumbnail_url = ${u.thumbnail_url} WHERE id = ${u.id}`;
        }
      });
      console.log(
        `[apply] standalone_maps.thumbnail_url: aggiornate ${thumbUpdates.length} righe`
      );
    }
  } else {
    console.log(
      `${prefix} standalone_maps.thumbnail_url: nessuna riga da aggiornare`
    );
  }
  results.push({
    table: 'standalone_maps',
    column: 'thumbnail_url',
    count: thumbUpdates.length,
  });

  return results;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { apply } = parseArgs();

  const dbUrl = process.env.TARGET_DB_URL;
  if (!dbUrl) {
    console.error(
      'Errore: variabile d\'ambiente TARGET_DB_URL non impostata.\n' +
        'Esempio: TARGET_DB_URL=postgres://user:pass@host:5432/dbname npx tsx scripts/migrate-storage-urls.ts'
    );
    process.exit(1);
  }

  console.log(
    apply
      ? '[apply] Modalità SCRITTURA — le modifiche verranno applicate al DB.'
      : '[dry-run] Modalità sola lettura — nessuna modifica verrà applicata.'
  );
  console.log('');

  const sql = postgres(dbUrl, {
    max: 1,
    // Connessione SSL opzionale: se il server non la richiede, postgres.js la gestisce automaticamente.
    ssl: dbUrl.includes('sslmode=require') ? 'require' : false,
  });

  try {
    const allResults: MigrationResult[] = [];

    const photoResults = await migratePhotos(sql, apply);
    allResults.push(...photoResults);

    const fpResults = await migrateFloorPlans(sql, apply);
    allResults.push(...fpResults);

    const smResults = await migrateStandaloneMaps(sql, apply);
    allResults.push(...smResults);

    const totale = allResults.reduce((sum, r) => sum + r.count, 0);

    console.log('');
    if (apply) {
      console.log(`[apply] Migrazione completata. Totale righe aggiornate: ${totale}`);
    } else {
      console.log(
        `[dry-run] Totale: ${totale} righe. Passa --apply per eseguire.`
      );
    }
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error('Errore fatale:', err);
  process.exit(1);
});
