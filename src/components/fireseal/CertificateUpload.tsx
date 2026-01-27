import React, { useState, useRef, useCallback } from 'react';
import { Upload, FileText, AlertCircle, Check, Loader2, X, Files } from 'lucide-react';
import { createCertificate, updateCertificateStatus, updateCertificateMetadata } from '../../db/certificates';
import { createChunksBatch, updateChunkEmbeddingsBatch } from '../../db/certificates';
import { extractTextFromPDF, hasSelectorableText, getPDFPageCount } from '../../lib/fireseal/pdfProcessor';
import { detectStructure, extractFireSealMetadata } from '../../lib/fireseal/structureDetector';
import { chunkDocument, getChunkStats } from '../../lib/fireseal/chunkingService';
import { generateEmbeddingsBatch, isOpenAIConfigured, estimateEmbeddingCost } from '../../lib/fireseal/openaiEmbedding';
import { uploadCertificate, uploadCertificateChunks } from '../../sync/certificateSyncEngine';

interface CertificateUploadProps {
  userId: string;
  onUploadComplete?: () => void;
}

type FileStatus = 'pending' | 'validating' | 'extracting' | 'chunking' | 'embedding' | 'syncing' | 'complete' | 'error';

interface FileUploadItem {
  id: string;
  file: File;
  title: string;
  brand: string;
  status: FileStatus;
  progress: number;
  message: string;
  error?: string;
  chunksCount?: number;
}

const BRANDS = ['Promat', 'AF Systems', 'Hilti', 'Global Building', 'Altro'];

