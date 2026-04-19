import { createClient } from "jsr:@supabase/supabase-js@2";

type SearchFilters = {
  manufacturer?: string | null;
  product?: string | string[] | null;
  hasTable?: boolean | null;
  sourceType?: string | string[] | null;
  primaryOnly?: boolean | null;
};

type SearchRequest = {
  query?: string;
  filters?: SearchFilters;
};

type ManufacturerRow = {
  code: string;
  name: string;
  aliases: string[] | null;
};

type LexiconRow = {
  term: string;
  normalized_term: string;
  term_type: string;
};

type CandidateRow = {
  chunk_id: string;
  document_id: string;
  document_title: string;
  document_kind: string;
  issue_date: string | null;
  manufacturer_code: string;
  source_type: "certificate" | "manual";
  evidence_level: "primary" | "secondary";
  section: string | null;
  page_start: number | null;
  page_end: number | null;
  products: string[] | null;
  product_families: string[] | null;
  fire_classes: string[] | null;
  supports: string[] | null;
  penetration_types: string[] | null;
  dimensions: string[] | null;
  has_table: boolean;
  content: string;
  content_markdown: string | null;
  lexical_score: number;
  vector_score: number;
  fused_score: number;
};

type SearchResult = {
  chunkId: string;
  documentId: string;
  manufacturer: string;
  manufacturerCode: string;
  sourceType: "certificate" | "manual";
  evidenceLevel: "primary" | "secondary";
  section: string;
  documentTitle: string;
  documentKind: string;
  pageStart: number | null;
  pageEnd: number | null;
  products: string[];
  productFamilies: string[];
  fireClasses: string[];
  supports: string[];
  penetrationTypes: string[];
  dimensions: string[];
  hasTable: boolean;
  snippet: string;
  lexicalScore: number;
  vectorScore: number;
  fusedScore: number;
  rerankScore: number;
  score: number;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false },
});

const openAiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
const openAiBaseUrl = (Deno.env.get("OPENAI_BASE_URL") ?? "https://api.openai.com/v1").replace(/\/+$/, "");
const openRouterKey = Deno.env.get("OPENROUTER_API_KEY") ?? "";
const openRouterBaseUrl = (Deno.env.get("OPENROUTER_BASE_URL") ?? "https://openrouter.ai/api/v1").replace(/\/+$/, "");
const embedModel = Deno.env.get("RAG_V3_EMBED_MODEL") ?? "text-embedding-3-large";
const embedDimensions = 1536;
const chatModel = Deno.env.get("RAG_V3_CHAT_MODEL") ?? (openAiKey ? "gpt-4.1-mini" : "openai/gpt-4.1-mini");
const rerankerUrl = Deno.env.get("RAG_V3_RERANKER_URL") ?? "";

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStringArray(value: unknown): string[] | null {
  if (Array.isArray(value)) {
    const normalized = value.map((item) => normalizeString(item)).filter(Boolean);
    return normalized.length ? normalized : null;
  }
  const single = normalizeString(value);
  return single ? [single] : null;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s\-]/gu, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function normalizeComparableToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s\-]/gu, " ")
    .replace(/[\s\-]+/g, " ")
    .trim();
}

function clampScore(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1.5, value));
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

async function embedText(input: string): Promise<number[] | null> {
  if (!input.trim()) {
    return null;
  }

  if (openAiKey) {
    const response = await fetch(`${openAiBaseUrl}/embeddings`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: embedModel,
        input,
        dimensions: embedDimensions,
      }),
    });
    if (!response.ok) {
      console.warn("Embedding request failed against OpenAI", await response.text());
      return null;
    }
    const payload = await response.json();
    return payload.data?.[0]?.embedding ?? null;
  }

  if (openRouterKey) {
    const response = await fetch(`${openRouterBaseUrl}/embeddings`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openRouterKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://opimappa.local",
        "X-Title": "OPImaPPA CertSearch v3",
      },
      body: JSON.stringify({
        model: embedModel,
        input,
        dimensions: embedDimensions,
      }),
    });
    if (!response.ok) {
      console.warn("Embedding request failed against OpenRouter", await response.text());
      return null;
    }
    const payload = await response.json();
    return payload.data?.[0]?.embedding ?? null;
  }

  return null;
}

