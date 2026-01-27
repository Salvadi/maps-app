/**
 * OpenRouter LLM Service
 *
 * Integrates with OpenRouter API to use Google Gemma 3 for
 * generating responses based on certificate context.
 */

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Free model options on OpenRouter
export const AVAILABLE_MODELS = {
  'google/gemma-3-27b-it:free': {
    name: 'Google Gemma 3 27B',
    contextWindow: 131072,
    free: true
  },
  'meta-llama/llama-3.1-8b-instruct:free': {
    name: 'Meta Llama 3.1 8B',
    contextWindow: 8192,
    free: true
  },
  'mistralai/mistral-7b-instruct:free': {
    name: 'Mistral 7B Instruct',
    contextWindow: 8192,
    free: true
  }
} as const;

export type ModelId = keyof typeof AVAILABLE_MODELS;

// Default to Gemma 3
const DEFAULT_MODEL: ModelId = 'google/gemma-3-27b-it:free';

// System prompt for fire seal expert
const FIRE_SEAL_SYSTEM_PROMPT = `Sei un esperto tecnico specializzato in soluzioni di sigillatura antincendio.
Il tuo compito è aiutare a trovare la soluzione corretta basandoti sui documenti dei certificati forniti.

REGOLE IMPORTANTI:
1. Rispondi SOLO basandoti sui documenti forniti nel contesto
2. Se non trovi informazioni sufficienti, dichiaralo chiaramente
3. Per ogni soluzione proposta, DEVI citare:
   - Il nome del certificato
   - Il numero di pagina esatto
   - Il prodotto specifico raccomandato
4. Usa terminologia tecnica precisa del settore
5. Rispondi sempre in italiano

FORMATO RISPOSTA:
1. Risposta sintetica alla domanda (2-3 frasi)
2. Soluzioni raccomandate con dettagli e citazioni
3. Note importanti o avvertenze (se presenti nei documenti)

Usa il formato [Certificato: nome, Pag. X] per le citazioni.`;

export interface RetrievedChunk {
  content: string;
  certificateTitle: string;
  certificateBrand: string;
  pageNumber: number;
  similarity: number;
  metadata?: Record<string, any>;
}

export interface SearchFilters {
  brand?: string;
  rei?: string;
  supporto?: string;
  attraversamento?: string;
}

export interface LLMContext {
  query: string;
  retrievedChunks: RetrievedChunk[];
  filters?: SearchFilters;
}

export interface Citation {
  certificateTitle: string;
  brand: string;
  pageNumber: number;
  excerpt: string;
}

export interface LLMResponse {
  answer: string;
  citations: Citation[];
  model: string;
  tokensUsed?: number;
}

/**
 * Get OpenRouter API key from environment
 */
function getApiKey(): string {
  const apiKey = process.env.REACT_APP_OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      'OpenRouter API key not configured. Please set REACT_APP_OPENROUTER_API_KEY in your environment.'
    );
  }
  return apiKey;
}

/**
 * Check if OpenRouter is configured
 */
export function isOpenRouterConfigured(): boolean {
  return !!process.env.REACT_APP_OPENROUTER_API_KEY;
}

/**
 * Format retrieved chunks into context for LLM
 */
function formatContext(chunks: RetrievedChunk[]): string {
  return chunks
    .map((chunk, i) => {
      const header = `[Fonte ${i + 1}: ${chunk.certificateTitle} (${chunk.certificateBrand}), Pag. ${chunk.pageNumber}]`;
      return `${header}\n${chunk.content}`;
    })
    .join('\n\n---\n\n');
}

/**
 * Extract citations from LLM response
 */
function extractCitations(
  answer: string,
  chunks: RetrievedChunk[]
): Citation[] {
  const citations: Citation[] = [];

  // Match patterns like [Certificato: name, Pag. X] or (Pag. X) or pagina X
  const patterns = [
    /\[Certificato:\s*([^,]+),\s*Pag\.\s*(\d+)\]/gi,
    /\[([^,\]]+),\s*Pag\.\s*(\d+)\]/gi,
    /Pag\.\s*(\d+)/gi,
    /pagina\s+(\d+)/gi
  ];

  // Find all mentioned page numbers
  const mentionedPages = new Set<number>();
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(answer)) !== null) {
      const pageNum = parseInt(match[match.length - 1], 10);
      if (!isNaN(pageNum)) {
        mentionedPages.add(pageNum);
      }
    }
  }

  // Match citations with actual chunks
  for (const chunk of chunks) {
    if (mentionedPages.has(chunk.pageNumber)) {
      // Avoid duplicate citations
      const exists = citations.some(
        c => c.certificateTitle === chunk.certificateTitle && c.pageNumber === chunk.pageNumber
      );

      if (!exists) {
        citations.push({
          certificateTitle: chunk.certificateTitle,
          brand: chunk.certificateBrand,
          pageNumber: chunk.pageNumber,
          excerpt: chunk.content.substring(0, 200) + (chunk.content.length > 200 ? '...' : '')
        });
      }
    }
  }

  // If no citations found but we have chunks, add the most relevant ones
  if (citations.length === 0 && chunks.length > 0) {
    const topChunks = chunks.slice(0, 3);
    for (const chunk of topChunks) {
      citations.push({
        certificateTitle: chunk.certificateTitle,
        brand: chunk.certificateBrand,
        pageNumber: chunk.pageNumber,
        excerpt: chunk.content.substring(0, 200) + (chunk.content.length > 200 ? '...' : '')
      });
    }
  }

  return citations;
}

