/**
 * Vector Search Service
 *
 * Performs semantic search over certificate chunks using vector embeddings.
 * Supports both local search (IndexedDB) and remote search (Supabase pgvector).
 */

import { supabase, isSupabaseConfigured } from '../supabase';
import { generateEmbedding, isOpenAIConfigured } from './openaiEmbedding';
import {
  localVectorSearch,
  getChunksWithEmbeddings,
  getCompletedCertificates
} from '../../db/certificates';
import { CertificateChunk } from '../../db/database';

export interface SearchFilters {
  brand?: string;
  rei?: string;
  supporto?: string;
  attraversamento?: string;
}

export interface SearchResult {
  chunkId: string;
  certificateId: string;
  certificateTitle: string;
  certificateBrand: string;
  pageNumber: number;
  chunkIndex: number;
  content: string;
  similarity: number;
  metadata: Record<string, any>;
}

export interface VectorSearchOptions {
  topK?: number;
  minSimilarity?: number;
  filters?: SearchFilters;
  preferLocal?: boolean;
}

const DEFAULT_TOP_K = 10;
const DEFAULT_MIN_SIMILARITY = 0.5;

/**
 * Main search function - automatically chooses local or remote search
 */
export async function searchCertificates(
  query: string,
  options: VectorSearchOptions = {}
): Promise<SearchResult[]> {
  const {
    topK = DEFAULT_TOP_K,
    minSimilarity = DEFAULT_MIN_SIMILARITY,
    filters = {},
    preferLocal = false
  } = options;

  // Check if we can do embedding
  if (!isOpenAIConfigured()) {
    throw new Error(
      'OpenAI API non configurata. Impossibile generare embedding per la ricerca.'
    );
  }

  // Generate query embedding
  const { embedding: queryEmbedding } = await generateEmbedding(query);

  // Decide search strategy
  const useLocalSearch = preferLocal || !navigator.onLine || !isSupabaseConfigured();

  if (useLocalSearch) {
    return performLocalSearch(queryEmbedding, topK, minSimilarity, filters);
  } else {
    // Try remote first, fall back to local
    try {
      return await performRemoteSearch(queryEmbedding, topK, minSimilarity, filters);
    } catch (error) {
      console.warn('Remote search failed, falling back to local:', error);
      return performLocalSearch(queryEmbedding, topK, minSimilarity, filters);
    }
  }
}

/**
 * Perform local vector search using IndexedDB
 */
async function performLocalSearch(
  queryEmbedding: number[],
  topK: number,
  minSimilarity: number,
  filters: SearchFilters
): Promise<SearchResult[]> {
  console.log('🔍 Performing local vector search...');

  const results = await localVectorSearch(queryEmbedding, {
    topK,
    minSimilarity,
    filterBrand: filters.brand,
    filterRei: filters.rei,
    filterSupport: filters.supporto
  });

  return results.map(r => ({
    chunkId: r.id,
    certificateId: r.certificateId,
    certificateTitle: r.certificateTitle,
    certificateBrand: r.certificateBrand,
    pageNumber: r.pageNumber,
    chunkIndex: r.chunkIndex,
    content: r.content,
    similarity: r.similarity,
    metadata: r.metadata
  }));
}

/**
 * Perform remote vector search using Supabase pgvector
 */
async function performRemoteSearch(
  queryEmbedding: number[],
  topK: number,
  minSimilarity: number,
  filters: SearchFilters
): Promise<SearchResult[]> {
  console.log('🔍 Performing remote vector search via Supabase...');

  // Call the search_certificate_chunks function
  const { data, error } = await supabase.rpc('search_certificate_chunks', {
    query_embedding: `[${queryEmbedding.join(',')}]`,
    match_count: topK,
    filter_brand: filters.brand || null,
    filter_rei: filters.rei || null,
    filter_support: filters.supporto || null,
    filter_crossing: filters.attraversamento || null,
    min_similarity: minSimilarity
  });

  if (error) {
    throw new Error(`Supabase search error: ${error.message}`);
  }

  return (data || []).map((row: any) => ({
    chunkId: row.id,
    certificateId: row.certificate_id,
    certificateTitle: row.certificate_title,
    certificateBrand: row.certificate_brand,
    pageNumber: row.page_number,
    chunkIndex: row.chunk_index || 0,
    content: row.content,
    similarity: row.similarity,
    metadata: row.metadata || {}
  }));
}

