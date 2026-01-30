/**
 * Vercel Serverless API Route: /api/search
 *
 * Pipeline: Query → OpenAI Embedding → Qdrant Vector Search → Claude Reranking/Answer
 */

export const config = {
  maxDuration: 30, // 30s timeout (Vercel Pro)
};

const EMBEDDING_MODEL = 'openai/text-embedding-3-large';
const COLLECTION_NAME = 'fire_certificates';

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { query, filters, topK = 10 } = req.body;

  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid query' });
  }

  try {
    // Step 1: Generate query embedding
    const embeddingRes = await fetch('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: query,
      }),
    });

    if (!embeddingRes.ok) {
      const err = await embeddingRes.text();
      throw new Error(`Embedding API error: ${embeddingRes.status} ${err}`);
    }

    const embeddingData = await embeddingRes.json();
    const queryVector = embeddingData.data[0].embedding;

    // Step 2: Qdrant vector search
    const qdrantFilter = buildQdrantFilter(filters);
    const qdrantRes = await fetch(`${process.env.QDRANT_URL}/collections/${COLLECTION_NAME}/points/search`, {
      method: 'POST',
      headers: {
        'api-key': process.env.QDRANT_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        vector: queryVector,
        limit: topK,
        with_payload: true,
        ...(qdrantFilter && { filter: qdrantFilter }),
      }),
    });

    if (!qdrantRes.ok) {
      const err = await qdrantRes.text();
      throw new Error(`Qdrant search error: ${qdrantRes.status} ${err}`);
    }

    const qdrantData = await qdrantRes.json();
    const results = qdrantData.result || [];

    // Step 3: LLM reranking and answer generation
    const answer = await generateAnswer(query, results);

    return res.status(200).json({
      query,
      answer: answer.text,
      citations: answer.citations,
      results: results.map(r => ({
        id: r.id,
        score: r.score,
        certName: r.payload.cert_name,
        section: r.payload.section,
        content: r.payload.content,
        hasTable: r.payload.has_table,
        chunkIndex: r.payload.chunk_index,
      })),
    });
  } catch (error) {
    console.error('Search error:', error);
    return res.status(500).json({ error: error.message });
  }
}

function buildQdrantFilter(filters) {
  if (!filters) return null;

  const must = [];

  if (filters.certName) {
    must.push({
      key: 'cert_name',
      match: { value: filters.certName },
    });
  }

  if (filters.hasTable !== undefined) {
    must.push({
      key: 'has_table',
      match: { value: filters.hasTable },
    });
  }

  return must.length > 0 ? { must } : null;
}

async function generateAnswer(query, results) {
  if (results.length === 0) {
    return {
      text: 'Nessun risultato trovato per la query specificata.',
      citations: [],
    };
  }

  const context = results
    .map((r, i) => `[${i + 1}] Certificato: ${r.payload.cert_name} | Sezione: ${r.payload.section}\n${r.payload.content}`)
    .join('\n\n---\n\n');

  const llmRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'anthropic/claude-sonnet-4',
      messages: [
        {
          role: 'system',
          content: `Sei un esperto di prevenzione incendi e certificazioni antincendio.
Rispondi alle domande tecniche basandoti ESCLUSIVAMENTE sui documenti forniti.
Per ogni affermazione, cita la fonte tra parentesi quadre [n].
Se i documenti non contengono la risposta, dillo esplicitamente.
Rispondi in italiano. Sii preciso con i dati tecnici (diametri, classi EI, materiali).
Formato risposta: testo con citazioni [1], [2], etc.`,
        },
        {
          role: 'user',
          content: `Domanda: ${query}\n\nDocumenti di riferimento:\n${context}`,
        },
      ],
      max_tokens: 1024,
      temperature: 0.1,
    }),
  });

  if (!llmRes.ok) {
    // Fallback: return results without LLM answer
    console.error('LLM error:', await llmRes.text());
    return {
      text: 'Risultati trovati (risposta AI non disponibile):',
      citations: results.map((r, i) => ({
        index: i + 1,
        certName: r.payload.cert_name,
        section: r.payload.section,
      })),
    };
  }

  const llmData = await llmRes.json();
  const answerText = llmData.choices[0]?.message?.content || '';

  // Extract citation indices from answer
  const citationMatches = [...answerText.matchAll(/\[(\d+)\]/g)];
  const citedIndices = [...new Set(citationMatches.map(m => parseInt(m[1])))];

  const citations = citedIndices
    .filter(i => i >= 1 && i <= results.length)
    .map(i => ({
      index: i,
      certName: results[i - 1].payload.cert_name,
      section: results[i - 1].payload.section,
      content: results[i - 1].payload.content.substring(0, 200),
    }));

  return { text: answerText, citations };
}