async function generateAnswer(query: string, results: SearchResult[]): Promise<string> {
  const topResults = results.slice(0, 5);
  if (!query.trim() || topResults.length === 0) {
    return "Nessun risultato disponibile per formulare una risposta.";
  }

  const promptContext = topResults.map((result, index) => {
    const pages = result.pageStart
      ? `${result.pageStart}${result.pageEnd && result.pageEnd !== result.pageStart ? `-${result.pageEnd}` : ""}`
      : "n/d";
    return [
      `[${index + 1}]`,
      `marca=${result.manufacturer}`,
      `tipo=${result.sourceType}`,
      `evidence=${result.evidenceLevel}`,
      `sezione=${result.section}`,
      `pagine=${pages}`,
      `prodotti=${result.products.join(", ") || "n/d"}`,
      `contenuto=${result.snippet}`,
    ].join(" | ");
  }).join("\n");

  if (openAiKey || openRouterKey) {
    const baseUrl = openAiKey ? openAiBaseUrl : openRouterBaseUrl;
    const authHeader = openAiKey ? `Bearer ${openAiKey}` : `Bearer ${openRouterKey}`;
    const extraHeaders = openAiKey
      ? {}
      : {
          "HTTP-Referer": "https://opimappa.local",
          "X-Title": "OPImaPPA CertSearch v3",
        };

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
        ...extraHeaders,
      },
      body: JSON.stringify({
        model: chatModel,
        temperature: 0.1,
        messages: [
          {
            role: "system",
            content:
              "Rispondi in italiano. I certificati sono fonte primaria e guidano la risposta. " +
              "I manuali possono spiegare o suggerire famiglie prodotto, ma non certificano da soli. " +
              "Se hai solo fonti secondarie, dillo chiaramente. Mantieni la risposta concisa.",
          },
          {
            role: "user",
            content: `Domanda: ${query}\n\nContesto:\n${promptContext}`,
          },
        ],
      }),
    });

    if (response.ok) {
      const payload = await response.json();
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content === "string" && content.trim()) {
        return content.trim();
      }
    } else {
      console.warn("Answer generation failed", await response.text());
    }
  }

  const primary = topResults.filter((result) => result.evidenceLevel === "primary");
  const supportSet = primary.length ? primary : topResults;
  const products = unique(supportSet.flatMap((result) => result.products)).slice(0, 4);
  const fireClasses = unique(supportSet.flatMap((result) => result.fireClasses)).slice(0, 4);
  const sources = supportSet.map((result) => `${result.manufacturer} ${result.sourceType === "certificate" ? "certificato" : "manuale"}`);
  const sourceNote = primary.length
    ? "La risposta è supportata da fonti primarie."
    : "Attenzione: al momento il supporto disponibile è solo da fonti secondarie.";
  return [
    sourceNote,
    products.length ? `Prodotti/famiglie emersi: ${products.join(", ")}.` : null,
    fireClasses.length ? `Classi rilevate: ${fireClasses.join(", ")}.` : null,
    `Fonti principali: ${unique(sources).slice(0, 3).join(", ")}.`,
  ].filter(Boolean).join(" ");
}

function scoreOverlap(queryTokens: string[], result: CandidateRow): number {
  if (!queryTokens.length) {
    return 0;
  }
  const haystack = [
    result.section ?? "",
    result.content,
    ...(result.products ?? []),
    ...(result.product_families ?? []),
    ...(result.fire_classes ?? []),
    ...(result.supports ?? []),
    ...(result.penetration_types ?? []),
    result.document_title ?? "",
  ].join(" ").toLowerCase();
  const matches = queryTokens.filter((token) => haystack.includes(token));
  return matches.length / queryTokens.length;
}

function extractPattern(text: string, pattern: RegExp): string[] {
  return unique(Array.from(text.matchAll(pattern), (match) => normalizeString(match[0]).toLowerCase()).filter(Boolean));
}

