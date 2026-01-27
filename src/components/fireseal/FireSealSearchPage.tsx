import React, { useState, useCallback } from 'react';
import { ArrowLeft, Settings } from 'lucide-react';
import { ChatInterface } from './ChatInterface';
import { FilterPanel } from './FilterPanel';
import { ResultsPanel } from './ResultsPanel';
import { PDFViewerModal } from './PDFViewerModal';
import { executeRAG, RAGResponse, checkRAGAvailability } from '../../lib/fireseal/ragPipeline';
import { SearchFilters } from '../../lib/fireseal/vectorSearch';
import { getCertificate } from '../../db/certificates';
import { getCertificatePDFUrl } from '../../sync/certificateSyncEngine';
import './FireSealStyles.css';

interface FireSealSearchPageProps {
  onBack: () => void;
  onAdminClick?: () => void;
  isAdmin?: boolean;
}

export function FireSealSearchPage({ onBack, onAdminClick, isAdmin }: FireSealSearchPageProps) {
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<SearchFilters>({});
  const [response, setResponse] = useState<RAGResponse | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // PDF Viewer state
  const [pdfViewerOpen, setPdfViewerOpen] = useState(false);
  const [pdfSource, setPdfSource] = useState<Blob | string | null>(null);
  const [pdfTitle, setPdfTitle] = useState<string>('');
  const [pdfInitialPage, setPdfInitialPage] = useState(1);

  const handleSearch = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim()) return;

    setQuery(searchQuery);
    setIsSearching(true);
    setError(null);
    setResponse(null);

    try {
      // Check availability first
      const availability = await checkRAGAvailability();
      if (!availability.available) {
        setError(availability.reason || 'Ricerca non disponibile');
        setIsSearching(false);
        return;
      }

      // Execute RAG pipeline
      const result = await executeRAG({
        query: searchQuery,
        filters,
        options: {
          topK: 10,
          minSimilarity: 0.5,
          includeContext: true
        }
      });

      setResponse(result);
    } catch (err) {
      console.error('Search error:', err);
      setError(err instanceof Error ? err.message : 'Errore durante la ricerca');
    } finally {
      setIsSearching(false);
    }
  }, [filters]);

  const handleFilterChange = useCallback((newFilters: SearchFilters) => {
    setFilters(newFilters);
    // Re-run search if we have a query
    if (query && response) {
      handleSearch(query);
    }
  }, [query, response, handleSearch]);

  const handleCitationClick = useCallback(async (certificateId: string, pageNumber: number) => {
    try {
      const certificate = await getCertificate(certificateId);
      if (!certificate) {
        console.error('Certificate not found:', certificateId);
        return;
      }

      setPdfTitle(certificate.title);
      setPdfInitialPage(pageNumber);

      // Prefer local blob, fallback to signed URL
      if (certificate.fileBlob) {
        setPdfSource(certificate.fileBlob);
      } else if (certificate.fileName) {
        const signedUrl = await getCertificatePDFUrl(certificate.id, certificate.fileName);
        setPdfSource(signedUrl);
      } else {
        console.error('No PDF source available for certificate:', certificateId);
        return;
      }

      setPdfViewerOpen(true);
    } catch (err) {
      console.error('Error opening certificate PDF:', err);
    }
  }, []);

  const handleClosePdfViewer = useCallback(() => {
    setPdfViewerOpen(false);
    setPdfSource(null);
    setPdfTitle('');
  }, []);

  return (
    <div className="fireseal-search-page">
      {/* Header */}
      <header className="fireseal-header">
        <button className="back-button" onClick={onBack}>
          <ArrowLeft size={24} />
        </button>
        <h1>Ricerca Sigillatura</h1>
        {isAdmin && onAdminClick && (
          <button className="admin-button" onClick={onAdminClick}>
            <Settings size={16} />
            Admin
          </button>
        )}
      </header>

      {/* Main Content */}
      <div className="fireseal-content">
        {/* Search Input */}
        <ChatInterface
          onSearch={handleSearch}
          isSearching={isSearching}
          initialQuery={query}
        />

        {/* Filters */}
        <FilterPanel
          filters={filters}
          onChange={handleFilterChange}
        />

        {/* Results */}
        <ResultsPanel
          response={response}
          isLoading={isSearching}
          error={error}
          onCitationClick={handleCitationClick}
        />
      </div>

      {/* PDF Viewer Modal */}
      <PDFViewerModal
        isOpen={pdfViewerOpen}
        onClose={handleClosePdfViewer}
        pdfSource={pdfSource}
        initialPage={pdfInitialPage}
        title={pdfTitle}
      />
    </div>
  );
}
