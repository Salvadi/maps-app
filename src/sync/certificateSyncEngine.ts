/**
 * Certificate Sync Engine
 *
 * Handles synchronization of certificates and chunks between
 * local IndexedDB and Supabase cloud storage.
 */

import { db, Certificate, CertificateChunk } from '../db/database';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

export interface CertificateSyncResult {
  certificatesUploaded: number;
  certificatesDownloaded: number;
  chunksUploaded: number;
  chunksDownloaded: number;
  errors: string[];
}

/**
 * Upload a certificate to Supabase
 */
export async function uploadCertificate(certificate: Certificate): Promise<void> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase non configurato');
  }

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    throw new Error('Utente non autenticato');
  }

  // Upload PDF to storage if we have the blob
  let fileUrl = certificate.fileUrl;
  if (certificate.fileBlob && !fileUrl) {
    const filePath = `certificates/${certificate.id}/${certificate.fileName}`;

    const { error: uploadError } = await supabase.storage
      .from('certificates')
      .upload(filePath, certificate.fileBlob, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadError) {
      throw new Error(`Errore upload PDF: ${uploadError.message}`);
    }

    // Store the path instead of public URL - we'll use signed URLs for access
    // This works with both public and private buckets
    fileUrl = filePath;

    // Update local record with URL
    await db.certificates.update(certificate.id, { fileUrl });
  }

  // Upsert certificate record
  const { error } = await supabase.from('certificates').upsert({
    id: certificate.id,
    title: certificate.title,
    brand: certificate.brand,
    file_name: certificate.fileName,
    file_url: fileUrl,
    file_size: certificate.fileSize,
    page_count: certificate.pageCount,
    structure_type: certificate.structureType,
    metadata: certificate.metadata,
    uploaded_by: certificate.uploadedBy,
    uploaded_at: new Date(certificate.uploadedAt).toISOString(),
    processed_at: certificate.processedAt ? new Date(certificate.processedAt).toISOString() : null,
    processing_status: certificate.processingStatus,
    processing_error: certificate.processingError
  });

  if (error) {
    throw new Error(`Errore sync certificato: ${error.message}`);
  }

  // Mark as synced locally
  await db.certificates.update(certificate.id, { synced: 1 });
  console.log(`✅ Certificate synced: ${certificate.title}`);
}

/**
 * Upload chunks for a certificate to Supabase
 */
export async function uploadCertificateChunks(certificateId: string): Promise<number> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase non configurato');
  }

  const chunks = await db.certificateChunks
    .where('certificateId')
    .equals(certificateId)
    .filter(c => c.synced === 0)
    .toArray();

  if (chunks.length === 0) {
    return 0;
  }

  console.log(`📤 Uploading ${chunks.length} chunks for certificate ${certificateId}...`);

  // Upload in batches
  const BATCH_SIZE = 50;
  let uploadedCount = 0;

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);

    const supabaseChunks = batch.map(chunk => ({
      id: chunk.id,
      certificate_id: chunk.certificateId,
      page_number: chunk.pageNumber,
      chunk_index: chunk.chunkIndex,
      content: chunk.content,
      content_hash: chunk.contentHash,
      embedding: chunk.embedding ? `[${chunk.embedding.join(',')}]` : null,
      embedding_model: chunk.embeddingModel,
      metadata: chunk.metadata
    }));

    const { error } = await supabase
      .from('certificate_chunks')
      .upsert(supabaseChunks, {
        onConflict: 'content_hash',
        ignoreDuplicates: true
      });

    if (error) {
      console.error(`Error uploading chunk batch: ${error.message}`);
      continue;
    }

    // Mark batch as synced
    const chunkIds = batch.map(c => c.id);
    await db.certificateChunks
      .where('id')
      .anyOf(chunkIds)
      .modify({ synced: 1 });

    uploadedCount += batch.length;
  }

  console.log(`✅ Uploaded ${uploadedCount} chunks`);
  return uploadedCount;
}

/**
 * Download certificates from Supabase to local
 */
