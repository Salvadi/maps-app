import React, { useState, useCallback } from 'react';
import { ArrowLeft, Settings } from 'lucide-react';
import { ChatInterface } from './ChatInterface';
import { FilterPanel } from './FilterPanel';
import { ResultsPanel } from './ResultsPanel';
import { executeRAG, RAGResponse, checkRAGAvailability } from '../../lib/fireseal/ragPipeline';
import { SearchFilters } from '../../lib/fireseal/vectorSearch';
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

  const handleCitationClick = useCallback((certificateId: string, pageNumber: number) => {
    // TODO: Open PDF viewer at specific page
    console.log('Open certificate:', certificateId, 'page:', pageNumber);
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
    </div>
  );
}