export function CertificateUpload({ userId, onUploadComplete }: CertificateUploadProps) {
  const [files, setFiles] = useState<FileUploadItem[]>([]);
  const [defaultBrand, setDefaultBrand] = useState<string>('');
  const [isDragOver, setIsDragOver] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const generateId = () => `file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  const handleFilesSelect = useCallback((newFiles: FileList | File[]) => {
    const fileArray = Array.from(newFiles);
    const validFiles: FileUploadItem[] = [];
    const errors: string[] = [];

    fileArray.forEach(file => {
      if (file.type !== 'application/pdf') {
        errors.push(`${file.name}: non è un PDF`);
        return;
      }

      if (file.size > 50 * 1024 * 1024) {
        errors.push(`${file.name}: supera 50MB`);
        return;
      }

      // Check if already added
      if (files.some(f => f.file.name === file.name && f.file.size === file.size)) {
        errors.push(`${file.name}: già aggiunto`);
        return;
      }

      validFiles.push({
        id: generateId(),
        file,
        title: file.name.replace('.pdf', ''),
        brand: defaultBrand,
        status: 'pending',
        progress: 0,
        message: ''
      });
    });

    if (errors.length > 0) {
      console.warn('File validation errors:', errors);
    }

    if (validFiles.length > 0) {
      setFiles(prev => [...prev, ...validFiles]);
    }
  }, [files, defaultBrand]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    if (e.dataTransfer.files.length > 0) {
      handleFilesSelect(e.dataTransfer.files);
    }
  }, [handleFilesSelect]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const removeFile = (id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id));
  };

  const updateFileItem = (id: string, updates: Partial<FileUploadItem>) => {
    setFiles(prev => prev.map(f => f.id === id ? { ...f, ...updates } : f));
  };

  const updateFileBrand = (id: string, brand: string) => {
    updateFileItem(id, { brand });
  };

  const updateFileTitle = (id: string, title: string) => {
    updateFileItem(id, { title });
  };

  const applyDefaultBrandToAll = () => {
    if (!defaultBrand) return;
    setFiles(prev => prev.map(f => f.status === 'pending' ? { ...f, brand: defaultBrand } : f));
  };

  const processSingleFile = async (fileItem: FileUploadItem): Promise<boolean> => {
    const { id, file, title, brand } = fileItem;

    try {
      // Step 1: Validate PDF
      updateFileItem(id, { status: 'validating', progress: 5, message: 'Validazione...' });

      const hasText = await hasSelectorableText(file);
      if (!hasText) {
        updateFileItem(id, {
          status: 'error',
          progress: 0,
          message: 'PDF scannerizzato (solo immagini)',
          error: 'Non supportato'
        });
        return false;
      }

      const pageCount = await getPDFPageCount(file);

      // Step 2: Create certificate record
      updateFileItem(id, { status: 'extracting', progress: 10, message: 'Creazione record...' });

      const certificate = await createCertificate(
        title || file.name,
        brand,
        file.name,
        file,
        userId
      );

      await updateCertificateStatus(certificate.id, 'processing');

      // Step 3: Extract text from PDF
      updateFileItem(id, { status: 'extracting', progress: 15, message: 'Estrazione testo...' });

      const pdfResult = await extractTextFromPDF(file, (progress) => {
        const pct = 15 + (progress.percentage * 0.25);
        updateFileItem(id, {
          progress: pct,
          message: `Pagina ${progress.currentPage}/${progress.totalPages}`
        });
      });

      // Step 4: Detect structure and extract metadata
      updateFileItem(id, { status: 'chunking', progress: 42, message: 'Analisi struttura...' });

      const structureResult = detectStructure(pdfResult.pages, brand);
      const fullText = pdfResult.pages.map(p => p.text).join('\n');
      const metadata = extractFireSealMetadata(fullText);

      await updateCertificateMetadata(
        certificate.id,
        {
          reiValues: metadata.reiValues,
          supportTypes: metadata.supportTypes,
          crossingTypes: metadata.crossingTypes,
          products: metadata.products,
          certificationNumber: metadata.certificationNumber
        },
        pageCount,
        structureResult.structureType
      );

      // Step 5: Chunk document
      updateFileItem(id, { status: 'chunking', progress: 45, message: 'Suddivisione chunks...' });

      const chunks = chunkDocument(pdfResult.pages, {
        strategy: structureResult.chunkingStrategy
      });

      const chunkStats = getChunkStats(chunks);
      console.log(`[${file.name}] Chunk stats:`, chunkStats);

      // Step 6: Save chunks to database
      updateFileItem(id, { status: 'chunking', progress: 50, message: `Salvataggio ${chunks.length} chunks...` });

      const savedChunks = await createChunksBatch(
        chunks.map(chunk => ({
          certificateId: certificate.id,
          pageNumber: chunk.pageNumber,
          chunkIndex: chunk.chunkIndex,
          content: chunk.content,
          metadata: chunk.metadata
        }))
      );

      // Step 7: Generate embeddings (if OpenAI configured)
      if (isOpenAIConfigured()) {
        updateFileItem(id, { status: 'embedding', progress: 55, message: 'Generazione embeddings...' });

        const texts = savedChunks.map(c => c.content);
        const costEstimate = estimateEmbeddingCost(texts);
        console.log(`[${file.name}] Estimated cost: $${costEstimate.estimatedCostUSD}`);

        const { embeddings } = await generateEmbeddingsBatch(texts, (processed, total) => {
          const pct = 55 + (processed / total) * 30;
          updateFileItem(id, {
            progress: pct,
            message: `Embedding ${processed}/${total}`
          });
        });

        // Update chunks with embeddings
        updateFileItem(id, { status: 'embedding', progress: 87, message: 'Salvataggio embeddings...' });

        const embeddingUpdates = savedChunks.map((chunk, i) => ({
          id: chunk.id,
          embedding: embeddings[i]
        }));

        await updateChunkEmbeddingsBatch(embeddingUpdates);
      }

      // Step 8: Mark as completed
      await updateCertificateStatus(certificate.id, 'completed');

      // Step 9: Sync to Supabase
      updateFileItem(id, { status: 'syncing', progress: 90, message: 'Sincronizzazione...' });

      try {
        await uploadCertificate(certificate);
        await uploadCertificateChunks(certificate.id);
      } catch (syncError) {
        console.warn(`[${file.name}] Sync failed:`, syncError);
      }

      // Complete!
      updateFileItem(id, {
        status: 'complete',
        progress: 100,
        message: 'Completato',
        chunksCount: savedChunks.length
      });

      return true;

    } catch (error) {
      console.error(`[${file.name}] Upload error:`, error);
      updateFileItem(id, {
        status: 'error',
        progress: 0,
        message: error instanceof Error ? error.message : 'Errore',
        error: 'Upload fallito'
      });
      return false;
    }
  };

  const processAllFiles = async () => {
    const pendingFiles = files.filter(f => f.status === 'pending' && f.brand);

    if (pendingFiles.length === 0) return;

    setIsProcessing(true);

    let successCount = 0;
    let errorCount = 0;

    // Process files sequentially to avoid overwhelming the embedding API
    for (const fileItem of pendingFiles) {
      const success = await processSingleFile(fileItem);
      if (success) {
        successCount++;
      } else {
        errorCount++;
      }
    }

    setIsProcessing(false);

    console.log(`Batch upload complete: ${successCount} success, ${errorCount} errors`);

    if (successCount > 0) {
      onUploadComplete?.();
    }
  };

  const clearCompleted = () => {
    setFiles(prev => prev.filter(f => f.status !== 'complete'));
  };

  const clearAll = () => {
    if (!isProcessing) {
      setFiles([]);
    }
  };

  const pendingCount = files.filter(f => f.status === 'pending').length;
  const completedCount = files.filter(f => f.status === 'complete').length;
  const errorCount = files.filter(f => f.status === 'error').length;
  const readyToProcess = files.filter(f => f.status === 'pending' && f.brand).length;

  return (
    <div className="certificate-upload batch-mode">
      {/* Drop Zone */}
      <div
        className={`upload-dropzone ${isDragOver ? 'drag-over' : ''} ${files.length > 0 ? 'has-files' : ''}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => !isProcessing && fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf"
          multiple
          onChange={(e) => e.target.files && handleFilesSelect(e.target.files)}
          style={{ display: 'none' }}
          disabled={isProcessing}
        />

        <div className="dropzone-content">
          <Files size={48} />
          <p>Trascina qui i PDF o clicca per selezionare</p>
          <span className="hint">Puoi selezionare più file insieme (max 50MB ciascuno)</span>
        </div>
      </div>

      {/* Default Brand Selector */}
      {files.length > 0 && (
        <div className="batch-controls">
          <div className="default-brand-control">
            <label>Marca predefinita:</label>
            <select
              value={defaultBrand}
              onChange={(e) => setDefaultBrand(e.target.value)}
              disabled={isProcessing}
            >
              <option value="">Seleziona...</option>
              {BRANDS.map(brand => (
                <option key={brand} value={brand}>{brand}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={applyDefaultBrandToAll}
              disabled={!defaultBrand || isProcessing}
              className="apply-brand-btn"
            >
              Applica a tutti
            </button>
          </div>

          <div className="batch-stats">
            <span>{files.length} file totali</span>
            {completedCount > 0 && <span className="stat-complete">{completedCount} completati</span>}
            {errorCount > 0 && <span className="stat-error">{errorCount} errori</span>}
          </div>
        </div>
      )}

      {/* Files List */}
      {files.length > 0 && (
        <div className="files-list">
          {files.map(fileItem => (
            <div key={fileItem.id} className={`file-item status-${fileItem.status}`}>
              <div className="file-item-header">
                <FileText size={20} />
                <div className="file-info">
                  <input
                    type="text"
                    value={fileItem.title}
                    onChange={(e) => updateFileTitle(fileItem.id, e.target.value)}
                    disabled={fileItem.status !== 'pending' || isProcessing}
                    className="file-title-input"
                    placeholder="Titolo"
                  />
                  <span className="file-size">
                    {(fileItem.file.size / (1024 * 1024)).toFixed(1)} MB
                  </span>
                </div>
                <select
                  value={fileItem.brand}
                  onChange={(e) => updateFileBrand(fileItem.id, e.target.value)}
                  disabled={fileItem.status !== 'pending' || isProcessing}
                  className="file-brand-select"
                >
                  <option value="">Marca...</option>
                  {BRANDS.map(brand => (
                    <option key={brand} value={brand}>{brand}</option>
                  ))}
                </select>
                {fileItem.status === 'pending' && !isProcessing && (
                  <button
                    type="button"
                    onClick={() => removeFile(fileItem.id)}
                    className="remove-file-btn"
                    title="Rimuovi"
                  >
                    <X size={18} />
                  </button>
                )}
                {fileItem.status === 'complete' && (
                  <span className="status-icon complete">
                    <Check size={18} />
                  </span>
                )}
                {fileItem.status === 'error' && (
                  <span className="status-icon error">
                    <AlertCircle size={18} />
                  </span>
                )}
                {!['pending', 'complete', 'error'].includes(fileItem.status) && (
                  <span className="status-icon processing">
                    <Loader2 size={18} className="spinner" />
                  </span>
                )}
              </div>

              {/* Progress bar for processing files */}
              {!['pending', 'complete', 'error'].includes(fileItem.status) && (
                <div className="file-progress">
                  <div className="progress-bar">
                    <div
                      className="progress-fill"
                      style={{ width: `${fileItem.progress}%` }}
                    />
                  </div>
                  <span className="progress-message">{fileItem.message}</span>
                </div>
              )}

              {/* Status message for completed/error */}
              {fileItem.status === 'complete' && (
                <div className="file-status-message success">
                  {fileItem.chunksCount} chunks creati
                </div>
              )}
              {fileItem.status === 'error' && (
                <div className="file-status-message error">
                  {fileItem.message}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Action Buttons */}
      {files.length > 0 && (
        <div className="batch-actions">
          <button
            className="upload-button primary"
            onClick={processAllFiles}
            disabled={readyToProcess === 0 || isProcessing}
          >
            {isProcessing ? (
              <>
                <Loader2 size={18} className="spinner" />
                Elaborazione in corso...
              </>
            ) : (
              <>
                <Upload size={18} />
                Carica {readyToProcess} {readyToProcess === 1 ? 'certificato' : 'certificati'}
              </>
            )}
          </button>

          {completedCount > 0 && !isProcessing && (
            <button
              type="button"
              onClick={clearCompleted}
              className="secondary-btn"
            >
              Rimuovi completati
            </button>
          )}

          {!isProcessing && (
            <button
              type="button"
              onClick={clearAll}
              className="secondary-btn danger"
            >
              Rimuovi tutti
            </button>
          )}
        </div>
      )}

      {/* Empty state message */}
      {files.length === 0 && (
        <div className="empty-hint">
          <p>Seleziona uno o più certificati PDF da caricare</p>
        </div>
      )}
    </div>
  );
}
