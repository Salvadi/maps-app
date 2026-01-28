/**
 * RAG Pipeline
 *
 * Orchestrates the complete Retrieval-Augmented Generation flow:
 * 1. Process user query
 * 2. Generate query embedding
 * 3. Retrieve relevant chunks
 * 4. Generate response with LLM
 * 5. Return formatted answer with citations
 */

import {
  searchCertificates,
  SearchFilters,
  SearchResult,
  rerankResults,
  getChunkContext,
  isSearchAvailable
} from './vectorSearch';
import {
  generateAnswer,
  checkLLMAvailability,
  LLMResponse,
  RetrievedChunk,
  Citation
} from './openrouterLLM';
import { isOpenAIConfigured, estimateTokenCount } from './openaiEmbedding';

export interface RAGQuery {
  query: string;
  filters?: SearchFilters;
  options?: RAGOptions;
}

export interface RAGOptions {
  topK?: number;
  minSimilarity?: number;
  includeContext?: boolean;
  contextWindowSize?: number;
  preferLocalSearch?: boolean;
}

export interface RAGResponse {
  answer: string;
  citations: Citation[];
  sources: SourceInfo[];
  searchResults: SearchResult[];
  metadata: RAGMetadata;
}

export interface SourceInfo {
  certificateId: string;
  certificateTitle: string;
  brand: string;
  pages: number[];
  relevanceScore: number;
}

export interface RAGMetadata {
  queryTokens: number;
  retrievedChunks: number;
  totalContextTokens: number;
  searchTimeMs: number;
  llmTimeMs: number;
  totalTimeMs: number;
  searchMode: 'local' | 'remote';
  llmModel: string;
}

const DEFAULT_OPTIONS: RAGOptions = {
  topK: 10,
  minSimilarity: 0.5,
  includeContext: false, // Disabled by default for faster responses
  contextWindowSize: 1,
  preferLocalSearch: false
};

// Cache for RAG availability check
let ragAvailabilityCache: {
  result: { available: boolean; reason?: string; details: any } | null;
  timestamp: number;
} = { result: null, timestamp: 0 };
const RAG_AVAILABILITY_CACHE_TTL = 10000; // 10 seconds

/**
 * Execute the complete RAG pipeline
 */
export async function executeRAG(ragQuery: RAGQuery): Promise<RAGResponse> {
  const startTime = performance.now();
  const options = { ...DEFAULT_OPTIONS, ...ragQuery.options };

  // Check availability
  const availability = await checkRAGAvailability();
  if (!availability.available) {
    throw new Error(availability.reason || 'RAG pipeline non disponibile');
  }

  // Step 1: Search for relevant chunks
  const searchStartTime = performance.now();

  const searchResults = await searchCertificates(ragQuery.query, {
    topK: options.topK,
    minSimilarity: options.minSimilarity,
    filters: ragQuery.filters,
    preferLocal: options.preferLocalSearch
  });

  // Re-rank results
  const rerankedResults = rerankResults(searchResults, ragQuery.query, ragQuery.filters || {});

  const searchTimeMs = performance.now() - searchStartTime;

  // Step 2: Expand context if requested
  let contextChunks = rerankedResults;
  if (options.includeContext && options.contextWindowSize && options.contextWindowSize > 0) {
    contextChunks = await expandContext(rerankedResults, options.contextWindowSize);
  }

  // Step 3: Convert to LLM format
  const retrievedChunks: RetrievedChunk[] = contextChunks.map(result => ({
    certificateId: result.certificateId,
    content: result.content,
    certificateTitle: result.certificateTitle,
    certificateBrand: result.certificateBrand,
    pageNumber: result.pageNumber,
    similarity: result.similarity,
    metadata: result.metadata
  }));

  // Step 4: Generate answer with LLM
  const llmStartTime = performance.now();

  let llmResponse: LLMResponse;
  try {
    llmResponse = await generateAnswer({
      query: ragQuery.query,
      retrievedChunks,
      filters: ragQuery.filters
    });
  } catch (error) {
    // If LLM fails, return search results without generated answer
    console.error('LLM generation failed:', error);
    llmResponse = {
      answer: 'Non è stato possibile generare una risposta. Consulta i risultati della ricerca qui sotto.',
      citations: extractCitationsFromResults(rerankedResults),
      model: 'none'
    };
  }

  const llmTimeMs = performance.now() - llmStartTime;
  const totalTimeMs = performance.now() - startTime;

  // Step 5: Compile sources
  const sources = compileSources(rerankedResults);

  // Step 6: Build metadata
  const metadata: RAGMetadata = {
    queryTokens: estimateTokenCount(ragQuery.query),
    retrievedChunks: retrievedChunks.length,
    totalContextTokens: retrievedChunks.reduce((sum, c) => sum + estimateTokenCount(c.content), 0),
    searchTimeMs: Math.round(searchTimeMs),
    llmTimeMs: Math.round(llmTimeMs),
    totalTimeMs: Math.round(totalTimeMs),
    searchMode: options.preferLocalSearch || !navigator.onLine ? 'local' : 'remote',
    llmModel: llmResponse.model
  };

  return {
    answer: llmResponse.answer,
    citations: llmResponse.citations,
    sources,
    searchResults: rerankedResults,
    metadata
  };
}

/**
 * Expand search results with adjacent chunks for more context
 * Uses parallel fetching for better performance
 */
