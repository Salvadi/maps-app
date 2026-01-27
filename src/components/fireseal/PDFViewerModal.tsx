import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

interface PDFViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  pdfSource: Blob | string | null;
  initialPage?: number;
  title?: string;
}

export function PDFViewerModal({
  isOpen,
  onClose,
  pdfSource,
  initialPage = 1,
  title
}: PDFViewerModalProps) {
  const [pdf, setPdf] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1.0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Load PDF document
  useEffect(() => {
    if (!isOpen || !pdfSource) return;

    const loadPDF = async () => {
      setLoading(true);
      setError(null);

      try {
        let data: ArrayBuffer;

        if (pdfSource instanceof Blob) {
          data = await pdfSource.arrayBuffer();
        } else {
          const response = await fetch(pdfSource);
          if (!response.ok) {
            throw new Error(`Failed to fetch PDF: ${response.status}`);
          }
          data = await response.arrayBuffer();
        }

        const loadingTask = pdfjsLib.getDocument({ data });
        const pdfDoc = await loadingTask.promise;

        setPdf(pdfDoc);
        setTotalPages(pdfDoc.numPages);
        setCurrentPage(Math.min(initialPage, pdfDoc.numPages));
      } catch (err) {
        console.error('Error loading PDF:', err);
        setError(err instanceof Error ? err.message : 'Failed to load PDF');
      } finally {
        setLoading(false);
      }
    };

    loadPDF();

    return () => {
      setPdf(null);
    };
  }, [isOpen, pdfSource, initialPage]);

  // Render current page
  useEffect(() => {
    if (!pdf || !canvasRef.current) return;

    const renderPage = async () => {
      try {
        const page = await pdf.getPage(currentPage);
        const viewport = page.getViewport({ scale });

        const canvas = canvasRef.current!;
        const context = canvas.getContext('2d')!;

        canvas.width = viewport.width;
        canvas.height = viewport.height;

        await page.render({
          canvasContext: context,
          viewport,
          canvas
        }).promise;
      } catch (err) {
        console.error('Error rendering page:', err);
      }
    };

    renderPage();
  }, [pdf, currentPage, scale]);

  const handlePrevPage = useCallback(() => {
    if (currentPage > 1) setCurrentPage(currentPage - 1);
  }, [currentPage]);

  const handleNextPage = useCallback(() => {
    if (currentPage < totalPages) setCurrentPage(currentPage + 1);
  }, [currentPage, totalPages]);

  const handleZoomIn = useCallback(() => {
    setScale(Math.min(scale + 0.25, 3.0));
  }, [scale]);

  const handleZoomOut = useCallback(() => {
    setScale(Math.max(scale - 0.25, 0.5));
  }, [scale]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!isOpen) return;

    switch (e.key) {
      case 'Escape':
        onClose();
        break;
      case 'ArrowLeft':
        handlePrevPage();
        break;
      case 'ArrowRight':
        handleNextPage();
        break;
    }
  }, [isOpen, onClose, handlePrevPage, handleNextPage]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (!isOpen) return null;

  return (
    <div className="pdf-viewer-modal-overlay" onClick={onClose}>
      <div className="pdf-viewer-modal" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="pdf-viewer-header">
          <div className="pdf-viewer-title">{title || 'PDF Viewer'}</div>
          <button className="pdf-viewer-close-btn" onClick={onClose}>
            <X size={24} />
          </button>
        </div>

        {/* Controls */}
        <div className="pdf-viewer-controls">
          <div className="pdf-page-controls">
            <button onClick={handlePrevPage} disabled={currentPage <= 1}>
              <ChevronLeft size={20} />
            </button>
            <span>Pagina {currentPage} di {totalPages}</span>
            <button onClick={handleNextPage} disabled={currentPage >= totalPages}>
              <ChevronRight size={20} />
            </button>
          </div>
          <div className="pdf-zoom-controls">
            <button onClick={handleZoomOut} disabled={scale <= 0.5}>
              <ZoomOut size={20} />
            </button>
            <span>{Math.round(scale * 100)}%</span>
            <button onClick={handleZoomIn} disabled={scale >= 3.0}>
              <ZoomIn size={20} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="pdf-viewer-content">
          {loading && <div className="pdf-viewer-loading">Caricamento PDF...</div>}
          {error && <div className="pdf-viewer-error">{error}</div>}
          {!loading && !error && (
            <canvas ref={canvasRef} />
          )}
        </div>
      </div>
    </div>
  );
}
