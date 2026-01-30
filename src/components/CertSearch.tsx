import React, { useState, useCallback } from 'react';
import { User } from '../db';
import './CertSearch.css';

interface CertSearchProps {
  currentUser: User;
  onBack: () => void;
}

interface SearchResult {
  id: string;
  score: number;
  certName: string;
  section: string;
  content: string;
  hasTable: boolean;
  chunkIndex: number;
}

interface SearchResponse {
  query: string;
  answer: string;
  citations: Array<{
    index: number;
    certName: string;
    section: string;
    content?: string;
  }>;
  results: SearchResult[];
}

const CertSearch: React.FC<CertSearchProps> = ({ currentUser, onBack }) => {
  const [query, setQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [filterCertName, setFilterCertName] = useState('');
  const [filterTablesOnly, setFilterTablesOnly] = useState(false);
  const [expandedResults, setExpandedResults] = useState<Set<string>>(new Set());
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return;

    setIsSearching(true);
    setError(null);
    setResponse(null);

    try {
      const filters: any = {};
      if (filterCertName) filters.certName = filterCertName;
      if (filterTablesOnly) filters.hasTable = true;

      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: query.trim(),
          filters: Object.keys(filters).length > 0 ? filters : undefined,
          topK: 10,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: 'Errore di rete' }));
        throw new Error(errData.error || `Errore ${res.status}`);
      }

      const data: SearchResponse = await res.json();
      setResponse(data);
    } catch (err: any) {
      setError(err.message || 'Errore durante la ricerca');
    } finally {
      setIsSearching(false);
    }
  }, [query, filterCertName, filterTablesOnly]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSearch();
    }
  };

  const toggleResult = (id: string) => {
    setExpandedResults(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleGenerateReport = useCallback(async () => {
    if (!response) return;
    setIsGeneratingReport(true);

    try {
      const res = await fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: response.query,
          answer: response.answer,
          citations: response.citations,
          results: response.results,
        }),
      });

      if (!res.ok) throw new Error('Errore generazione report');

      const data = await res.json();

      // Open in new window for print/save
      const win = window.open('', '_blank');
      if (win) {
        win.document.write(data.html);
        win.document.close();
      }
    } catch (err: any) {
      setError(err.message || 'Errore generazione report');
    } finally {
      setIsGeneratingReport(false);
    }
  }, [response]);

  const getScoreColor = (score: number): string => {
    if (score >= 0.85) return 'var(--color-success, #22c55e)';
    if (score >= 0.7) return 'var(--color-warning, #f59e0b)';
    return 'var(--color-text-tertiary)';
  };

  return (
    <div className="cert-search-page">
      {/* Header */}
      <div className="cert-search-header">
        <button className="cert-back-btn" onClick={onBack}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="cert-search-title">Ricerca Certificazioni</h1>
      </div>

      <div className="cert-search-container">
        {/* Search Input */}
        <div className="cert-search-input-area">
          <div className="cert-search-bar">
            <svg className="cert-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              type="text"
              className="cert-search-input"
              placeholder='Es: "Soluzioni tubi PVC solaio EI120" oppure "Diametro massimo tubo metallico"'
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
            />
            <button
              className="cert-search-btn"
              onClick={handleSearch}
              disabled={isSearching || !query.trim()}
            >
              {isSearching ? (
                <div className="cert-spinner" />
              ) : (
                'Cerca'
              )}
            </button>
          </div>

          {/* Filter toggle */}
          <button
            className="cert-filter-toggle"
            onClick={() => setShowFilters(!showFilters)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
              <polygon points="22,3 2,3 10,12.46 10,19 14,21 14,12.46" />
            </svg>
            Filtri
          </button>

          {showFilters && (
            <div className="cert-filters">
              <div className="cert-filter-item">
                <label>Certificato:</label>
                <input
                  type="text"
                  placeholder="Nome certificato..."
                  value={filterCertName}
                  onChange={e => setFilterCertName(e.target.value)}
                />
              </div>
              <div className="cert-filter-item">
                <label>
                  <input
                    type="checkbox"
                    checked={filterTablesOnly}
                    onChange={e => setFilterTablesOnly(e.target.checked)}
                  />
                  Solo risultati con tabelle
                </label>
              </div>
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="cert-error">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
            {error}
          </div>
        )}

        {/* Loading */}
        {isSearching && (
          <div className="cert-loading">
            <div className="cert-spinner-large" />
            <p>Ricerca in corso...</p>
            <p className="cert-loading-sub">Analisi semantica e generazione risposta</p>
          </div>
        )}

        {/* AI Answer */}
        {response && (
          <div className="cert-results-area">
            <div className="cert-answer-card">
              <div className="cert-answer-header">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                  <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z" />
                  <path d="M12 16v-4M12 8h.01" />
                </svg>
                <span>Risposta AI</span>
              </div>
              <div className="cert-answer-text">
                {response.answer}
              </div>
              {response.citations.length > 0 && (
                <div className="cert-citations">
                  <strong>Fonti citate:</strong>
                  {response.citations.map(c => (
                    <span key={c.index} className="cert-citation-tag">
                      [{c.index}] {c.certName} — {c.section}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Report button */}
            <button
              className="cert-report-btn"
              onClick={handleGenerateReport}
              disabled={isGeneratingReport}
            >
              {isGeneratingReport ? (
                <><div className="cert-spinner" /> Generazione report...</>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                  </svg>
                  Genera Report Tecnico
                </>
              )}
            </button>

            {/* Results List */}
            <div className="cert-results-header">
              <h3>{response.results.length} risultati trovati</h3>
            </div>

            {response.results.map((result, idx) => (
              <div
                key={result.id}
                className={`cert-result-card ${expandedResults.has(result.id) ? 'expanded' : ''}`}
              >
                <div
                  className="cert-result-header"
                  onClick={() => toggleResult(result.id)}
                >
                  <div className="cert-result-meta">
                    <span className="cert-result-index">[{idx + 1}]</span>
                    <span className="cert-result-cert">{result.certName}</span>
                    {result.section && (
                      <span className="cert-result-section">{result.section}</span>
                    )}
                    {result.hasTable && (
                      <span className="cert-result-badge table-badge">Tabella</span>
                    )}
                  </div>
                  <div className="cert-result-score" style={{ color: getScoreColor(result.score) }}>
                    {(result.score * 100).toFixed(0)}%
                  </div>
                </div>

                {expandedResults.has(result.id) && (
                  <div className="cert-result-content">
                    <pre className="cert-result-text">{result.content}</pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!response && !isSearching && !error && (
          <div className="cert-empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="64" height="64" opacity="0.3">
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
            <h3>Cerca nelle certificazioni antincendio</h3>
            <p>Inserisci una domanda in linguaggio naturale per trovare soluzioni certificate</p>
            <div className="cert-examples">
              <p><strong>Esempi:</strong></p>
              <button onClick={() => setQuery('Soluzioni tubi combustibili solaio EI 120')}>
                Soluzioni tubi combustibili solaio EI 120
              </button>
              <button onClick={() => setQuery('Diametro massimo tubo metallico con AF Pipeguard')}>
                Diametro massimo tubo metallico con AF Pipeguard
              </button>
              <button onClick={() => setQuery('Attraversamento cavi elettrici parete REI 90')}>
                Attraversamento cavi elettrici parete REI 90
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CertSearch;
