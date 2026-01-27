/**
 * Certificate Database Operations
 *
 * CRUD operations for fire seal certificates and their chunks.
 * Handles both local IndexedDB storage and sync queue management.
 */

import {
  db,
  generateId,
  now,
  Certificate,
  CertificateChunk,
  CertificateStructureType,
  CertificateMetadata,
  ChunkMetadata,
  SyncQueueItem
} from './database';

// ============================================
// CERTIFICATE OPERATIONS
// ============================================

/**
 * Create a new certificate record
 */
export async function createCertificate(
  title: string,
  brand: string,
  fileName: string,
  fileBlob: Blob,
  uploadedBy: string,
  structureType: CertificateStructureType = 'generic'
): Promise<Certificate> {
  const certificate: Certificate = {
    id: generateId(),
    title,
    brand,
    fileName,
    fileBlob,
    fileSize: fileBlob.size,
    pageCount: 0,
    structureType,
    metadata: {},
    uploadedBy,
    uploadedAt: now(),
    processingStatus: 'pending',
    synced: 0
  };

  await db.certificates.add(certificate);

  // Add to sync queue
  await addToSyncQueue(certificate, 'CREATE');

  console.log(`✅ Certificate created: ${certificate.id} - ${title}`);
  return certificate;
}

/**
 * Get a certificate by ID
 */
export async function getCertificate(id: string): Promise<Certificate | undefined> {
  return db.certificates.get(id);
}

/**
 * Get all certificates
 */
export async function getAllCertificates(): Promise<Certificate[]> {
  return db.certificates.orderBy('uploadedAt').reverse().toArray();
}

/**
 * Get certificates by brand
 */
export async function getCertificatesByBrand(brand: string): Promise<Certificate[]> {
  return db.certificates.where('brand').equals(brand).toArray();
}

/**
 * Get certificates by processing status
 */
export async function getCertificatesByStatus(
  status: Certificate['processingStatus']
): Promise<Certificate[]> {
  return db.certificates.where('processingStatus').equals(status).toArray();
}

/**
 * Get completed certificates only (for search)
 */
export async function getCompletedCertificates(): Promise<Certificate[]> {
  return db.certificates.where('processingStatus').equals('completed').toArray();
}

/**
 * Update certificate processing status
 */
export async function updateCertificateStatus(
  id: string,
  status: Certificate['processingStatus'],
  error?: string
): Promise<void> {
  const updates: Partial<Certificate> = {
    processingStatus: status,
    synced: 0
  };

  if (status === 'completed') {
    updates.processedAt = now();
  }

  if (error) {
    updates.processingError = error;
  }

  await db.certificates.update(id, updates);

  const certificate = await db.certificates.get(id);
  if (certificate) {
    await addToSyncQueue(certificate, 'UPDATE');
  }

  console.log(`📝 Certificate ${id} status updated to: ${status}`);
}

/**
 * Update certificate metadata (extracted from PDF)
 */
export async function updateCertificateMetadata(
  id: string,
  metadata: CertificateMetadata,
  pageCount?: number,
  structureType?: CertificateStructureType
): Promise<void> {
  const updates: Partial<Certificate> = {
    metadata,
    synced: 0
  };

  if (pageCount !== undefined) {
    updates.pageCount = pageCount;
  }

  if (structureType) {
    updates.structureType = structureType;
  }

  await db.certificates.update(id, updates);

  const certificate = await db.certificates.get(id);
  if (certificate) {
    await addToSyncQueue(certificate, 'UPDATE');
  }

  console.log(`📝 Certificate ${id} metadata updated`);
}

/**
 * Update certificate with remote URL (after Supabase upload)
 */
export async function updateCertificateUrl(id: string, fileUrl: string): Promise<void> {
  await db.certificates.update(id, { fileUrl, synced: 1 });
  console.log(`📝 Certificate ${id} URL updated`);
}

/**
 * Delete a certificate and all its chunks
 */
export async function deleteCertificate(id: string): Promise<void> {
  const certificate = await db.certificates.get(id);
  if (!certificate) {
    throw new Error(`Certificate not found: ${id}`);
  }

  // Delete all chunks first
  await db.certificateChunks.where('certificateId').equals(id).delete();

  // Delete the certificate
  await db.certificates.delete(id);

  // Add to sync queue for remote deletion
  await addToSyncQueue(certificate, 'DELETE');

  console.log(`🗑️ Certificate deleted: ${id}`);
}

// ============================================
// CHUNK OPERATIONS
// ============================================