function parseQueryIntent(query: string) {
  const normalized = query.toLowerCase();
  const productHints = unique(
    Array.from(
      query.toUpperCase().matchAll(/\bAF(?:[\s\-]+[A-Z0-9]+)\b/g),
      (match) => normalizeComparableToken(match[0]),
    ).filter((hint) => hint && hint !== "af systems"),
  );
  return {
    fireClasses: extractPattern(normalized, /\b(?:ei|rei|ew|e)\s*\d+\b/gi),
    supports: extractPattern(normalized, /\b(calcestruzzo|muratura|cartongesso|parete rigida|parete flessibile|solaio|legno|acciaio)\b/gi),
    penetrationTypes: extractPattern(normalized, /\b(cavo(?:\s+elettrico)?|tubo(?:\s+metallico|\s+plastico)?|canalina|fascio\s+cavi|condotta)\b/gi),
    certificateIntent: /\b(ei|rei|eta|classificazione|certificat|rapporto di prova)\b/i.test(normalized),
    productHints,
  };
}

function metadataMatchScore(intent: ReturnType<typeof parseQueryIntent>, row: CandidateRow): number {
  let score = 0;
  const rowFireClasses = (row.fire_classes ?? []).map((item) => item.toLowerCase());
  const rowSupports = (row.supports ?? []).map((item) => item.toLowerCase());
  const rowPenetrations = (row.penetration_types ?? []).map((item) => item.toLowerCase());
  if (intent.fireClasses.some((item) => rowFireClasses.some((candidate) => candidate.includes(item)))) score += 0.16;
  if (intent.supports.some((item) => rowSupports.some((candidate) => candidate.includes(item)))) score += 0.12;
  if (intent.penetrationTypes.some((item) => rowPenetrations.some((candidate) => candidate.includes(item)))) score += 0.12;
  return score;
}

function productHintScore(intent: ReturnType<typeof parseQueryIntent>, row: CandidateRow): { boost: number; matched: boolean } {
  if (!intent.productHints.length) {
    return { boost: 0, matched: false };
  }

  const rowTerms = [
    ...(row.products ?? []),
    ...(row.product_families ?? []),
    row.section ?? "",
    row.document_title ?? "",
  ]
    .map((item) => normalizeComparableToken(item))
    .filter(Boolean);

  const exactMatch = intent.productHints.some((hint) => rowTerms.some((term) => term === hint));
  if (exactMatch) {
    return { boost: 0.24, matched: true };
  }

  const partialMatch = intent.productHints.some((hint) =>
    rowTerms.some((term) => term.includes(hint) || hint.includes(term)),
  );
  if (partialMatch) {
    return { boost: 0.14, matched: true };
  }

  return { boost: -0.18, matched: false };
}

function coverPenalty(row: CandidateRow): number {
  const haystack = `${row.section ?? ""} ${row.content_markdown || row.content} ${row.document_title}`.toLowerCase();
  const coverSignals = [
    "via jenner",
    "www.af-systems.com",
    "pagine, incluso un allegato",
    "tecnalia research",
    "prodotti sigillanti e antifuoco",
    "parte generale",
    "quadro normativo",
  ];
  const matches = coverSignals.filter((signal) => haystack.includes(signal)).length;
  return matches > 0 ? Math.min(0.22, matches * 0.06) : 0;
}

function documentKindBoost(row: CandidateRow): number {
  if (row.document_kind === "classification_report") return 0.1;
  if (row.document_kind === "eta") return 0.08;
  if (row.document_kind === "test_report") return 0.05;
  return 0;
}