export async function downloadCertificates(): Promise<number> {
  if (!isSupabaseConfigured()) {
    console.warn('Supabase non configurato, skip download');
    return 0;
  }

  if (!navigator.onLine) {
    console.warn('Offline, skip download');
    return 0;
  }

  console.log('⬇️ Downloading certificates from Supabase...');

  const { data: remoteCertificates, error } = await supabase
    .from('certificates')
    .select('*')
    .eq('processing_status', 'completed');

  if (error) {
    throw new Error(`Errore download certificati: ${error.message}`);
  }

  if (!remoteCertificates || remoteCertificates.length === 0) {
    console.log('No certificates to download');
    return 0;
  }

  let downloadedCount = 0;

  for (const remote of remoteCertificates) {
    const existing = await db.certificates.get(remote.id);

    if (existing) {
      // Update if remote is newer
      const remoteUpdated = new Date(remote.updated_at).getTime();
      if (remoteUpdated > (existing.processedAt || existing.uploadedAt)) {
        await db.certificates.put(convertRemoteCertificate(remote));
        downloadedCount++;
      }
    } else {
      // New certificate
      await db.certificates.add(convertRemoteCertificate(remote));
      downloadedCount++;
    }
  }

  console.log(`✅ Downloaded ${downloadedCount} certificates`);
  return downloadedCount;
}

/**
 * Download chunks for a certificate from Supabase
 */
export async function downloadCertificateChunks(certificateId: string): Promise<number> {
  if (!isSupabaseConfigured()) {
    return 0;
  }

  console.log(`⬇️ Downloading chunks for certificate ${certificateId}...`);

  const { data: remoteChunks, error } = await supabase
    .from('certificate_chunks')
    .select('*')
    .eq('certificate_id', certificateId);

  if (error) {
    throw new Error(`Errore download chunks: ${error.message}`);
  }

  if (!remoteChunks || remoteChunks.length === 0) {
    return 0;
  }

  let downloadedCount = 0;

  for (const remote of remoteChunks) {
    const existing = await db.certificateChunks.get(remote.id);

    if (!existing) {
      const chunk = convertRemoteChunk(remote);
      await db.certificateChunks.add(chunk);
      downloadedCount++;
    }
  }

  console.log(`✅ Downloaded ${downloadedCount} chunks for certificate ${certificateId}`);
  return downloadedCount;
}

/**
 * Full sync: upload local changes and download remote changes
 */