/**
 * Create a new chunk for a certificate
 */
export async function createChunk(
  certificateId: string,
  pageNumber: number,
  chunkIndex: number,
  content: string,
  metadata: ChunkMetadata = {}
): Promise<CertificateChunk> {
  // Generate content hash for deduplication
  const contentHash = await generateContentHash(content);

  const chunk: CertificateChunk = {
    id: generateId(),
    certificateId,
    pageNumber,
    chunkIndex,
    content,
    contentHash,
    embeddingModel: 'text-embedding-3-small',
    metadata,
    createdAt: now(),
    synced: 0
  };

  await db.certificateChunks.add(chunk);
  return chunk;
}

/**
 * Create multiple chunks in batch
 */
export async function createChunksBatch(
  chunks: Array<{
    certificateId: string;
    pageNumber: number;
    chunkIndex: number;
    content: string;
    metadata?: ChunkMetadata;
  }>
): Promise<CertificateChunk[]> {
  const createdChunks: CertificateChunk[] = [];

  for (const chunkData of chunks) {
    const contentHash = await generateContentHash(chunkData.content);

    const chunk: CertificateChunk = {
      id: generateId(),
      certificateId: chunkData.certificateId,
      pageNumber: chunkData.pageNumber,
      chunkIndex: chunkData.chunkIndex,
      content: chunkData.content,
      contentHash,
      embeddingModel: 'text-embedding-3-small',
      metadata: chunkData.metadata || {},
      createdAt: now(),
      synced: 0
    };

    createdChunks.push(chunk);
  }

  await db.certificateChunks.bulkAdd(createdChunks);
  console.log(`✅ Created ${createdChunks.length} chunks`);

  return createdChunks;
}

/**
 * Get all chunks for a certificate
 */
export async function getChunksForCertificate(certificateId: string): Promise<CertificateChunk[]> {
  return db.certificateChunks
    .where('certificateId')
    .equals(certificateId)
    .sortBy('pageNumber');
}

/**
 * Get chunks for a specific page
 */
export async function getChunksForPage(
  certificateId: string,
  pageNumber: number
): Promise<CertificateChunk[]> {
  return db.certificateChunks
    .where('[certificateId+pageNumber]')
    .equals([certificateId, pageNumber])
    .toArray();
}

/**
 * Get chunk count for a certificate
 */
export async function getChunkCount(certificateId: string): Promise<number> {
  return db.certificateChunks.where('certificateId').equals(certificateId).count();
}

/**
 * Update chunk embedding
 */
export async function updateChunkEmbedding(
  chunkId: string,
  embedding: number[]
): Promise<void> {
  await db.certificateChunks.update(chunkId, {
    embedding,
    synced: 0
  });
}

/**
 * Update multiple chunk embeddings in batch
 */
export async function updateChunkEmbeddingsBatch(
  updates: Array<{ id: string; embedding: number[] }>
): Promise<void> {
  await db.transaction('rw', db.certificateChunks, async () => {
    for (const update of updates) {
      await db.certificateChunks.update(update.id, {
        embedding: update.embedding,
        synced: 0
      });
    }
  });

  console.log(`✅ Updated embeddings for ${updates.length} chunks`);
}

/**
 * Get chunks without embeddings (for processing)
 */
export async function getChunksWithoutEmbeddings(
  certificateId?: string,
  limit: number = 100
): Promise<CertificateChunk[]> {
  let query = db.certificateChunks.filter(chunk => !chunk.embedding);

  if (certificateId) {
    query = db.certificateChunks
      .where('certificateId')
      .equals(certificateId)
      .filter(chunk => !chunk.embedding);
  }

  return query.limit(limit).toArray();
}

/**
 * Get all chunks with embeddings (for local search)
 */
export async function getChunksWithEmbeddings(): Promise<CertificateChunk[]> {
  return db.certificateChunks.filter(chunk => !!chunk.embedding).toArray();
}

/**
 * Delete all chunks for a certificate
 */
export async function deleteChunksForCertificate(certificateId: string): Promise<number> {
  const count = await db.certificateChunks.where('certificateId').equals(certificateId).delete();
  console.log(`🗑️ Deleted ${count} chunks for certificate ${certificateId}`);
  return count;
}

// ============================================
// SEARCH HELPERS
// ============================================

/**
 * Get unique brands from all certificates
 */
export async function getUniqueBrands(): Promise<string[]> {
  const certificates = await db.certificates.toArray();
  const brands = new Set(certificates.map(c => c.brand));
  return Array.from(brands).sort();
}

