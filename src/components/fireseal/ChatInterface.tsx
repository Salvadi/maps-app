import React, { useState, useCallback, useEffect } from 'react';
import { Search, Loader2 } from 'lucide-react';
import { getSuggestedQueries } from '../../lib/fireseal/ragPipeline';

interface ChatInterfaceProps {
  onSearch: (query: string) => void;
  isSearching: boolean;
  initialQuery?: string;
}

export function ChatInterface({ onSearch, isSearching, initialQuery = '' }: ChatInterfaceProps) {
  const [query, setQuery] = useState(initialQuery);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  useEffect(() => {
    getSuggestedQueries().then(setSuggestions);
  }, []);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim() && !isSearching) {
      onSearch(query.trim());
    }
  }, [query, isSearching, onSearch]);

  const handleSuggestionClick = useCallback((suggestion: string) => {
    setQuery(suggestion);
    onSearch(suggestion);
  }, [onSearch]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  }, [handleSubmit]);

  return (
    <div className="chat-interface">
      <form onSubmit={handleSubmit}>
        <div className="search-input-wrapper">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Descrivi la soluzione di sigillatura che cerchi..."
            disabled={isSearching}
            autoFocus
          />
          <button
            type="submit"
            className="search-button"
            disabled={!query.trim() || isSearching}
          >
            {isSearching ? (
              <Loader2 size={18} className="spinner" />
            ) : (
              <Search size={18} />
            )}
            Cerca
          </button>
        </div>
      </form>

      {/* Suggested queries - only show when no query */}
      {!query && (
        <div className="suggested-queries">
          {suggestions.slice(0, 4).map((suggestion, index) => (
            <button
              key={index}
              className="suggested-query"
              onClick={() => handleSuggestionClick(suggestion)}
              disabled={isSearching}
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
