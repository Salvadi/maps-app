-- Abilita l'estensione pgvector (sicuro se già abilitata)
CREATE EXTENSION IF NOT EXISTS vector;

-- Aggiunge la colonna embedding (1536 dimensioni per text-embedding-3-small)
ALTER TABLE public.certificate_chunks
  ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- Indice IVFFlat per ricerca approssimata per similarità coseno
-- NOTA: l'indice funziona al meglio dopo che gli embedding sono popolati.
-- Eseguire REINDEX INDEX idx_cert_chunks_embedding dopo lo script embed_chunks.py.
CREATE INDEX IF NOT EXISTS idx_cert_chunks_embedding
  ON public.certificate_chunks
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Funzione RPC chiamata dall'Edge Function per la ricerca vettoriale
CREATE OR REPLACE FUNCTION match_certificate_chunks(
  query_embedding   vector(1536),
  match_count       int     DEFAULT 10,
  filter_has_table  boolean DEFAULT NULL
)
RETURNS TABLE (
  id         uuid,
  cert_id    uuid,
  section    text,
  content    text,
  has_table  boolean,
  similarity float
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    cc.id,
    cc.cert_id,
    cc.section,
    cc.content,
    cc.has_table,
    1 - (cc.embedding <=> query_embedding) AS similarity
  FROM public.certificate_chunks cc
  WHERE
    cc.embedding IS NOT NULL
    AND (filter_has_table IS NULL OR cc.has_table = filter_has_table)
  ORDER BY cc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