/**
 * Get unique REI values from all completed certificates
 */
export async function getUniqueReiValues(): Promise<string[]> {
  const certificates = await getCompletedCertificates();
  const reiValues = new Set<string>();

  certificates.forEach(cert => {
    cert.metadata.reiValues?.forEach(rei => reiValues.add(rei));
  });

  // Sort REI values numerically
  return Array.from(reiValues).sort((a, b) => {
    const numA = parseInt(a.replace(/\D/g, ''), 10);
    const numB = parseInt(b.replace(/\D/g, ''), 10);
    return numA - numB;
  });
}

/**
 * Get unique support types from all completed certificates
 */
export async function getUniqueSupportTypes(): Promise<string[]> {
  const certificates = await getCompletedCertificates();
  const supportTypes = new Set<string>();

  certificates.forEach(cert => {
    cert.metadata.supportTypes?.forEach(type => supportTypes.add(type));
  });

  return Array.from(supportTypes).sort();
}

// ============================================
// STATISTICS
// ============================================

/**
 * Get certificate statistics
 */
export async function getCertificateStats() {
  const [
    totalCertificates,
    completedCertificates,
    pendingCertificates,
    processingCertificates,
    errorCertificates,
    totalChunks,
    chunksWithEmbeddings
  ] = await Promise.all([
    db.certificates.count(),
    db.certificates.where('processingStatus').equals('completed').count(),
    db.certificates.where('processingStatus').equals('pending').count(),
    db.certificates.where('processingStatus').equals('processing').count(),
    db.certificates.where('processingStatus').equals('error').count(),
    db.certificateChunks.count(),
    db.certificateChunks.filter(c => !!c.embedding).count()
  ]);

  return {
    totalCertificates,
    completedCertificates,
    pendingCertificates,
    processingCertificates,
    errorCertificates,
    totalChunks,
    chunksWithEmbeddings,
    chunksWithoutEmbeddings: totalChunks - chunksWithEmbeddings
  };
}

// ============================================
// SYNC QUEUE HELPERS
// ============================================

/**
 * Add certificate operation to sync queue
 */
async function addToSyncQueue(
  certificate: Certificate,
  operation: 'CREATE' | 'UPDATE' | 'DELETE'
): Promise<void> {
  // Don't include fileBlob in sync payload (will be uploaded separately)
  const { fileBlob, ...certificateWithoutBlob } = certificate;

  const syncItem: SyncQueueItem = {
    id: `certificate-${certificate.id}-${now()}`,
    operation,
    entityType: 'certificate' as any,  // Will need to add to SyncQueueItem type
    entityId: certificate.id,
    payload: certificateWithoutBlob,
    timestamp: now(),
    retryCount: 0,
    synced: 0
  };

  await db.syncQueue.add(syncItem);
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Generate SHA-256 hash of content for deduplication
 */
async function generateContentHash(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex.substring(0, 32); // Use first 32 chars
}

/**
 * Calculate cosine similarity between two vectors
 * Used for local search when offline
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have the same length');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  if (magnitude === 0) return 0;

  return dotProduct / magnitude;
}

/**
 * Local vector search (for offline use)
 */
export async function localVectorSearch(
  queryEmbedding: number[],
  options: {
    topK?: number;
    minSimilarity?: number;
    filterBrand?: string;
    filterRei?: string;
    filterSupport?: string;
  } = {}
): Promise<Array<CertificateChunk & { similarity: number; certificateTitle: string; certificateBrand: string }>> {
  const { topK = 10, minSimilarity = 0.5, filterBrand, filterRei, filterSupport } = options;

  // Get all chunks with embeddings
  const chunks = await getChunksWithEmbeddings();

  // Get certificates for filtering and display
  const certificates = await getCompletedCertificates();
  const certMap = new Map(certificates.map(c => [c.id, c]));

  // Calculate similarities and filter
  const results = chunks
    .map(chunk => {
      const cert = certMap.get(chunk.certificateId);
      if (!cert || !chunk.embedding) return null;

      // Apply filters
      if (filterBrand && cert.brand !== filterBrand) return null;
      if (filterRei && !cert.metadata.reiValues?.includes(filterRei)) return null;
      if (filterSupport && !cert.metadata.supportTypes?.includes(filterSupport)) return null;

      const similarity = cosineSimilarity(queryEmbedding, chunk.embedding);
      if (similarity < minSimilarity) return null;

      return {
        ...chunk,
        similarity,
        certificateTitle: cert.title,
        certificateBrand: cert.brand
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);

  return results;
}
