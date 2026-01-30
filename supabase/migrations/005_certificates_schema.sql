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

create index if not exists idx_chunks_cert_id on certificate_chunks(cert_id);
create index if not exists idx_rules_cert_id on certificate_rules(cert_id);

-- Enable RLS
alter table certificates enable row level security;
alter table certificate_chunks enable row level security;
alter table certificate_rules enable row level security;

-- Policy: authenticated users can read all certificates
create policy "Authenticated users can read certificates"
  on certificates for select
  to authenticated
  using (true);

create policy "Authenticated users can read certificate_chunks"
  on certificate_chunks for select
  to authenticated
  using (true);

create policy "Authenticated users can read certificate_rules"
  on certificate_rules for select
  to authenticated
  using (true);

-- Policy: service_role can do everything (for ingestion script)
create policy "Service role full access on certificates"
  on certificates for all
  to service_role
  using (true)
  with check (true);

create policy "Service role full access on certificate_chunks"
  on certificate_chunks for all
  to service_role
  using (true)
  with check (true);

create policy "Service role full access on certificate_rules"
  on certificate_rules for all
  to service_role
  using (true)
  with check (true);