export async function syncCertificates(): Promise<CertificateSyncResult> {
  const result: CertificateSyncResult = {
    certificatesUploaded: 0,
    certificatesDownloaded: 0,
    chunksUploaded: 0,
    chunksDownloaded: 0,
    errors: []
  };

  if (!isSupabaseConfigured()) {
    result.errors.push('Supabase non configurato');
    return result;
  }

  if (!navigator.onLine) {
    result.errors.push('Offline');
    return result;
  }

  console.log('🔄 Starting certificate sync...');

  // Upload unsynced certificates
  try {
    const unsyncedCertificates = await db.certificates
      .filter(c => c.synced === 0 && c.processingStatus === 'completed')
      .toArray();

    for (const cert of unsyncedCertificates) {
      try {
        await uploadCertificate(cert);
        result.certificatesUploaded++;

        // Upload chunks for this certificate
        const chunksUploaded = await uploadCertificateChunks(cert.id);
        result.chunksUploaded += chunksUploaded;
      } catch (err) {
        result.errors.push(`Upload ${cert.title}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err) {
    result.errors.push(`Upload error: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Download remote certificates
  try {
    result.certificatesDownloaded = await downloadCertificates();

    // Download chunks for new certificates
    const localCertificates = await db.certificates.toArray();
    for (const cert of localCertificates) {
      const localChunkCount = await db.certificateChunks
        .where('certificateId')
        .equals(cert.id)
        .count();

      if (localChunkCount === 0 && cert.processingStatus === 'completed') {
        const chunksDownloaded = await downloadCertificateChunks(cert.id);
        result.chunksDownloaded += chunksDownloaded;
      }
    }
  } catch (err) {
    result.errors.push(`Download error: ${err instanceof Error ? err.message : String(err)}`);
  }

  console.log('✅ Certificate sync complete:', result);
  return result;
}

/**
 * Delete a certificate from both local and remote
 */
export async function deleteCertificateEverywhere(certificateId: string): Promise<void> {
  // Delete from Supabase first
  if (isSupabaseConfigured() && navigator.onLine) {
    const certificate = await db.certificates.get(certificateId);

    // Delete storage file
    if (certificate?.fileUrl) {
      const filePath = `certificates/${certificateId}/${certificate.fileName}`;
      await supabase.storage.from('certificates').remove([filePath]);
    }

    // Delete chunks (cascade should handle this, but be explicit)
    await supabase.from('certificate_chunks').delete().eq('certificate_id', certificateId);

    // Delete certificate record
    await supabase.from('certificates').delete().eq('id', certificateId);
  }

  // Delete locally
  await db.certificateChunks.where('certificateId').equals(certificateId).delete();
  await db.certificates.delete(certificateId);

  console.log(`🗑️ Certificate ${certificateId} deleted everywhere`);
}

/**
 * Convert remote certificate to local format
 */
function convertRemoteCertificate(remote: any): Certificate {
  return {
    id: remote.id,
    title: remote.title,
    brand: remote.brand,
    fileName: remote.file_name,
    fileUrl: remote.file_url,
    fileSize: remote.file_size,
    pageCount: remote.page_count,
    structureType: remote.structure_type,
    metadata: remote.metadata || {},
    uploadedBy: remote.uploaded_by,
    uploadedAt: new Date(remote.uploaded_at).getTime(),
    processedAt: remote.processed_at ? new Date(remote.processed_at).getTime() : undefined,
    processingStatus: remote.processing_status,
    processingError: remote.processing_error,
    synced: 1
  };
}

/**
 * Convert remote chunk to local format
 */
function convertRemoteChunk(remote: any): CertificateChunk {
  // Parse embedding from pgvector format
  let embedding: number[] | undefined;
  if (remote.embedding) {
    try {
      if (typeof remote.embedding === 'string') {
        embedding = JSON.parse(remote.embedding.replace(/^\[/, '[').replace(/\]$/, ']'));
      } else if (Array.isArray(remote.embedding)) {
        embedding = remote.embedding;
      }
    } catch {
      console.warn('Failed to parse embedding for chunk:', remote.id);
    }
  }

  return {
    id: remote.id,
    certificateId: remote.certificate_id,
    pageNumber: remote.page_number,
    chunkIndex: remote.chunk_index || 0,
    content: remote.content,
    contentHash: remote.content_hash,
    embedding,
    embeddingModel: remote.embedding_model || 'text-embedding-3-small',
    metadata: remote.metadata || {},
    createdAt: new Date(remote.created_at).getTime(),
    synced: 1
  };
}

/**
 * Get sync status
 */
export async function getCertificateSyncStatus(): Promise<{
  unsyncedCertificates: number;
  unsyncedChunks: number;
  totalCertificates: number;
  totalChunks: number;
}> {
  const [
    unsyncedCertificates,
    unsyncedChunks,
    totalCertificates,
    totalChunks
  ] = await Promise.all([
    db.certificates.filter(c => c.synced === 0).count(),
    db.certificateChunks.filter(c => c.synced === 0).count(),
    db.certificates.count(),
    db.certificateChunks.count()
  ]);

  return {
    unsyncedCertificates,
    unsyncedChunks,
    totalCertificates,
    totalChunks
  };
}

/**
 * Get a signed URL for accessing a certificate PDF
 * Works with both public and private buckets
 */
export async function getCertificatePDFUrl(
  certificateId: string,
  fileName: string,
  expiresIn: number = 3600 // 1 hour default
): Promise<string> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase non configurato');
  }

  const filePath = `certificates/${certificateId}/${fileName}`;

  // Try to create a signed URL (works for private buckets)
  const { data, error } = await supabase.storage
    .from('certificates')
    .createSignedUrl(filePath, expiresIn);

  if (error) {
    console.error('Error creating signed URL:', error);

    // If signed URL fails, try public URL as fallback
    const { data: publicData } = supabase.storage
      .from('certificates')
      .getPublicUrl(filePath);

    if (publicData?.publicUrl) {
      return publicData.publicUrl;
    }

    throw new Error(`Cannot access certificate PDF: ${error.message}`);
  }

  return data.signedUrl;
}

/**
 * Check for duplicate certificates before upload
 * Returns existing certificate info if found
 */
export interface DuplicateCheckResult {
  isDuplicate: boolean;
  existingCertificate?: Certificate;
  matchType?: 'content' | 'name';
  recommendation?: 'skip' | 'replace' | 'keep_both';
  message?: string;
}

export async function checkDuplicateCertificate(
  fileName: string,
  fileBlob: Blob,
  extractedMetadata?: {
    certificationNumber?: string;
    validFrom?: string;
  }
): Promise<DuplicateCheckResult> {
  // Get all local certificates
  const allCertificates = await db.certificates.toArray();

  // 1. Check by file name (most common case)
  const sameNameCerts = allCertificates.filter(
    c => c.fileName.toLowerCase() === fileName.toLowerCase()
  );

  if (sameNameCerts.length > 0) {
    const existing = sameNameCerts[0];

    // Compare file sizes - if identical, likely same file
    if (existing.fileSize === fileBlob.size) {
      return {
        isDuplicate: true,
        existingCertificate: existing,
        matchType: 'content',
        recommendation: 'skip',
        message: `Certificato "${existing.title}" già presente (stesso file)`
      };
    }

    // Different size = possibly updated version
    // Check dates if available (validFrom is the issue/validity date)
    if (extractedMetadata?.validFrom && existing.metadata?.validFrom) {
      const newDate = parseItalianDate(extractedMetadata.validFrom);
      const existingDate = parseItalianDate(existing.metadata.validFrom);

      if (newDate && existingDate) {
        if (newDate > existingDate) {
          return {
            isDuplicate: true,
            existingCertificate: existing,
            matchType: 'name',
            recommendation: 'replace',
            message: `Trovata versione più recente di "${existing.title}" (${extractedMetadata.validFrom} vs ${existing.metadata.validFrom})`
          };
        } else if (newDate < existingDate) {
          return {
            isDuplicate: true,
            existingCertificate: existing,
            matchType: 'name',
            recommendation: 'skip',
            message: `"${existing.title}" ha già una versione più recente (${existing.metadata.validFrom})`
          };
        }
      }
    }

    // Same name, different size, no date info - ask user
    return {
      isDuplicate: true,
      existingCertificate: existing,
      matchType: 'name',
      recommendation: 'keep_both',
      message: `Esiste già un certificato con nome simile: "${existing.title}". Dimensioni diverse (${formatFileSize(existing.fileSize)} vs ${formatFileSize(fileBlob.size)})`
    };
  }

  // 2. Check by certification number if available
  if (extractedMetadata?.certificationNumber) {
    const sameCertNumber = allCertificates.find(
      c => c.metadata?.certificationNumber === extractedMetadata.certificationNumber
    );

    if (sameCertNumber) {
      return {
        isDuplicate: true,
        existingCertificate: sameCertNumber,
        matchType: 'content',
        recommendation: 'replace',
        message: `Certificato con stesso numero (${extractedMetadata.certificationNumber}) già presente: "${sameCertNumber.title}"`
      };
    }
  }

  return { isDuplicate: false };
}

/**
 * Parse Italian date format (DD/MM/YYYY or DD.MM.YYYY)
 */
function parseItalianDate(dateStr: string): Date | null {
  if (!dateStr) return null;

  // Try DD/MM/YYYY or DD.MM.YYYY
  const match = dateStr.match(/(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})/);
  if (match) {
    const [, day, month, year] = match;
    return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
  }

  // Try YYYY-MM-DD
  const isoMatch = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
  }

  return null;
}

/**
 * Format file size for display
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Check if certificate storage bucket is accessible
 */
export async function checkCertificateBucketAccess(): Promise<{
  accessible: boolean;
  error?: string;
}> {
  if (!isSupabaseConfigured()) {
    return { accessible: false, error: 'Supabase non configurato' };
  }

  try {
    const { error } = await supabase.storage
      .from('certificates')
      .list('', { limit: 1 });

    if (error) {
      return { accessible: false, error: error.message };
    }

    return { accessible: true };
  } catch (err) {
    return {
      accessible: false,
      error: err instanceof Error ? err.message : 'Unknown error'
    };
  }
}
