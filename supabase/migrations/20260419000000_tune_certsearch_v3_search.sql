drop function if exists public.rag_v3_match_chunks(text, integer, text, text[], boolean, boolean);
drop function if exists public.rag_v3_search_chunks(text, text, integer, text, text[], text[], boolean, boolean);

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
  document_title text,
  document_kind text,
  issue_date date,
  manufacturer_code text,
  source_type text,
  evidence_level text,
  section text,
  page_start integer,
  page_end integer,
  products text[],
  product_families text[],
  fire_classes text[],
  supports text[],
  penetration_types text[],
  dimensions text[],
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
    d.title as document_title,
    d.document_kind,
    d.issue_date,
    c.manufacturer_code,
    c.source_type,
    c.evidence_level,
    c.section,
    c.page_start,
    c.page_end,
    c.products,
    c.product_families,
    c.fire_classes,
    c.supports,
    c.penetration_types,
    c.dimensions,
    c.has_table,
    c.content,
    c.content_markdown,
    case
      when qe.embedding is null or c.embedding is null then 0::double precision
      else greatest(0::double precision, 1 - (c.embedding <=> qe.embedding))
    end as vector_score
  from public.rag_chunks c
  join public.rag_documents d on d.id = c.document_id
  cross join query_embedding qe
  where (filter_manufacturer is null or c.manufacturer_code = filter_manufacturer)
    and (filter_source_types is null or c.source_type = any(filter_source_types))
    and (not filter_primary_only or c.evidence_level = 'primary')
    and (filter_has_table is null or c.has_table = filter_has_table)
  order by vector_score desc, d.issue_date desc nulls last, c.updated_at desc
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
  document_title text,
  document_kind text,
  issue_date date,
  manufacturer_code text,
  source_type text,
  evidence_level text,
  section text,
  page_start integer,
  page_end integer,
  products text[],
  product_families text[],
  fire_classes text[],
  supports text[],
  penetration_types text[],
  dimensions text[],
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
    d.title as document_title,
    d.document_kind,
    d.issue_date,
    c.manufacturer_code,
    c.source_type,
    c.evidence_level,
    c.section,
    c.page_start,
    c.page_end,
    c.products,
    c.product_families,
    c.fire_classes,
    c.supports,
    c.penetration_types,
    c.dimensions,
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
      end * 0.42) +
      (case
        when qe.embedding is null or c.embedding is null then 0::double precision
        else greatest(0::double precision, 1 - (c.embedding <=> qe.embedding))
      end * 0.36) +
      (case when c.evidence_level = 'primary' then 0.1 else 0 end) +
      (case when filter_manufacturer is not null and c.manufacturer_code = filter_manufacturer then 0.12 else 0 end) +
      (case
        when np.values is not null and exists (
          select 1
          from unnest(coalesce(c.products, '{}') || coalesce(c.product_families, '{}')) as product_term
          join unnest(np.values) as filter_term
            on lower(product_term) like '%' || filter_term || '%'
        ) then 0.14
        else 0
      end) +
      (case when filter_has_table is true and c.has_table then 0.05 else 0 end) +
      (case when c.source_type = 'certificate' then 0.05 else 0 end) +
      (case when d.document_kind in ('eta', 'classification_report') then 0.04 else 0 end)
    ) as fused_score
  from public.rag_chunks c
  join public.rag_documents d on d.id = c.document_id
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
      or c.fire_classes && regexp_split_to_array(lower(coalesce(query_text, '')), E'\\s+')
      or c.supports && regexp_split_to_array(lower(coalesce(query_text, '')), E'\\s+')
      or c.penetration_types && regexp_split_to_array(lower(coalesce(query_text, '')), E'\\s+')
    )
  order by fused_score desc, d.issue_date desc nulls last, c.updated_at desc
  limit greatest(match_count, 1);
$$;