/**
 * Generate answer using LLM with RAG context
 */
export async function generateAnswer(
  context: LLMContext,
  model: ModelId = DEFAULT_MODEL
): Promise<LLMResponse> {
  if (!isOpenRouterConfigured()) {
    throw new Error('OpenRouter non configurato');
  }

  if (context.retrievedChunks.length === 0) {
    return {
      answer: 'Non ho trovato documenti pertinenti alla tua domanda nei certificati disponibili. ' +
              'Prova a riformulare la domanda o verifica che i certificati necessari siano stati caricati.',
      citations: [],
      model
    };
  }

  const apiKey = getApiKey();
  const contextText = formatContext(context.retrievedChunks);

  // Build the user message
  let userMessage = `DOCUMENTI DI RIFERIMENTO:\n\n${contextText}\n\n---\n\n`;

  if (context.filters) {
    const filterParts: string[] = [];
    if (context.filters.brand) filterParts.push(`Marca: ${context.filters.brand}`);
    if (context.filters.rei) filterParts.push(`REI: ${context.filters.rei}`);
    if (context.filters.supporto) filterParts.push(`Supporto: ${context.filters.supporto}`);
    if (context.filters.attraversamento) filterParts.push(`Attraversamento: ${context.filters.attraversamento}`);

    if (filterParts.length > 0) {
      userMessage += `FILTRI APPLICATI: ${filterParts.join(', ')}\n\n`;
    }
  }

  userMessage += `DOMANDA: ${context.query}`;

  try {
    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': window.location.origin,
        'X-Title': 'OPImaPPA Fire Seal Search'
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: FIRE_SEAL_SYSTEM_PROMPT },
          { role: 'user', content: userMessage }
        ],
        temperature: 0.3, // Lower temperature for more precise/factual responses
        max_tokens: 1500,
        top_p: 0.9
      })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));

      // Handle specific error cases
      if (response.status === 429) {
        throw new Error('Limite di richieste raggiunto. Riprova tra qualche minuto.');
      }
      if (response.status === 402) {
        throw new Error('Crediti OpenRouter esauriti. Verifica il tuo account.');
      }

      throw new Error(
        `OpenRouter API error: ${response.status} - ${error.error?.message || response.statusText}`
      );
    }

    const data = await response.json();
    const answer = data.choices[0]?.message?.content || 'Risposta non disponibile';

    // Extract citations from the answer
    const citations = extractCitations(answer, context.retrievedChunks);

    return {
      answer,
      citations,
      model,
      tokensUsed: data.usage?.total_tokens
    };
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Errore durante la generazione della risposta');
  }
}

/**
 * Check if LLM is available (online and configured)
 */
export async function checkLLMAvailability(): Promise<{
  available: boolean;
  error?: string;
}> {
  if (!navigator.onLine) {
    return {
      available: false,
      error: 'Connessione internet non disponibile. La generazione di risposte richiede una connessione.'
    };
  }

  if (!isOpenRouterConfigured()) {
    return {
      available: false,
      error: 'OpenRouter non configurato. Imposta REACT_APP_OPENROUTER_API_KEY.'
    };
  }

  return { available: true };
}

/**
 * Get available model options
 */
export function getAvailableModels() {
  return Object.entries(AVAILABLE_MODELS).map(([id, info]) => ({
    id: id as ModelId,
    ...info
  }));
}

/**
 * Get default model
 */
export function getDefaultModel(): ModelId {
  return DEFAULT_MODEL;
}

/**
 * Simple question-answer without RAG context (for testing)
 */
export async function simpleChat(
  message: string,
  model: ModelId = DEFAULT_MODEL
): Promise<string> {
  const apiKey = getApiKey();

  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': window.location.origin,
      'X-Title': 'OPImaPPA Fire Seal Search'
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'user', content: message }
      ],
      temperature: 0.7,
      max_tokens: 500
    })
  });

  if (!response.ok) {
    throw new Error(`OpenRouter API error: ${response.status}`);
  }

  const data = await response.json();
  return data.choices[0]?.message?.content || '';
}