async function expandContext(
  results: SearchResult[],
  windowSize: number
): Promise<SearchResult[]> {
  const expandedResults: SearchResult[] = [];
  const seenChunkIds = new Set<string>();

  // Fetch all context chunks in parallel
  const contextResults = await Promise.all(
    results.map(async (result) => ({
      result,
      contextChunks: await getChunkContext(result.chunkId, windowSize)
    }))
  );

  for (const { result, contextChunks } of contextResults) {
    for (const chunk of contextChunks) {
      if (!seenChunkIds.has(chunk.id)) {
        seenChunkIds.add(chunk.id);

        // Original result or context chunk
        if (chunk.id === result.chunkId) {
          expandedResults.push(result);
        } else {
          // Context chunk - lower similarity since it's not directly matched
          expandedResults.push({
            chunkId: chunk.id,
            certificateId: chunk.certificateId,
            certificateTitle: result.certificateTitle,
            certificateBrand: result.certificateBrand,
            pageNumber: chunk.pageNumber,
            chunkIndex: chunk.chunkIndex,
            content: chunk.content,
            similarity: result.similarity * 0.8, // Reduce similarity for context
            metadata: chunk.metadata
          });
        }
      }
    }
  }

  // Sort by certificate and page
  return expandedResults.sort((a, b) => {
    if (a.certificateId !== b.certificateId) {
      return b.similarity - a.similarity; // Higher similarity certificates first
    }
    return a.pageNumber - b.pageNumber; // Pages in order within certificate
  });
}

/**
 * Compile source information from search results
 */
function compileSources(results: SearchResult[]): SourceInfo[] {
  const sourceMap = new Map<string, SourceInfo>();

  for (const result of results) {
    const existing = sourceMap.get(result.certificateId);

    if (existing) {
      if (!existing.pages.includes(result.pageNumber)) {
        existing.pages.push(result.pageNumber);
      }
      existing.relevanceScore = Math.max(existing.relevanceScore, result.similarity);
    } else {
      sourceMap.set(result.certificateId, {
        certificateId: result.certificateId,
        certificateTitle: result.certificateTitle,
        brand: result.certificateBrand,
        pages: [result.pageNumber],
        relevanceScore: result.similarity
      });
    }
  }

  // Sort by relevance and format pages
  return Array.from(sourceMap.values())
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .map(source => ({
      ...source,
      pages: source.pages.sort((a, b) => a - b)
    }));
}

/**
 * Extract basic citations from search results (fallback when LLM fails)
 */
function extractCitationsFromResults(results: SearchResult[]): Citation[] {
  const citations: Citation[] = [];
  const seen = new Set<string>();

  for (const result of results.slice(0, 5)) {
    const key = `${result.certificateId}-${result.pageNumber}`;
    if (!seen.has(key)) {
      seen.add(key);
      citations.push({
        certificateId: result.certificateId,
        certificateTitle: result.certificateTitle,
        brand: result.certificateBrand,
        pageNumber: result.pageNumber,
        excerpt: result.content.substring(0, 200) + (result.content.length > 200 ? '...' : '')
      });
    }
  }

  return citations;
}

/**
 * Check if RAG pipeline is available (with caching)
 */
export async function checkRAGAvailability(): Promise<{
  available: boolean;
  reason?: string;
  details: {
    embeddingConfigured: boolean;
    llmAvailable: boolean;
    searchAvailable: boolean;
    online: boolean;
  };
}> {
  // Return cached result if still valid
  if (ragAvailabilityCache.result &&
      Date.now() - ragAvailabilityCache.timestamp < RAG_AVAILABILITY_CACHE_TTL) {
    return ragAvailabilityCache.result;
  }

  const embeddingConfigured = isOpenAIConfigured();
  const llmStatus = await checkLLMAvailability();
  const searchStatus = await isSearchAvailable();

  const details = {
    embeddingConfigured,
    llmAvailable: llmStatus.available,
    searchAvailable: searchStatus.available,
    online: navigator.onLine
  };

  let result: { available: boolean; reason?: string; details: typeof details };

  // Must have embedding for search
  if (!embeddingConfigured) {
    result = {
      available: false,
      reason: 'OpenRouter API non configurata. Aggiungi REACT_APP_OPENROUTER_API_KEY.',
      details
    };
  }
  // Must have search capability
  else if (!searchStatus.available) {
    result = {
      available: false,
      reason: searchStatus.reason || 'Ricerca non disponibile.',
      details
    };
  }
  // LLM is optional - can still do search-only
  else if (!llmStatus.available) {
    result = {
      available: true, // Partial availability
      reason: 'LLM non disponibile - solo ricerca senza generazione risposta.',
      details
    };
  } else {
    result = { available: true, details };
  }

  // Cache the result
  ragAvailabilityCache = { result, timestamp: Date.now() };
  return result;
}

/**
 * Quick search without LLM (faster, works offline if embeddings cached)
 */
export async function quickSearch(
  query: string,
  filters?: SearchFilters,
  topK: number = 5
): Promise<SearchResult[]> {
  const results = await searchCertificates(query, {
    topK,
    minSimilarity: 0.4,
    filters,
    preferLocal: true
  });

  return rerankResults(results, query, filters || {});
}

/**
 * Get suggested queries based on available certificates
 */
export async function getSuggestedQueries(): Promise<string[]> {
  return [
    'Come sigillo un attraversamento cavi su parete REI 120?',
    'Quale prodotto usare per tubi in rame su solaio?',
    'Sigillatura giunti di dilatazione REI 60',
    'Passaggio canaline elettriche attraverso muro',
    'Collare intumescente per tubi plastica'
  ];
}