async function rerankCandidates(query: string, rows: CandidateRow[]): Promise<{ scores: Map<string, number>; mode: string }> {
  const queryTokens = tokenize(query);
  const intent = parseQueryIntent(query);

  if (rerankerUrl) {
    try {
      const response = await fetch(rerankerUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          candidates: rows.map((row) => ({
            id: row.chunk_id,
            text: row.content_markdown || row.content,
            metadata: {
              manufacturerCode: row.manufacturer_code,
              sourceType: row.source_type,
              evidenceLevel: row.evidence_level,
              products: row.products ?? [],
              fireClasses: row.fire_classes ?? [],
            },
          })),
        }),
      });
      if (response.ok) {
        const payload = await response.json();
        const scores = new Map<string, number>();
        for (const item of payload.results ?? []) {
          if (item?.id) {
            scores.set(String(item.id), Number(item.score ?? 0));
          }
        }
        return { scores, mode: "external-cross-encoder" };
      }
      console.warn("External reranker failed", await response.text());
    } catch (error) {
      console.warn("External reranker threw", error);
    }
  }

  const scores = new Map<string, number>();
  for (const row of rows) {
    const overlap = scoreOverlap(queryTokens, row);
    const metadataBoost = metadataMatchScore(intent, row);
    const productScore = productHintScore(intent, row);
    const primaryBoost = row.evidence_level === "primary" ? 0.08 : 0;
    const certificateBoost = row.source_type === "certificate" ? 0.06 : 0;
    const intentBoost = intent.certificateIntent && row.source_type === "certificate" ? 0.04 : 0;
    const penalty = coverPenalty(row);
    const rerankScore = clampScore(
      (row.fused_score * 0.52) +
      (overlap * 0.16) +
      metadataBoost +
      productScore.boost +
      primaryBoost +
      certificateBoost +
      intentBoost +
      documentKindBoost(row) -
      penalty
    );
    scores.set(row.chunk_id, rerankScore);
  }
  return { scores, mode: "fallback-heuristic" };
}

function buildSnippet(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 380);
}

async function detectManufacturer(query: string, filters: SearchFilters, manufacturers: ManufacturerRow[]): Promise<string | null> {
  if (filters.manufacturer) {
    return normalizeString(filters.manufacturer).toUpperCase();
  }
  const haystack = query.toLowerCase();
  for (const manufacturer of manufacturers) {
    const variants = [manufacturer.code, manufacturer.name, ...(manufacturer.aliases ?? [])]
      .map((entry) => entry.toLowerCase());
    if (variants.some((variant) => variant && haystack.includes(variant))) {
      return manufacturer.code;
    }
  }
  return null;
}

async function buildExpandedQuery(query: string, manufacturerCode: string | null): Promise<{ expandedQuery: string; matchedLexicon: string[] }> {
  if (!manufacturerCode) {
    return { expandedQuery: query, matchedLexicon: [] };
  }

  const { data, error } = await supabase
    .from("manufacturer_lexicon")
    .select("term, normalized_term, term_type")
    .eq("manufacturer_code", manufacturerCode)
    .limit(250);

  if (error) {
    console.warn("Failed to load manufacturer lexicon", error);
    return { expandedQuery: query, matchedLexicon: [] };
  }

  const rows = (data ?? []) as LexiconRow[];
  const queryTokens = tokenize(query);
  const matchedLexicon = unique(rows
    .filter((row) => queryTokens.some((token) => row.normalized_term.includes(token) || token.includes(row.normalized_term)))
    .slice(0, 8)
    .map((row) => row.term));

  const expandedQuery = unique([query, ...matchedLexicon]).join(" ").trim();
  return { expandedQuery, matchedLexicon };
}

