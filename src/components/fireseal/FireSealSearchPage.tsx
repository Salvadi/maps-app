import React, { useState, useCallback } from 'react';
import { Settings } from 'lucide-react';
import NavigationBar from '../NavigationBar';
import { ChatInterface } from './ChatInterface';
import { FilterPanel } from './FilterPanel';
import { ResultsPanel } from './ResultsPanel';
import { PDFViewerModal } from './PDFViewerModal';
import { executeRAG, RAGResponse, checkRAGAvailability } from '../../lib/fireseal/ragPipeline';
import { SearchFilters } from '../../lib/fireseal/vectorSearch';
import { getCertificate } from '../../db/certificates';
import { getCertificatePDFUrl, syncCertificates } from '../../sync/certificateSyncEngine';
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
  const [isSyncing, setIsSyncing] = useState(false);

  // PDF Viewer state
  const [pdfViewerOpen, setPdfViewerOpen] = useState(false);
  const [pdfSource, setPdfSource] = useState<Blob | string | null>(null);
  const [pdfTitle, setPdfTitle] = useState<string>('');
  const [pdfInitialPage, setPdfInitialPage] = useState(1);

  const handleSync = useCallback(async () => {
    setIsSyncing(true);
    try {
      await syncCertificates();
    } catch (err) {
      console.error('Sync error:', err);
    } finally {
      setIsSyncing(false);
    }
  }, []);

  const handleSearch = useCallback(async (searchQuery: string, overrideFilters?: SearchFilters) => {
    if (!searchQuery.trim()) return;

    setQuery(searchQuery);
    setIsSearching(true);
    setError(null);
    setResponse(null);

    // Use override filters if provided (for filter changes), otherwise use current state
    const activeFilters = overrideFilters ?? filters;

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
        filters: activeFilters,
        options: {
          topK: 10,
          minSimilarity: 0.5,
          includeContext: false // Disabled for faster responses
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
    // Re-run search with new filters directly (avoid stale closure)
    if (query && response) {
      handleSearch(query, newFilters);
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
      <NavigationBar
        title="Ricerca Sigillatura"
        onBack={onBack}
        onSync={handleSync}
        isSyncing={isSyncing}
        rightButton={isAdmin && onAdminClick ? (
          <button className="admin-button" onClick={onAdminClick}>
            <Settings size={16} />
            Admin
          </button>
        ) : undefined}
      />

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
