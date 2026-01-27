-- Migration: Add Fire Seal Certificate Tables with pgvector
-- Description: Creates tables for storing fire seal certificates and their chunks with vector embeddings
-- Date: 2025-01-27

-- ============================================
-- ENABLE PGVECTOR EXTENSION
-- ============================================
-- Note: pgvector must be enabled in the Supabase dashboard first
-- Go to Database > Extensions > Enable "vector"
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================
-- CERTIFICATES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS public.certificates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  brand TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_url TEXT,  -- Supabase Storage URL
  file_size INTEGER NOT NULL,
  page_count INTEGER NOT NULL DEFAULT 0,
  structure_type TEXT NOT NULL DEFAULT 'generic'
    CHECK (structure_type IN ('promat_standard', 'af_systems_tabular', 'hilti_technical', 'global_building', 'generic')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  uploaded_by UUID NOT NULL REFERENCES public.profiles(id),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  processing_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (processing_status IN ('pending', 'processing', 'completed', 'error')),
  processing_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- CERTIFICATE CHUNKS TABLE (with vector)
-- ============================================
CREATE TABLE IF NOT EXISTS public.certificate_chunks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  certificate_id UUID NOT NULL REFERENCES public.certificates(id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL,
  chunk_index INTEGER NOT NULL DEFAULT 0,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  embedding vector(1536),  -- OpenAI text-embedding-3-small dimension
  embedding_model TEXT DEFAULT 'text-embedding-3-small',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT unique_chunk_hash UNIQUE (certificate_id, content_hash)
);

-- ============================================
-- INDEXES
-- ============================================

-- Certificates indexes
CREATE INDEX IF NOT EXISTS idx_certificates_brand ON public.certificates(brand);
CREATE INDEX IF NOT EXISTS idx_certificates_status ON public.certificates(processing_status);
CREATE INDEX IF NOT EXISTS idx_certificates_uploaded_by ON public.certificates(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_certificates_uploaded_at ON public.certificates(uploaded_at DESC);

-- Chunks indexes
CREATE INDEX IF NOT EXISTS idx_chunks_certificate ON public.certificate_chunks(certificate_id);
CREATE INDEX IF NOT EXISTS idx_chunks_page ON public.certificate_chunks(page_number);
CREATE INDEX IF NOT EXISTS idx_chunks_certificate_page ON public.certificate_chunks(certificate_id, page_number);

-- HNSW index for vector similarity search (faster than IVFFlat for most use cases)
-- m = 16: number of connections per layer (higher = more accurate but slower)
-- ef_construction = 64: size of dynamic candidate list during construction
CREATE INDEX IF NOT EXISTS idx_chunks_embedding ON public.certificate_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- GIN index for JSONB metadata queries
CREATE INDEX IF NOT EXISTS idx_chunks_metadata ON public.certificate_chunks USING gin (metadata);
CREATE INDEX IF NOT EXISTS idx_certificates_metadata ON public.certificates USING gin (metadata);

-- ============================================
-- VECTOR SEARCH FUNCTION
-- ============================================
CREATE OR REPLACE FUNCTION search_certificate_chunks(
  query_embedding vector(1536),
  match_count INT DEFAULT 10,
  filter_brand TEXT DEFAULT NULL,
  filter_rei TEXT DEFAULT NULL,
  filter_support TEXT DEFAULT NULL,
  filter_crossing TEXT DEFAULT NULL,
  min_similarity FLOAT DEFAULT 0.5
)
RETURNS TABLE (
  id UUID,
  certificate_id UUID,
  certificate_title TEXT,
  certificate_brand TEXT,
  page_number INT,
  chunk_index INT,
  content TEXT,
  metadata JSONB,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    cc.id,
    cc.certificate_id,
    c.title AS certificate_title,
    c.brand AS certificate_brand,
    cc.page_number,
    cc.chunk_index,
    cc.content,
    cc.metadata,
    1 - (cc.embedding <=> query_embedding) AS similarity
  FROM public.certificate_chunks cc
  JOIN public.certificates c ON cc.certificate_id = c.id
  WHERE
    c.processing_status = 'completed'
    AND cc.embedding IS NOT NULL
    AND (filter_brand IS NULL OR c.brand = filter_brand)
    AND (filter_rei IS NULL OR c.metadata->'reiValues' ? filter_rei OR cc.metadata->>'reiContext' = filter_rei)
    AND (filter_support IS NULL OR c.metadata->'supportTypes' ? filter_support OR cc.metadata->>'supportContext' = filter_support)
    AND (filter_crossing IS NULL OR c.metadata->'crossingTypes' ? filter_crossing OR cc.metadata->>'crossingContext' = filter_crossing)
    AND (1 - (cc.embedding <=> query_embedding)) >= min_similarity
  ORDER BY cc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- ============================================
-- GET CERTIFICATE WITH CHUNKS FUNCTION
-- ============================================
CREATE OR REPLACE FUNCTION get_certificate_with_chunks(cert_id UUID)
RETURNS TABLE (
  certificate JSONB,
  chunks JSONB
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    row_to_json(c.*)::jsonb AS certificate,
    COALESCE(
      (SELECT jsonb_agg(row_to_json(cc.*) ORDER BY cc.page_number, cc.chunk_index)
       FROM public.certificate_chunks cc
       WHERE cc.certificate_id = c.id),
      '[]'::jsonb
    ) AS chunks
  FROM public.certificates c
  WHERE c.id = cert_id;
END;
$$;

-- ============================================
-- TRIGGERS
-- ============================================

-- Update timestamp trigger for certificates
CREATE OR REPLACE FUNCTION update_certificates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_certificates_updated_at_trigger
  BEFORE UPDATE ON public.certificates
  FOR EACH ROW
  EXECUTE FUNCTION update_certificates_updated_at();

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================
ALTER TABLE public.certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.certificate_chunks ENABLE ROW LEVEL SECURITY;

-- Helper function to check if user is admin
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
    AND role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Certificates policies
-- Everyone can view completed certificates
CREATE POLICY "Anyone can view completed certificates"
  ON public.certificates FOR SELECT
  USING (processing_status = 'completed' OR uploaded_by = auth.uid() OR public.is_admin());

-- Only admins can insert certificates
CREATE POLICY "Only admins can insert certificates"
  ON public.certificates FOR INSERT
  WITH CHECK (public.is_admin());

-- Only admins can update certificates
CREATE POLICY "Only admins can update certificates"
  ON public.certificates FOR UPDATE
  USING (public.is_admin());

-- Only admins can delete certificates
CREATE POLICY "Only admins can delete certificates"
  ON public.certificates FOR DELETE
  USING (public.is_admin());

-- Chunks policies (same as certificates - controlled by certificate access)
CREATE POLICY "Anyone can view chunks of accessible certificates"
  ON public.certificate_chunks FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.certificates c
      WHERE c.id = certificate_id
      AND (c.processing_status = 'completed' OR c.uploaded_by = auth.uid() OR public.is_admin())
    )
  );

CREATE POLICY "Only admins can manage chunks"
  ON public.certificate_chunks FOR ALL
  USING (public.is_admin());

-- ============================================
-- STORAGE BUCKET FOR CERTIFICATE PDFs
-- ============================================
-- Note: Run this in Supabase SQL Editor or create bucket manually
-- INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
-- VALUES (
--   'certificates',
--   'certificates',
--   false,  -- Private bucket
--   52428800,  -- 50MB limit per file
--   ARRAY['application/pdf']
-- )
-- ON CONFLICT (id) DO NOTHING;

-- Storage policies (uncomment and run manually if needed)
-- CREATE POLICY "Anyone can view certificate PDFs"
--   ON storage.objects FOR SELECT
--   USING (bucket_id = 'certificates');

-- CREATE POLICY "Only admins can upload certificate PDFs"
--   ON storage.objects FOR INSERT
--   WITH CHECK (bucket_id = 'certificates' AND public.is_admin());

-- CREATE POLICY "Only admins can delete certificate PDFs"
--   ON storage.objects FOR DELETE
--   USING (bucket_id = 'certificates' AND public.is_admin());

-- ============================================
-- COMMENTS
-- ============================================
COMMENT ON TABLE public.certificates IS 'Fire seal certificate documents with metadata';
COMMENT ON TABLE public.certificate_chunks IS 'Text chunks extracted from certificates with vector embeddings for semantic search';
COMMENT ON FUNCTION search_certificate_chunks IS 'Performs semantic search over certificate chunks using cosine similarity';
COMMENT ON FUNCTION get_certificate_with_chunks IS 'Retrieves a certificate with all its chunks';