function toSearchResult(row: CandidateRow, manufacturersByCode: Map<string, ManufacturerRow>, rerankScore: number): SearchResult {
  const manufacturer = manufacturersByCode.get(row.manufacturer_code);
  return {
    chunkId: row.chunk_id,
    documentId: row.document_id,
    manufacturer: manufacturer?.name ?? row.manufacturer_code,
    manufacturerCode: row.manufacturer_code,
    sourceType: row.source_type,
    evidenceLevel: row.evidence_level,
    section: row.section ?? "Documento",
    documentTitle: row.document_title,
    documentKind: row.document_kind,
    pageStart: row.page_start,
    pageEnd: row.page_end,
    products: row.products ?? [],
    productFamilies: row.product_families ?? [],
    fireClasses: row.fire_classes ?? [],
    supports: row.supports ?? [],
    penetrationTypes: row.penetration_types ?? [],
    dimensions: row.dimensions ?? [],
    hasTable: row.has_table,
    snippet: buildSnippet(row.content_markdown || row.content),
    lexicalScore: Number(row.lexical_score ?? 0),
    vectorScore: Number(row.vector_score ?? 0),
    fusedScore: Number(row.fused_score ?? 0),
    rerankScore,
    score: clampScore((Number(row.fused_score ?? 0) * 0.55) + (rerankScore * 0.45)),
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const body = (await request.json()) as SearchRequest;
    const query = normalizeString(body.query);
    const filters = body.filters ?? {};
    const productFilters = normalizeStringArray(filters.product);
    const sourceTypeFilters = normalizeStringArray(filters.sourceType);

    if (!query && !productFilters?.length && !filters.manufacturer) {
      return jsonResponse({ error: "Missing query or filters" }, 400);
    }

    const { data: manufacturerRows, error: manufacturersError } = await supabase
      .from("manufacturers")
      .select("code, name, aliases")
      .eq("is_active", true);

    if (manufacturersError) {
      return jsonResponse({ error: manufacturersError.message }, 500);
    }

    const manufacturers = (manufacturerRows ?? []) as ManufacturerRow[];
    const manufacturersByCode = new Map(manufacturers.map((row) => [row.code, row]));
    const manufacturerCode = await detectManufacturer(query, filters, manufacturers);
    const { expandedQuery, matchedLexicon } = await buildExpandedQuery(query, manufacturerCode);
    const queryEmbedding = await embedText(expandedQuery);

    const { data: rawRows, error: searchError } = await supabase.rpc("rag_v3_search_chunks", {
      query_text: expandedQuery,
      query_embedding_text: queryEmbedding ? JSON.stringify(queryEmbedding) : null,
      match_count: 30,
      filter_manufacturer: manufacturerCode,
      filter_products: productFilters,
      filter_source_types: sourceTypeFilters,
      filter_primary_only: Boolean(filters.primaryOnly),
      filter_has_table: typeof filters.hasTable === "boolean" ? filters.hasTable : null,
    });

    if (searchError) {
      return jsonResponse({ error: searchError.message }, 500);
    }

    const candidateRows = (rawRows ?? []) as CandidateRow[];
    const { scores, mode: rerankerMode } = await rerankCandidates(expandedQuery, candidateRows);
    const results = candidateRows
      .map((row) => toSearchResult(row, manufacturersByCode, scores.get(row.chunk_id) ?? Number(row.fused_score ?? 0)))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    const citations = results.slice(0, 5).map((result, index) => ({
      id: `${index + 1}`,
      chunkId: result.chunkId,
      documentId: result.documentId,
      manufacturer: result.manufacturer,
      sourceType: result.sourceType,
      evidenceLevel: result.evidenceLevel,
      section: result.section,
      pageStart: result.pageStart,
      pageEnd: result.pageEnd,
      products: result.products,
    }));

    const answer = await generateAnswer(query || expandedQuery, results);
    const secondaryOnly = results.length > 0 && results.every((result) => result.evidenceLevel === "secondary");

    return jsonResponse({
      answer,
      citations,
      results,
      parsedQuery: {
        originalQuery: query,
        expandedQuery,
        matchedLexicon,
        rerankerMode,
        detectedManufacturer: manufacturerCode,
      },
      appliedFilters: {
        manufacturer: manufacturerCode,
        product: productFilters,
        hasTable: typeof filters.hasTable === "boolean" ? filters.hasTable : null,
        sourceType: sourceTypeFilters,
        primaryOnly: Boolean(filters.primaryOnly),
      },
      support: {
        secondaryOnly,
        primaryResultCount: results.filter((result) => result.evidenceLevel === "primary").length,
      },
    });
  } catch (error) {
    console.error(error);
    return jsonResponse({
      error: error instanceof Error ? error.message : "Unexpected error",
    }, 500);
  }
});
