import { createClient } from '@supabase/supabase-js';

type PhotoRow = {
  id: string;
  storage_path: string | null;
  thumbnail_storage_path: string | null;
};

const PAGE_SIZE = 1000;
const UPSERT_CHUNK_SIZE = 500;

function parseArgs(argv: string[]): { apply: boolean; dryRun: boolean } {
  const apply = argv.includes('--apply');
  const dryRun = argv.includes('--dry-run') || !apply;
  return { apply, dryRun };
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

async function fetchNullUrlRows(
  supabase: ReturnType<typeof createClient>,
  selectColumns: string,
  nullColumn: 'url' | 'thumbnail_url',
  storagePathColumn: 'storage_path' | 'thumbnail_storage_path'
): Promise<PhotoRow[]> {
  const rows: PhotoRow[] = [];
  let from = 0;

  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from('photos')
      .select(selectColumns)
      .is(nullColumn, null)
      .not(storagePathColumn, 'is', null)
      .range(from, to);

    if (error) {
      throw new Error(`Failed to fetch rows for ${nullColumn}: ${error.message}`);
    }

    const pageRows = (data || []) as PhotoRow[];
    rows.push(...pageRows);

    if (pageRows.length < PAGE_SIZE) {
      break;
    }

    from += PAGE_SIZE;
  }

  return rows;
}

async function run(): Promise<void> {
  const { apply, dryRun } = parseArgs(process.argv.slice(2));

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const rowsMissingUrl = await fetchNullUrlRows(
    supabase,
    'id,storage_path,thumbnail_storage_path',
    'url',
    'storage_path'
  );

  const urlUpdates = rowsMissingUrl
    .filter((row) => typeof row.storage_path === 'string' && row.storage_path.length > 0)
    .map((row) => {
      const { data: { publicUrl } } = supabase.storage.from('photos').getPublicUrl(row.storage_path as string);
      return { id: row.id, url: publicUrl };
    });

  const rowsMissingThumbnailUrl = await fetchNullUrlRows(
    supabase,
    'id,storage_path,thumbnail_storage_path',
    'thumbnail_url',
    'thumbnail_storage_path'
  );

  const thumbnailUpdates = rowsMissingThumbnailUrl
    .filter((row) => typeof row.thumbnail_storage_path === 'string' && row.thumbnail_storage_path.length > 0)
    .map((row) => {
      const { data: { publicUrl } } = supabase.storage.from('photos').getPublicUrl(row.thumbnail_storage_path as string);
      return { id: row.id, thumbnail_url: publicUrl };
    });

  if (dryRun) {
    console.log(`[dry-run] would update ${urlUpdates.length} rows for photos.url`);
    console.log(`[dry-run] would update ${thumbnailUpdates.length} rows for photos.thumbnail_url`);
    console.log('[dry-run] pass --apply to execute updates');
    return;
  }

  if (!apply) {
    throw new Error('Missing --apply. Use --dry-run (default) or --apply.');
  }

  for (const batch of chunkArray(urlUpdates, UPSERT_CHUNK_SIZE)) {
    const { error } = await supabase
      .from('photos')
      .upsert(batch, { onConflict: 'id' });

    if (error) {
      throw new Error(`Failed to upsert url batch: ${error.message}`);
    }
  }

  for (const batch of chunkArray(thumbnailUpdates, UPSERT_CHUNK_SIZE)) {
    const { error } = await supabase
      .from('photos')
      .upsert(batch, { onConflict: 'id' });

    if (error) {
      throw new Error(`Failed to upsert thumbnail_url batch: ${error.message}`);
    }
  }

  console.log(`Updated ${urlUpdates.length} rows for photos.url`);
  console.log(`Updated ${thumbnailUpdates.length} rows for photos.thumbnail_url`);
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
