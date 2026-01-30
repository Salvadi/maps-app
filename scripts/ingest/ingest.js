/**
 * FPS Ingestion Pipeline
 *
 * Processa certificazioni antincendio PDF:
 * 1. LlamaParse: PDF → Markdown strutturato (tabelle preservate)
 * 2. Chunking: Markdown → chunk per sezione/tabella
 * 3. Embedding: chunk → vettori OpenAI text-embedding-3-large (3072d)
 * 4. Qdrant: indicizzazione vettori con metadata
 * 5. Supabase: salvataggio metadata certificati/chunk
 *
 * Uso: npm run ingest        (processa tutti i PDF in ./pdfs/)
 *      npm run ingest:dry    (mostra cosa farebbe senza scrivere)
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { LlamaParseReader } from 'llamaindex';
import { QdrantClient } from '@qdrant/js-client-rest';

// ── Config ──────────────────────────────────────────────────────────
const DRY_RUN = process.argv.includes('--dry-run');
const PDF_DIR = path.resolve('./pdfs');
const COLLECTION_NAME = 'fire_certificates';
const EMBEDDING_MODEL = 'openai/text-embedding-3-large';
const EMBEDDING_DIMENSIONS = 3072;
const CHUNK_MAX_TOKENS = 512;
const CHUNK_OVERLAP_TOKENS = 50;

// ── Clients ─────────────────────────────────────────────────────────
const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
});

const llamaParseReader = new LlamaParseReader({
  apiKey: process.env.LLAMAPARSE_API_KEY,
  resultType: 'markdown',
  language: 'it',
  parsingInstruction: `This is a fire safety certification document (certificazione antincendio).
It contains technical tables with materials, diameters, fire resistance classes (EI30, EI60, EI90, EI120, EI180, EI240),
product names, and installation conditions.
Preserve all table structures accurately.
Extract headers and section numbers.
Keep all numerical values exact (diameters in mm, distances in mm).`,
});

// ── Step 1: Parse PDF ───────────────────────────────────────────────
async function parsePDF(pdfPath) {
  console.log(`  [1/5] Parsing PDF with LlamaParse: ${path.basename(pdfPath)}`);
  const documents = await llamaParseReader.loadData(pdfPath);
  // LlamaParse returns array of Document objects with text content
  const fullMarkdown = documents.map(d => d.text).join('\n\n');
  console.log(`        → ${fullMarkdown.length} chars, ${documents.length} pages`);
  return { markdown: fullMarkdown, pageCount: documents.length };
}

// ── Step 2: Chunk Markdown ──────────────────────────────────────────
function chunkMarkdown(markdown, certName) {
  console.log(`  [2/5] Chunking markdown...`);

  const chunks = [];
  // Split by headers (## or ###) to get sections
  const sections = markdown.split(/(?=^#{1,3}\s)/m);

  for (const section of sections) {
    if (!section.trim()) continue;

    // Extract section header if present
    const headerMatch = section.match(/^(#{1,3})\s+(.+)/);
    const sectionTitle = headerMatch ? headerMatch[2].trim() : '';
    const headerLevel = headerMatch ? headerMatch[1].length : 0;

    // Check if section contains a table
    const hasTable = section.includes('|') && section.includes('---');

    // If section is short enough, keep as single chunk
    const approxTokens = section.split(/\s+/).length;
    if (approxTokens <= CHUNK_MAX_TOKENS) {
      chunks.push({
        content: section.trim(),
        section: sectionTitle,
        hasTable,
        tokenEstimate: approxTokens,
      });
    } else {
      // Split large sections into paragraphs, keeping tables intact
      const parts = splitPreservingTables(section);
      let buffer = '';
      let bufferTokens = 0;

      for (const part of parts) {
        const partTokens = part.split(/\s+/).length;

        if (bufferTokens + partTokens > CHUNK_MAX_TOKENS && buffer) {
          chunks.push({
            content: buffer.trim(),
            section: sectionTitle,
            hasTable: buffer.includes('|') && buffer.includes('---'),
            tokenEstimate: bufferTokens,
          });
          // Overlap: keep last portion
          const overlapText = getOverlapText(buffer, CHUNK_OVERLAP_TOKENS);
          buffer = overlapText + '\n\n' + part;
          bufferTokens = overlapText.split(/\s+/).length + partTokens;
        } else {
          buffer += (buffer ? '\n\n' : '') + part;
          bufferTokens += partTokens;
        }
      }

      if (buffer.trim()) {
        chunks.push({
          content: buffer.trim(),
          section: sectionTitle,
          hasTable: buffer.includes('|') && buffer.includes('---'),
          tokenEstimate: bufferTokens,
        });
      }
    }
  }

  // Add index and cert name
  chunks.forEach((chunk, i) => {
    chunk.index = i;
    chunk.certName = certName;
  });

  console.log(`        → ${chunks.length} chunks (${chunks.filter(c => c.hasTable).length} with tables)`);
  return chunks;
}

function splitPreservingTables(text) {
  const parts = [];
  let current = '';
  let inTable = false;

  for (const line of text.split('\n')) {
    const isTableLine = line.trim().startsWith('|') || line.trim().match(/^[-|:\s]+$/);

    if (isTableLine && !inTable) {
      if (current.trim()) parts.push(current.trim());
      current = line;
      inTable = true;
    } else if (!isTableLine && inTable) {
      parts.push(current.trim());
      current = line;
      inTable = false;
    } else if (!inTable && line.trim() === '') {
      if (current.trim()) parts.push(current.trim());
      current = '';
    } else {
      current += '\n' + line;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function getOverlapText(text, maxTokens) {
  const words = text.split(/\s+/);
  return words.slice(-maxTokens).join(' ');
}

// ── Step 3: Generate Embeddings ─────────────────────────────────────
async function generateEmbeddings(chunks) {
  console.log(`  [3/5] Generating embeddings (${chunks.length} chunks)...`);

  const batchSize = 20; // OpenRouter/OpenAI supports batch embedding
  const embeddings = [];

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const texts = batch.map(c => c.content);

    const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: texts,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Embedding API error: ${response.status} ${err}`);
    }

    const data = await response.json();
    for (const item of data.data) {
      embeddings.push(item.embedding);
    }

    console.log(`        → batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(chunks.length / batchSize)} done`);
  }

  return embeddings;
}

// ── Step 4: Upload to Qdrant ────────────────────────────────────────
async function ensureQdrantCollection() {
  try {
    await qdrant.getCollection(COLLECTION_NAME);
    console.log(`        → Collection "${COLLECTION_NAME}" exists`);
  } catch {
    console.log(`        → Creating collection "${COLLECTION_NAME}"...`);
    await qdrant.createCollection(COLLECTION_NAME, {
      vectors: {
        size: EMBEDDING_DIMENSIONS,
        distance: 'Cosine',
      },
    });
  }
}

async function uploadToQdrant(chunks, embeddings, certId) {
  console.log(`  [4/5] Uploading to Qdrant...`);
  await ensureQdrantCollection();

  const points = chunks.map((chunk, i) => ({
    id: crypto.randomUUID(),
    vector: embeddings[i],
    payload: {
      cert_id: certId,
      cert_name: chunk.certName,
      section: chunk.section,
      content: chunk.content,
      chunk_index: chunk.index,
      has_table: chunk.hasTable,
      token_estimate: chunk.tokenEstimate,
    },
  }));

  // Upload in batches of 100
  const batchSize = 100;
  for (let i = 0; i < points.length; i += batchSize) {
    const batch = points.slice(i, i + batchSize);
    await qdrant.upsert(COLLECTION_NAME, { points: batch });
  }

  console.log(`        → ${points.length} points uploaded`);
  return points;
}

// ── Step 5: Save metadata to Supabase ───────────────────────────────
async function saveMetadata(certId, certName, pageCount, chunks, pdfFilename) {
  console.log(`  [5/5] Saving metadata...`);

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.log('        → Supabase not configured, skipping metadata save');
    return;
  }

  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Insert certificate
  await supabase.from('certificates').upsert({
    id: certId,
    name: certName,
    pages: pageCount,
    file_path: pdfFilename,
    uploaded_at: new Date().toISOString(),
  });

  // Insert chunks metadata
  const chunkRows = chunks.map((chunk, i) => ({
    id: crypto.randomUUID(),
    cert_id: certId,
    section: chunk.section,
    content: chunk.content.substring(0, 500), // Summary only, full content is in Qdrant
    chunk_index: chunk.index,
    has_table: chunk.hasTable,
  }));

  const batchSize = 50;
  for (let i = 0; i < chunkRows.length; i += batchSize) {
    await supabase.from('certificate_chunks').upsert(chunkRows.slice(i, i + batchSize));
  }

  console.log(`        → Certificate + ${chunkRows.length} chunk records saved`);
}

// ── Main Pipeline ───────────────────────────────────────────────────
async function processPDF(pdfPath) {
  const filename = path.basename(pdfPath);
  const certName = path.basename(pdfPath, '.pdf');
  const certId = crypto.randomUUID();

  console.log(`\n━━━ Processing: ${filename} ━━━`);

  // 1. Parse
  const { markdown, pageCount } = await parsePDF(pdfPath);

  // Save intermediate markdown for debugging
  const mdPath = pdfPath.replace('.pdf', '.parsed.md');
  fs.writeFileSync(mdPath, markdown, 'utf-8');
  console.log(`        → Saved parsed markdown: ${path.basename(mdPath)}`);

  // 2. Chunk
  const chunks = chunkMarkdown(markdown, certName);

  if (DRY_RUN) {
    console.log(`\n  [DRY RUN] Would process ${chunks.length} chunks, ${pageCount} pages`);
    console.log(`  Sample chunk (first):\n${chunks[0]?.content?.substring(0, 300)}...`);
    return;
  }

  // 3. Embed
  const embeddings = await generateEmbeddings(chunks);

  // 4. Upload to Qdrant
  await uploadToQdrant(chunks, embeddings, certId);

  // 5. Save metadata
  await saveMetadata(certId, certName, pageCount, chunks, filename);

  console.log(`\n✓ Done: ${filename} → ${chunks.length} chunks indexed`);
}

async function main() {
  console.log('═══ FPS Ingestion Pipeline ═══');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log(`PDF directory: ${PDF_DIR}\n`);

  // Find all PDFs
  if (!fs.existsSync(PDF_DIR)) {
    console.error(`ERROR: PDF directory not found: ${PDF_DIR}`);
    console.error('Create the directory and place your PDF certificates in it.');
    process.exit(1);
  }

  const pdfFiles = fs.readdirSync(PDF_DIR).filter(f => f.toLowerCase().endsWith('.pdf'));

  if (pdfFiles.length === 0) {
    console.error('No PDF files found in ./pdfs/ directory');
    process.exit(1);
  }

  console.log(`Found ${pdfFiles.length} PDF(s):\n${pdfFiles.map(f => `  - ${f}`).join('\n')}\n`);

  for (const file of pdfFiles) {
    try {
      await processPDF(path.join(PDF_DIR, file));
    } catch (err) {
      console.error(`\n✗ Error processing ${file}:`, err.message);
      console.error(err.stack);
    }
  }

  console.log('\n═══ Pipeline complete ═══');
}

main();