/**
 * Get search statistics
 */
export async function getSearchStats(): Promise<{
  localChunksWithEmbeddings: number;
  localCertificates: number;
  canSearchLocally: boolean;
  canSearchRemotely: boolean;
}> {
  const chunksWithEmbeddings = await getChunksWithEmbeddings();
  const completedCertificates = await getCompletedCertificates();

  return {
    localChunksWithEmbeddings: chunksWithEmbeddings.length,
    localCertificates: completedCertificates.length,
    canSearchLocally: chunksWithEmbeddings.length > 0 && isOpenAIConfigured(),
    canSearchRemotely: navigator.onLine && isSupabaseConfigured() && isOpenAIConfigured()
  };
}

/**
 * Check if search is available
 */
export async function isSearchAvailable(): Promise<{
  available: boolean;
  reason?: string;
}> {
  if (!isOpenAIConfigured()) {
    return {
      available: false,
      reason: 'OpenAI API non configurata per generare embedding.'
    };
  }

  const stats = await getSearchStats();

  if (!stats.canSearchLocally && !stats.canSearchRemotely) {
    return {
      available: false,
      reason: 'Nessun certificato disponibile per la ricerca. Carica alcuni certificati.'
    };
  }

  return { available: true };
}

/**
 * Re-rank results based on additional criteria
 */
export function rerankResults(
  results: SearchResult[],
  query: string,
  filters: SearchFilters
): SearchResult[] {
  const queryLower = query.toLowerCase();

  return results
    .map(result => {
      let boost = 0;

      // Boost if content contains exact query terms
      const contentLower = result.content.toLowerCase();
      const queryTerms = queryLower.split(/\s+/).filter(t => t.length > 2);

      for (const term of queryTerms) {
        if (contentLower.includes(term)) {
          boost += 0.05;
        }
      }

      // Boost if metadata matches filters exactly
      if (filters.rei && result.metadata.reiContext === filters.rei) {
        boost += 0.1;
      }
      if (filters.supporto && result.metadata.supportContext === filters.supporto) {
        boost += 0.1;
      }

      // Boost if products are mentioned
      if (result.metadata.productContext && result.metadata.productContext.length > 0) {
        boost += 0.05;
      }

      return {
        ...result,
        similarity: Math.min(1, result.similarity + boost)
      };
    })
    .sort((a, b) => b.similarity - a.similarity);
}

/**
 * Group search results by certificate
 */
export function groupResultsByCertificate(
  results: SearchResult[]
): Map<string, SearchResult[]> {
  const grouped = new Map<string, SearchResult[]>();

  for (const result of results) {
    const existing = grouped.get(result.certificateId) || [];
    existing.push(result);
    grouped.set(result.certificateId, existing);
  }

  // Sort chunks within each certificate by page number
  Array.from(grouped.entries()).forEach(([certId, chunks]) => {
    chunks.sort((a, b) => a.pageNumber - b.pageNumber);
  });

  return grouped;
}

/**
 * Get context window around a chunk (adjacent chunks)
 */
export async function getChunkContext(
  chunkId: string,
  windowSize: number = 1
): Promise<CertificateChunk[]> {
  const { db } = await import('../../db/database');

  const chunk = await db.certificateChunks.get(chunkId);
  if (!chunk) return [];

  // Get adjacent chunks from the same certificate
  const allChunks = await db.certificateChunks
    .where('certificateId')
    .equals(chunk.certificateId)
    .toArray();

  // Sort by page and chunk index
  allChunks.sort((a, b) => {
    if (a.pageNumber !== b.pageNumber) return a.pageNumber - b.pageNumber;
    return a.chunkIndex - b.chunkIndex;
  });

  // Find current chunk position
  const currentIndex = allChunks.findIndex(c => c.id === chunkId);
  if (currentIndex === -1) return [chunk];

  // Get window
  const startIndex = Math.max(0, currentIndex - windowSize);
  const endIndex = Math.min(allChunks.length - 1, currentIndex + windowSize);

  return allChunks.slice(startIndex, endIndex + 1);
}
