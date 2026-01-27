import React from 'react';
import { FileText, Loader2, AlertCircle, Search } from 'lucide-react';
import { RAGResponse } from '../../lib/fireseal/ragPipeline';
import { Citation } from '../../lib/fireseal/openrouterLLM';

interface ResultsPanelProps {
  response: RAGResponse | null;
  isLoading: boolean;
  error: string | null;
  onCitationClick?: (certificateId: string, pageNumber: number) => void;
}

export function ResultsPanel({ response, isLoading, error, onCitationClick }: ResultsPanelProps) {
  if (isLoading) {
    return (
      <div className="results-panel">
        <div className="results-loading">
          <Loader2 size={32} className="spinner" />
          <p>Ricerca in corso...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="results-panel">
        <div className="results-empty">
          <AlertCircle size={48} />
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (!response) {
    return (
      <div className="results-panel">
        <div className="results-empty">
          <Search size={48} />
          <p>Inserisci una domanda per cercare nei certificati</p>
        </div>
      </div>
    );
  }

  return (
    <div className="results-panel">
      {/* Answer Section */}
      <div className="answer-section">
        <h3>Risposta</h3>
        <div className="answer-content">
          {response.answer}
        </div>
      </div>

      {/* Citations Section */}
      {response.citations.length > 0 && (
        <div className="citations-section">
          <h3>Fonti ({response.citations.length})</h3>
          {response.citations.map((citation, index) => (
            <CitationItem
              key={index}
              citation={citation}
              onClick={onCitationClick}
            />
          ))}
        </div>
      )}

      {/* Metadata */}
      <div className="results-metadata">
        <span>Chunks analizzati: {response.metadata.retrievedChunks}</span>
        <span>Tempo: {response.metadata.totalTimeMs}ms</span>
        <span>Modalità: {response.metadata.searchMode}</span>
      </div>
    </div>
  );
}

interface CitationItemProps {
  citation: Citation;
  onClick?: (certificateId: string, pageNumber: number) => void;
}

function CitationItem({ citation, onClick }: CitationItemProps) {
  // Extract certificate ID from title if possible
  const handleClick = () => {
    if (onClick) {
      // Note: In a real implementation, we'd have the certificate ID in the citation
      onClick(citation.certificateTitle, citation.pageNumber);
    }
  };

  return (
    <div className="citation-item" onClick={handleClick}>
      <div className="citation-icon">
        <FileText size={20} />
      </div>
      <div className="citation-info">
        <div className="citation-title">{citation.certificateTitle}</div>
        <div className="citation-meta">
          {citation.brand} • Pagina {citation.pageNumber}
        </div>
        {citation.excerpt && (
          <div className="citation-excerpt">{citation.excerpt}</div>
        )}
      </div>
    </div>
  );
}
