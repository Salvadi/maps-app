import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface SearchRequest {
  query: string;
  topK?: number;
  filters?: {
    certName?: string;
    hasTable?: boolean;
  };
}

interface Chunk {
  id: string;
  cert_id: string;
  section: string;
  content: string;
  has_table: boolean;
  similarity: number;
}

serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { query, topK = 10, filters }: SearchRequest = await req.json();

    if (!query?.trim()) {
      return new Response(
        JSON.stringify({ error: "Query mancante" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const OPENROUTER_KEY = Deno.env.get("OPENROUTER_API_KEY");
    if (!OPENROUTER_KEY) throw new Error("OPENROUTER_API_KEY non configurata");

    // ── Step 1: Embedding della query via OpenRouter ─────────────────
    const embRes = await fetch("https://openrouter.ai/api/v1/embeddings", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENROUTER_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/text-embedding-3-small",
        input: query.trim(),
      }),
    });

    if (!embRes.ok) {
      const err = await embRes.text();
      throw new Error(`Errore embedding OpenRouter: ${embRes.status} ${err}`);
    }

    const embData = await embRes.json();
    const queryVector: number[] = embData.data[0].embedding;

    // ── Step 2: Ricerca vettoriale su Supabase ───────────────────────
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: chunks, error: searchError } = await supabase.rpc(
      "match_certificate_chunks",
      {
        query_embedding: queryVector,
        match_count: topK,
        filter_has_table: filters?.hasTable ?? null,
      },
    );

    if (searchError) throw new Error(`Errore ricerca: ${searchError.message}`);

    if (!chunks || chunks.length === 0) {
      return new Response(
        JSON.stringify({
          query,
          answer: "Nessun risultato trovato per questa query.",
          citations: [],
          results: [],
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Step 3: Recupera nomi certificati ────────────────────────────
    const certIds = [...new Set((chunks as Chunk[]).map((c) => c.cert_id))];
    const { data: certs } = await supabase
      .from("certificates")
      .select("id, name")
      .in("id", certIds);

    const certMap: Record<string, string> = {};
    (certs || []).forEach((c: { id: string; name: string }) => {
      certMap[c.id] = c.name;
    });

    const enriched = (chunks as Chunk[]).map((c, i) => ({
      id: c.id,
      score: c.similarity,
      certName: certMap[c.cert_id] || c.cert_id,
      section: c.section,
      content: c.content,
      hasTable: c.has_table,
      chunkIndex: i,
    }));

    // Filtra per nome certificato se richiesto (confronto case-insensitive)
    const filtered = filters?.certName
      ? enriched.filter((r) =>
          r.certName.toLowerCase().includes(filters.certName!.toLowerCase())
        )
      : enriched;

    // ── Step 4: Risposta LLM via OpenRouter ──────────────────────────
    const context = filtered
      .map(
        (r, i) =>
          `[${i + 1}] Certificato: ${r.certName} | Sezione: ${r.section}\n${r.content}`,
      )
      .join("\n\n---\n\n");

    const systemPrompt =
      `Sei un esperto di prevenzione incendi e certificazioni antincendio italiane.
Rispondi alle domande tecniche basandoti ESCLUSIVAMENTE sui documenti forniti.
Per ogni affermazione cita la fonte tra parentesi quadre [n].
Se disponibili più soluzioni, elencale tutte con le rispettive condizioni e limitazioni.
Se i documenti non contengono la risposta, dillo esplicitamente.
Rispondi in italiano. Sii preciso con i dati tecnici (diametri, classi REI/EI, materiali).`;

    const llmRes = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${OPENROUTER_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://opifiresafe.app",
          "X-Title": "OPImaPPA CertSearch",
        },
        body: JSON.stringify({
          model: "google/gemini-2.0-flash-exp:free",
          messages: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: `Domanda: ${query}\n\nDocumenti di riferimento:\n${context}`,
            },
          ],
          max_tokens: 1024,
        }),
      },
    );

    if (!llmRes.ok) {
      const err = await llmRes.text();
      throw new Error(`Errore LLM OpenRouter: ${llmRes.status} ${err}`);
    }

    const llmData = await llmRes.json();
    const answer: string = llmData.choices[0].message.content;

    // Estrae indici citazioni [n] dalla risposta
    const citationMatches = [...answer.matchAll(/\[(\d+)\]/g)];
    const citedIndices = [
      ...new Set(citationMatches.map((m) => parseInt(m[1]))),
    ];
    const citations = citedIndices
      .filter((idx) => idx >= 1 && idx <= filtered.length)
      .map((idx) => ({
        index: idx,
        certName: filtered[idx - 1].certName,
        section: filtered[idx - 1].section,
        content: filtered[idx - 1].content.substring(0, 250),
      }));

    return new Response(
      JSON.stringify({ query, answer, citations, results: filtered }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("cert-search error:", message);
    return new Response(
      JSON.stringify({ error: message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
