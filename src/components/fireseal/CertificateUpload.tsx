import React, { useState, useRef, useCallback } from 'react';
import { Upload, FileText, AlertCircle, Check, Loader2 } from 'lucide-react';
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

type UploadStep = 'idle' | 'validating' | 'extracting' | 'chunking' | 'embedding' | 'syncing' | 'complete' | 'error';

interface UploadState {
  step: UploadStep;
  progress: number;
  message: string;
  error?: string;
}

const BRANDS = ['Promat', 'AF Systems', 'Hilti', 'Global Building', 'Altro'];

export function CertificateUpload({ userId, onUploadComplete }: CertificateUploadProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedBrand, setSelectedBrand] = useState<string>('');
  const [customTitle, setCustomTitle] = useState<string>('');
  const [uploadState, setUploadState] = useState<UploadState>({
    step: 'idle',
    progress: 0,
    message: ''
  });
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = useCallback((file: File) => {
    if (file.type !== 'application/pdf') {
      setUploadState({
        step: 'error',
        progress: 0,
        message: 'Solo file PDF sono accettati',
        error: 'Formato file non valido'
      });
      return;
    }

    if (file.size > 50 * 1024 * 1024) { // 50MB limit
      setUploadState({
        step: 'error',
        progress: 0,
        message: 'Il file supera il limite di 50MB',
        error: 'File troppo grande'
      });
      return;
    }

    setSelectedFile(file);
    setCustomTitle(file.name.replace('.pdf', ''));
    setUploadState({ step: 'idle', progress: 0, message: '' });
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    const file = e.dataTransfer.files[0];
    if (file) {
      handleFileSelect(file);
    }
  }, [handleFileSelect]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const processUpload = async () => {
    if (!selectedFile || !selectedBrand) return;

    try {
      // Step 1: Validate PDF
      setUploadState({ step: 'validating', progress: 5, message: 'Validazione PDF...' });

      const hasText = await hasSelectorableText(selectedFile);
      if (!hasText) {
        setUploadState({
          step: 'error',
          progress: 0,
          message: 'Il PDF sembra essere scannerizzato (immagini). Sono supportati solo PDF con testo selezionabile.',
          error: 'PDF non supportato'
        });
        return;
      }

      const pageCount = await getPDFPageCount(selectedFile);

      // Step 2: Create certificate record
      setUploadState({ step: 'extracting', progress: 10, message: 'Creazione record...' });

      const certificate = await createCertificate(
        customTitle || selectedFile.name,
        selectedBrand,
        selectedFile.name,
        selectedFile,
        userId
      );

      await updateCertificateStatus(certificate.id, 'processing');

      // Step 3: Extract text from PDF
      setUploadState({ step: 'extracting', progress: 15, message: 'Estrazione testo...' });

      const pdfResult = await extractTextFromPDF(selectedFile, (progress) => {
        const pct = 15 + (progress.percentage * 0.25); // 15-40%
        setUploadState({
          step: 'extracting',
          progress: pct,
          message: `Estrazione pagina ${progress.currentPage}/${progress.totalPages}...`
        });
      });

      // Step 4: Detect structure and extract metadata
      setUploadState({ step: 'chunking', progress: 42, message: 'Analisi struttura...' });

      const structureResult = detectStructure(pdfResult.pages, selectedBrand);
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
      setUploadState({ step: 'chunking', progress: 45, message: 'Suddivisione in chunks...' });

      const chunks = chunkDocument(pdfResult.pages, {
        strategy: structureResult.chunkingStrategy
      });

      const chunkStats = getChunkStats(chunks);
      console.log('Chunk stats:', chunkStats);

      // Step 6: Save chunks to database
      setUploadState({ step: 'chunking', progress: 50, message: `Salvataggio ${chunks.length} chunks...` });

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
        setUploadState({ step: 'embedding', progress: 55, message: 'Generazione embeddings...' });

        const texts = savedChunks.map(c => c.content);
        const costEstimate = estimateEmbeddingCost(texts);
        console.log(`Estimated embedding cost: $${costEstimate.estimatedCostUSD} for ${costEstimate.estimatedTokens} tokens`);

        const { embeddings } = await generateEmbeddingsBatch(texts, (processed, total) => {
          const pct = 55 + (processed / total) * 30; // 55-85%
          setUploadState({
            step: 'embedding',
            progress: pct,
            message: `Embedding ${processed}/${total} chunks...`
          });
        });

        // Update chunks with embeddings
        setUploadState({ step: 'embedding', progress: 87, message: 'Salvataggio embeddings...' });

        const embeddingUpdates = savedChunks.map((chunk, i) => ({
          id: chunk.id,
          embedding: embeddings[i]
        }));

        await updateChunkEmbeddingsBatch(embeddingUpdates);
      } else {
        console.warn('OpenAI not configured, skipping embedding generation');
      }

      // Step 8: Mark as completed
      await updateCertificateStatus(certificate.id, 'completed');

      // Step 9: Sync to Supabase (if configured)
      setUploadState({ step: 'syncing', progress: 90, message: 'Sincronizzazione...' });

      try {
        await uploadCertificate(certificate);
        await uploadCertificateChunks(certificate.id);
      } catch (syncError) {
        console.warn('Sync failed, will retry later:', syncError);
      }

      // Complete!
      setUploadState({
        step: 'complete',
        progress: 100,
        message: `Certificato "${customTitle}" caricato con successo! ${savedChunks.length} chunks creati.`
      });

      // Reset form after delay
      setTimeout(() => {
        setSelectedFile(null);
        setSelectedBrand('');
        setCustomTitle('');
        setUploadState({ step: 'idle', progress: 0, message: '' });
        onUploadComplete?.();
      }, 3000);

    } catch (error) {
      console.error('Upload error:', error);
      setUploadState({
        step: 'error',
        progress: 0,
        message: error instanceof Error ? error.message : 'Errore durante il caricamento',
        error: 'Upload fallito'
      });
    }
  };

  const isProcessing = ['validating', 'extracting', 'chunking', 'embedding', 'syncing'].includes(uploadState.step);
  const canUpload = selectedFile && selectedBrand && !isProcessing;

  return (
    <div className="certificate-upload">
      {/* Drop Zone */}
      <div
        className={`upload-dropzone ${isDragOver ? 'drag-over' : ''} ${selectedFile ? 'has-file' : ''}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => !isProcessing && fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf"
          onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
          style={{ display: 'none' }}
          disabled={isProcessing}
        />

        {selectedFile ? (
          <div className="selected-file">
            <FileText size={32} />
            <span className="file-name">{selectedFile.name}</span>
            <span className="file-size">({(selectedFile.size / (1024 * 1024)).toFixed(2)} MB)</span>
          </div>
        ) : (
          <div className="dropzone-content">
            <Upload size={48} />
            <p>Trascina qui un PDF o clicca per selezionare</p>
            <span className="hint">Max 50MB - Solo PDF con testo selezionabile</span>
          </div>
        )}
      </div>

      {/* Form Fields */}
      {selectedFile && (
        <div className="upload-form">
          <div className="form-group">
            <label>Marca</label>
            <select
              value={selectedBrand}
              onChange={(e) => setSelectedBrand(e.target.value)}
              disabled={isProcessing}
            >
              <option value="">Seleziona marca...</option>
              {BRANDS.map(brand => (
                <option key={brand} value={brand}>{brand}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Titolo</label>
            <input
              type="text"
              value={customTitle}
              onChange={(e) => setCustomTitle(e.target.value)}
              placeholder="Nome certificato"
              disabled={isProcessing}
            />
          </div>

          <button
            className="upload-button"
            onClick={processUpload}
            disabled={!canUpload}
          >
            {isProcessing ? (
              <>
                <Loader2 size={18} className="spinner" />
                Elaborazione...
              </>
            ) : (
              <>
                <Upload size={18} />
                Carica e Processa
              </>
            )}
          </button>
        </div>
      )}

      {/* Progress */}
      {isProcessing && (
        <div className="upload-progress">
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: `${uploadState.progress}%` }}
            />
          </div>
          <p className="progress-message">{uploadState.message}</p>
        </div>
      )}

      {/* Success */}
      {uploadState.step === 'complete' && (
        <div className="upload-success">
          <Check size={24} />
          <p>{uploadState.message}</p>
        </div>
      )}

      {/* Error */}
      {uploadState.step === 'error' && (
        <div className="upload-error">
          <AlertCircle size={24} />
          <p>{uploadState.message}</p>
          <button onClick={() => setUploadState({ step: 'idle', progress: 0, message: '' })}>
            Riprova
          </button>
        </div>
      )}
    </div>
  );
}
