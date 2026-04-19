create extension if not exists "uuid-ossp";
create extension if not exists pg_trgm;
create extension if not exists vector with schema extensions;

create table if not exists public.manufacturers (
  code text primary key,
  name text not null,
  aliases text[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rag_documents (
  id uuid primary key default extensions.uuid_generate_v4(),
  manufacturer_code text not null references public.manufacturers(code) on delete restrict,
  source_type text not null check (source_type in ('certificate', 'manual')),
  evidence_level text not null check (evidence_level in ('primary', 'secondary')),
  document_kind text not null default 'other' check (
    document_kind in ('eta', 'classification_report', 'test_report', 'technical_report', 'manual', 'other')
  ),
  title text not null,
  issuer text,
  issue_date date,
  file_path text not null,
  version_tag text,
  status text not null default 'draft' check (status in ('draft', 'ready', 'archived', 'error')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (manufacturer_code, file_path)
);

create table if not exists public.rag_chunks (
  id uuid primary key default extensions.uuid_generate_v4(),
  document_id uuid not null references public.rag_documents(id) on delete cascade,
  manufacturer_code text not null references public.manufacturers(code) on delete restrict,
  source_type text not null check (source_type in ('certificate', 'manual')),
  evidence_level text not null check (evidence_level in ('primary', 'secondary')),
  section text,
  section_path text[] not null default '{}',
  chunk_kind text not null check (chunk_kind in ('section_chunk', 'table_chunk', 'table_row_chunk')),
  content text not null,
  content_markdown text,
  has_table boolean not null default false,
  page_start integer,
  page_end integer,
  products text[] not null default '{}',
  product_families text[] not null default '{}',
  fire_classes text[] not null default '{}',
  supports text[] not null default '{}',
  penetration_types text[] not null default '{}',
  dimensions text[] not null default '{}',
  cross_refs text[] not null default '{}',
  content_hash text not null unique,
  content_tsv tsvector not null default ''::tsvector,
  embedding extensions.vector(1536),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.manufacturer_lexicon (
  id uuid primary key default extensions.uuid_generate_v4(),
  manufacturer_code text not null references public.manufacturers(code) on delete cascade,
  term text not null,
  normalized_term text not null,
  term_type text not null check (
    term_type in ('brand', 'alias', 'product', 'product_family', 'synonym', 'fire_class', 'support', 'penetration', 'dimension', 'manual_keyword')
  ),
  source_document_id uuid not null references public.rag_documents(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (manufacturer_code, normalized_term, term_type, source_document_id)
);

create table if not exists public.rag_eval_runs (
  id uuid primary key default extensions.uuid_generate_v4(),
  query_set_name text not null,
  notes text,
  retrieval_strategy text not null default 'hybrid_v1',
  metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.rag_eval_results (
  id uuid primary key default extensions.uuid_generate_v4(),
  run_id uuid not null references public.rag_eval_runs(id) on delete cascade,
  query text not null,
  manufacturer_code text references public.manufacturers(code) on delete set null,
  expected_document_ids uuid[] not null default '{}',
  expected_products text[] not null default '{}',
  retrieved_chunk_ids uuid[] not null default '{}',
  retrieved_document_ids uuid[] not null default '{}',
  metrics jsonb not null default '{}'::jsonb,
  answer text,
  citations jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_manufacturers_active on public.manufacturers(is_active);
create index if not exists idx_manufacturers_aliases on public.manufacturers using gin(aliases);

create index if not exists idx_rag_documents_manufacturer on public.rag_documents(manufacturer_code);
create index if not exists idx_rag_documents_source_type on public.rag_documents(source_type);
create index if not exists idx_rag_documents_evidence_level on public.rag_documents(evidence_level);
create index if not exists idx_rag_documents_issue_date on public.rag_documents(issue_date desc);
create index if not exists idx_rag_documents_metadata on public.rag_documents using gin(metadata jsonb_path_ops);

create index if not exists idx_rag_chunks_document on public.rag_chunks(document_id);
create index if not exists idx_rag_chunks_manufacturer on public.rag_chunks(manufacturer_code);
create index if not exists idx_rag_chunks_source_type on public.rag_chunks(source_type);
create index if not exists idx_rag_chunks_evidence_level on public.rag_chunks(evidence_level);
create index if not exists idx_rag_chunks_has_table on public.rag_chunks(has_table);
create index if not exists idx_rag_chunks_pages on public.rag_chunks(page_start, page_end);
create index if not exists idx_rag_chunks_tsv on public.rag_chunks using gin(content_tsv);
create index if not exists idx_rag_chunks_products on public.rag_chunks using gin(products);
create index if not exists idx_rag_chunks_product_families on public.rag_chunks using gin(product_families);
create index if not exists idx_rag_chunks_fire_classes on public.rag_chunks using gin(fire_classes);
create index if not exists idx_rag_chunks_supports on public.rag_chunks using gin(supports);
create index if not exists idx_rag_chunks_penetration_types on public.rag_chunks using gin(penetration_types);
create index if not exists idx_rag_chunks_dimensions on public.rag_chunks using gin(dimensions);
create index if not exists idx_rag_chunks_cross_refs on public.rag_chunks using gin(cross_refs);
create index if not exists idx_rag_chunks_metadata on public.rag_chunks using gin(metadata jsonb_path_ops);
create index if not exists idx_rag_chunks_embedding on public.rag_chunks using ivfflat (embedding extensions.vector_cosine_ops) with (lists = 100);

create index if not exists idx_manufacturer_lexicon_manufacturer on public.manufacturer_lexicon(manufacturer_code);
create index if not exists idx_manufacturer_lexicon_normalized on public.manufacturer_lexicon(normalized_term);
create index if not exists idx_manufacturer_lexicon_term_type on public.manufacturer_lexicon(term_type);
create index if not exists idx_manufacturer_lexicon_document on public.manufacturer_lexicon(source_document_id);

create index if not exists idx_rag_eval_results_run on public.rag_eval_results(run_id);
create index if not exists idx_rag_eval_results_manufacturer on public.rag_eval_results(manufacturer_code);

alter table public.manufacturers enable row level security;
alter table public.rag_documents enable row level security;
alter table public.rag_chunks enable row level security;
alter table public.manufacturer_lexicon enable row level security;
alter table public.rag_eval_runs enable row level security;
alter table public.rag_eval_results enable row level security;

create or replace function public.rag_chunks_refresh_tsv()
returns trigger
language plpgsql
as $$
begin
  new.content_tsv :=
    setweight(to_tsvector('simple', coalesce(array_to_string(new.products, ' '), '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(array_to_string(new.product_families, ' '), '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(array_to_string(new.fire_classes, ' '), '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(new.section, '')), 'B') ||
    setweight(
      to_tsvector(
        'simple',
        regexp_replace(coalesce(new.content_markdown, new.content, ''), E'\\s+', ' ', 'g')
      ),
      'D'
    );
  return new;
end;
$$;

drop trigger if exists update_manufacturers_updated_at on public.manufacturers;
create trigger update_manufacturers_updated_at
before update on public.manufacturers
for each row execute function update_updated_at_column();

drop trigger if exists update_rag_documents_updated_at on public.rag_documents;
create trigger update_rag_documents_updated_at
before update on public.rag_documents
for each row execute function update_updated_at_column();

drop trigger if exists update_rag_chunks_updated_at on public.rag_chunks;
create trigger update_rag_chunks_updated_at
before update on public.rag_chunks
for each row execute function update_updated_at_column();

drop trigger if exists rag_chunks_refresh_tsv_trigger on public.rag_chunks;
create trigger rag_chunks_refresh_tsv_trigger
before insert or update on public.rag_chunks
for each row execute function public.rag_chunks_refresh_tsv();

insert into public.manufacturers (code, name, aliases, is_active)
values
  ('AF_SYSTEMS', 'AF Systems', array['af systems', 'af-systems', 'af'], true),
  ('PROMAT', 'Promat', array['promat'], true),
  ('HILTI', 'Hilti', array['hilti'], true),
  ('GLOBAL_BUILDING', 'Global Building', array['global building', 'globalbuilding'], true)
on conflict (code) do update
set
  name = excluded.name,
  aliases = excluded.aliases,
  is_active = excluded.is_active,
  updated_at = now();

create or replace function public.rag_v3_system_overview()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  pgvector_version text;
  legacy_certificates_count bigint := 0;
  legacy_chunks_count bigint := 0;
  legacy_embedding_dimensions integer := 0;
  v3_embedding_dimensions integer := 0;
begin
  select extversion into pgvector_version
  from pg_extension
  where extname = 'vector';

  if to_regclass('public.certificates') is not null then
    execute 'select count(*) from public.certificates' into legacy_certificates_count;
  end if;

  if to_regclass('public.certificate_chunks') is not null then
    execute 'select count(*) from public.certificate_chunks' into legacy_chunks_count;
    begin
      execute 'select coalesce(max(vector_dims(embedding)), 0) from public.certificate_chunks where embedding is not null'
      into legacy_embedding_dimensions;
    exception when undefined_function then
      legacy_embedding_dimensions := 0;
    end;
  end if;

  begin
    select coalesce(max(vector_dims(embedding)), 0)
    into v3_embedding_dimensions
    from public.rag_chunks
    where embedding is not null;
  exception when undefined_function then
    v3_embedding_dimensions := 0;
  end;

  return jsonb_build_object(
    'pgvectorVersion', coalesce(pgvector_version, 'missing'),
    'legacy', jsonb_build_object(
      'certificates', legacy_certificates_count,
      'certificateChunks', legacy_chunks_count,
      'embeddingDimensions', legacy_embedding_dimensions,
      'matchCertificateChunksExists', exists(
        select 1
        from pg_proc proc
        join pg_namespace ns on ns.oid = proc.pronamespace
        where ns.nspname = 'public' and proc.proname = 'match_certificate_chunks'
      ),
      'hybridSearchChunksExists', exists(
        select 1
        from pg_proc proc
        join pg_namespace ns on ns.oid = proc.pronamespace
        where ns.nspname = 'public' and proc.proname = 'hybrid_search_chunks'
      )
    ),
    'v3', jsonb_build_object(
      'manufacturers', (select count(*) from public.manufacturers),
      'documents', (select count(*) from public.rag_documents),
      'chunks', (select count(*) from public.rag_chunks),
      'embeddingDimensions', v3_embedding_dimensions
    )
  );
end;
$$;

create or replace function public.rag_v3_upsert_chunk_embedding(
  target_chunk_id uuid,
  embedding_text text
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  update public.rag_chunks
  set embedding = embedding_text::extensions.vector(1536),
      updated_at = now()
  where id = target_chunk_id;
end;
$$;

create or replace function public.rag_v3_match_chunks(
  query_embedding_text text,
  match_count integer default 24,
  filter_manufacturer text default null,
  filter_source_types text[] default null,
  filter_primary_only boolean default false,
  filter_has_table boolean default null
)
returns table (
  chunk_id uuid,
  document_id uuid,
  manufacturer_code text,
  source_type text,
  evidence_level text,
  section text,
  page_start integer,
  page_end integer,
  products text[],
  product_families text[],
  fire_classes text[],
  has_table boolean,
  content text,
  content_markdown text,
  vector_score double precision
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with query_embedding as (
    select
      case
        when query_embedding_text is null or btrim(query_embedding_text) = '' then null
        else query_embedding_text::extensions.vector(1536)
      end as embedding
  )
  select
    c.id as chunk_id,
    c.document_id,
    c.manufacturer_code,
    c.source_type,
    c.evidence_level,
    c.section,
    c.page_start,
    c.page_end,
    c.products,
    c.product_families,
    c.fire_classes,
    c.has_table,
    c.content,
    c.content_markdown,
    case
      when qe.embedding is null or c.embedding is null then 0::double precision
      else greatest(0::double precision, 1 - (c.embedding <=> qe.embedding))
    end as vector_score
  from public.rag_chunks c
  cross join query_embedding qe
  where (filter_manufacturer is null or c.manufacturer_code = filter_manufacturer)
    and (filter_source_types is null or c.source_type = any(filter_source_types))
    and (not filter_primary_only or c.evidence_level = 'primary')
    and (filter_has_table is null or c.has_table = filter_has_table)
  order by vector_score desc, c.updated_at desc
  limit greatest(match_count, 1);
$$;

create or replace function public.rag_v3_search_chunks(
  query_text text,
  query_embedding_text text default null,
  match_count integer default 24,
  filter_manufacturer text default null,
  filter_products text[] default null,
  filter_source_types text[] default null,
  filter_primary_only boolean default false,
  filter_has_table boolean default null
)
returns table (
  chunk_id uuid,
  document_id uuid,
  manufacturer_code text,
  source_type text,
  evidence_level text,
  section text,
  page_start integer,
  page_end integer,
  products text[],
  product_families text[],
  fire_classes text[],
  has_table boolean,
  content text,
  content_markdown text,
  lexical_score double precision,
  vector_score double precision,
  fused_score double precision
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with normalized_query as (
    select coalesce(nullif(btrim(query_text), ''), '') as text_query
  ),
  normalized_products as (
    select case
      when filter_products is null then null
      else array(
        select lower(btrim(value))
        from unnest(filter_products) as value
        where btrim(value) <> ''
      )
    end as values
  ),
  query_embedding as (
    select
      case
        when query_embedding_text is null or btrim(query_embedding_text) = '' then null
        else query_embedding_text::extensions.vector(1536)
      end as embedding
  ),
  ts_query as (
    select
      case
        when nq.text_query = '' then null
        else websearch_to_tsquery('simple', nq.text_query)
      end as tsq
    from normalized_query nq
  )
  select
    c.id as chunk_id,
    c.document_id,
    c.manufacturer_code,
    c.source_type,
    c.evidence_level,
    c.section,
    c.page_start,
    c.page_end,
    c.products,
    c.product_families,
    c.fire_classes,
    c.has_table,
    c.content,
    c.content_markdown,
    case
      when ts.tsq is null then 0::double precision
      else ts_rank_cd(c.content_tsv, ts.tsq)::double precision
    end as lexical_score,
    case
      when qe.embedding is null or c.embedding is null then 0::double precision
      else greatest(0::double precision, 1 - (c.embedding <=> qe.embedding))
    end as vector_score,
    (
      (case
        when ts.tsq is null then 0::double precision
        else ts_rank_cd(c.content_tsv, ts.tsq)::double precision
      end * 0.45) +
      (case
        when qe.embedding is null or c.embedding is null then 0::double precision
        else greatest(0::double precision, 1 - (c.embedding <=> qe.embedding))
      end * 0.4) +
      (case when c.evidence_level = 'primary' then 0.08 else 0 end) +
      (case when filter_manufacturer is not null and c.manufacturer_code = filter_manufacturer then 0.12 else 0 end) +
      (case
        when np.values is not null and exists (
          select 1
          from unnest(coalesce(c.products, '{}') || coalesce(c.product_families, '{}')) as product_term
          join unnest(np.values) as filter_term
            on lower(product_term) like '%' || filter_term || '%'
        ) then 0.12
        else 0
      end) +
      (case when filter_has_table is true and c.has_table then 0.05 else 0 end) +
      (case when c.source_type = 'certificate' then 0.04 else 0 end)
    ) as fused_score
  from public.rag_chunks c
  cross join query_embedding qe
  cross join ts_query ts
  cross join normalized_products np
  where (filter_manufacturer is null or c.manufacturer_code = filter_manufacturer)
    and (
      np.values is null
      or exists (
        select 1
        from unnest(coalesce(c.products, '{}') || coalesce(c.product_families, '{}')) as product_term
        join unnest(np.values) as filter_term
          on lower(product_term) like '%' || filter_term || '%'
      )
    )
    and (filter_source_types is null or c.source_type = any(filter_source_types))
    and (not filter_primary_only or c.evidence_level = 'primary')
    and (filter_has_table is null or c.has_table = filter_has_table)
    and (
      ts.tsq is null
      or c.content_tsv @@ ts.tsq
      or c.products && regexp_split_to_array(lower(coalesce(query_text, '')), E'\\s+')
      or c.product_families && regexp_split_to_array(lower(coalesce(query_text, '')), E'\\s+')
    )
  order by fused_score desc, c.updated_at desc
  limit greatest(match_count, 1);
$$;
