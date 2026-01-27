/**
 * OpenAI Embedding Service
 *
 * Generates vector embeddings using OpenAI's text-embedding-3-small model.
 * Used for semantic search over fire seal certificates.
 */

const OPENAI_API_URL = 'https://api.openai.com/v1/embeddings';
const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 1536;
const MAX_TOKENS_PER_REQUEST = 8191;
const BATCH_SIZE = 100; // Max items per batch request

export interface EmbeddingResult {
  embedding: number[];
  tokenCount: number;
}

export interface BatchEmbeddingResult {
  embeddings: number[][];
  totalTokens: number;
}

/**
 * Get OpenAI API key from environment
 */
function getApiKey(): string {
  const apiKey = process.env.REACT_APP_OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'OpenAI API key not configured. Please set REACT_APP_OPENAI_API_KEY in your environment.'
    );
  }
  return apiKey;
}

/**
 * Check if OpenAI is configured
 */
export function isOpenAIConfigured(): boolean {
  return !!process.env.REACT_APP_OPENAI_API_KEY;
}

/**
 * Generate embedding for a single text
 */
export async function generateEmbedding(text: string): Promise<EmbeddingResult> {
  if (!text || text.trim().length === 0) {
    throw new Error('Cannot generate embedding for empty text');
  }

  const apiKey = getApiKey();

  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: text.trim(),
      encoding_format: 'float'
    })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      `OpenAI API error: ${response.status} - ${error.error?.message || response.statusText}`
    );
  }

  const data = await response.json();

  return {
    embedding: data.data[0].embedding,
    tokenCount: data.usage.total_tokens
  };
}

/**
 * Generate embeddings for multiple texts in batch
 * More efficient than individual calls
 */
export async function generateEmbeddingsBatch(
  texts: string[],
  onProgress?: (processed: number, total: number) => void
): Promise<BatchEmbeddingResult> {
  if (texts.length === 0) {
    return { embeddings: [], totalTokens: 0 };
  }

  const apiKey = getApiKey();
  const allEmbeddings: number[][] = [];
  let totalTokens = 0;

  // Process in batches
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const cleanedBatch = batch.map(t => t.trim()).filter(t => t.length > 0);

    if (cleanedBatch.length === 0) continue;

    const response = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: cleanedBatch,
        encoding_format: 'float'
      })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(
        `OpenAI API error: ${response.status} - ${error.error?.message || response.statusText}`
      );
    }

    const data = await response.json();

    // Sort by index to maintain order
    const sortedData = data.data.sort((a: any, b: any) => a.index - b.index);
    const batchEmbeddings = sortedData.map((d: any) => d.embedding);

    allEmbeddings.push(...batchEmbeddings);
    totalTokens += data.usage.total_tokens;

    // Report progress
    if (onProgress) {
      onProgress(Math.min(i + BATCH_SIZE, texts.length), texts.length);
    }

    // Rate limiting: wait a bit between batches to avoid hitting limits
    if (i + BATCH_SIZE < texts.length) {
      await sleep(100); // 100ms delay between batches
    }
  }

  return {
    embeddings: allEmbeddings,
    totalTokens
  };
}

/**
 * Estimate token count for text (rough approximation)
 * OpenAI uses ~4 chars per token for English text
 */
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Check if text is within token limit
 */
export function isWithinTokenLimit(text: string): boolean {
  return estimateTokenCount(text) <= MAX_TOKENS_PER_REQUEST;
}

/**
 * Truncate text to fit within token limit
 */
export function truncateToTokenLimit(text: string): string {
  const maxChars = MAX_TOKENS_PER_REQUEST * 4; // Rough estimate
  if (text.length <= maxChars) return text;

  // Truncate and add ellipsis
  return text.substring(0, maxChars - 3) + '...';
}

/**
 * Calculate cosine similarity between two embeddings
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Embeddings must have the same dimension');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  if (magnitude === 0) return 0;

  return dotProduct / magnitude;
}

/**
 * Find top-K most similar embeddings
 */
export function findTopKSimilar(
  queryEmbedding: number[],
  embeddings: number[][],
  k: number = 10,
  minSimilarity: number = 0.0
): Array<{ index: number; similarity: number }> {
  const similarities = embeddings.map((emb, index) => ({
    index,
    similarity: cosineSimilarity(queryEmbedding, emb)
  }));

  return similarities
    .filter(s => s.similarity >= minSimilarity)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, k);
}

/**
 * Get embedding model info
 */
export function getEmbeddingModelInfo() {
  return {
    model: EMBEDDING_MODEL,
    dimensions: EMBEDDING_DIMENSIONS,
    maxTokens: MAX_TOKENS_PER_REQUEST,
    batchSize: BATCH_SIZE,
    // Pricing as of Jan 2025: $0.02 per 1M tokens
    estimatedCostPer1MTokens: 0.02
  };
}

/**
 * Estimate cost for embedding texts
 */
export function estimateEmbeddingCost(texts: string[]): {
  estimatedTokens: number;
  estimatedCostUSD: number;
} {
  const totalTokens = texts.reduce((sum, text) => sum + estimateTokenCount(text), 0);
  const costPer1MTokens = 0.02;
  const estimatedCostUSD = (totalTokens / 1_000_000) * costPer1MTokens;

  return {
    estimatedTokens: totalTokens,
    estimatedCostUSD: Math.round(estimatedCostUSD * 10000) / 10000 // Round to 4 decimal places
  };
}

// Helper function
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
