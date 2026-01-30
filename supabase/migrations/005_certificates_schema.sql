-- FPS: Fire Prevention Search - Certificate tables
-- Stores metadata for ingested fire safety certificates and their chunks

create table if not exists certificates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  version text,
  pages int,
  file_path text,
  uploaded_at timestamp with time zone default now()
);

create table if not exists certificate_chunks (
  id uuid primary key default gen_random_uuid(),
  cert_id uuid references certificates(id) on delete cascade,
  section text,
  content text,
  chunk_index int,
  has_table boolean default false,
  created_at timestamp with time zone default now()
);

create table if not exists certificate_rules (
  id uuid primary key default gen_random_uuid(),
  cert_id uuid references certificates(id) on delete cascade,
  summary text,
  conditions jsonb,
  result jsonb,
  pages int[]
);

create index idx_chunks_cert_id on certificate_chunks(cert_id);
create index idx_rules_cert_id on certificate_rules(cert_id);
