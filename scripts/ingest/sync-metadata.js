/**
 * Recupera metadata da Qdrant e popola Supabase.
 * Uso: node --env-file=.env sync-metadata.js
 */

import crypto from 'crypto';
import { QdrantClient } from '@qdrant/js-client-rest';
import { createClient } from '@supabase/supabase-js';

const COLLECTION_NAME = 'fire_certificates';

const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
});

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function main() {
  console.log('=== Sync metadata from Qdrant to Supabase ===\n');

  // Scroll all points from Qdrant (no vector, just payload)
  let allPoints = [];
  let offset = null;

  while (true) {
    const result = await qdrant.scroll(COLLECTION_NAME, {
      limit: 100,
      with_payload: true,
      with_vector: false,
      ...(offset && { offset }),
    });

    allPoints.push(...result.points);
    console.log(`  Fetched ${allPoints.length} points...`);

    if (!result.next_page_offset) break;
    offset = result.next_page_offset;
  }

  console.log(`\nTotal points in Qdrant: ${allPoints.length}`);

  // Group by cert_name
  const certs = {};
  for (const point of allPoints) {
    const name = point.payload.cert_name;
    if (!certs[name]) {
      certs[name] = { chunks: [], id: crypto.randomUUID() };
    }
    certs[name].chunks.push(point.payload);
  }

  console.log(`Certificates found: ${Object.keys(certs).length}`);
  for (const [name, data] of Object.entries(certs)) {
    console.log(`  - ${name}: ${data.chunks.length} chunks`);
  }

  // Insert certificates
  for (const [name, data] of Object.entries(certs)) {
    const { error: certError } = await supabase.from('certificates').upsert({
      id: data.id,
      name,
      pages: data.chunks.length,
      file_path: `${name}.pdf`,
      uploaded_at: new Date().toISOString(),
    });

    if (certError) {
      console.error(`  Error inserting certificate ${name}:`, certError.message);
      continue;
    }

    // Insert chunks
    const chunkRows = data.chunks.map((chunk, i) => ({
      id: crypto.randomUUID(),
      cert_id: data.id,
      section: chunk.section || '',
      content: (chunk.content || '').substring(0, 500),
      chunk_index: chunk.chunk_index ?? i,
      has_table: chunk.has_table ?? false,
    }));

    const batchSize = 50;
    for (let i = 0; i < chunkRows.length; i += batchSize) {
      const { error } = await supabase.from('certificate_chunks').upsert(chunkRows.slice(i, i + batchSize));
      if (error) console.error(`  Error inserting chunks for ${name}:`, error.message);
    }

    console.log(`  Saved: ${name} (${chunkRows.length} chunks)`);
  }

  console.log('\n=== Done ===');
}

main();
