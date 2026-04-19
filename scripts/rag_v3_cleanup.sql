-- Cleanup finale solo dopo validazione completa della v3.
-- Eseguire soltanto dopo backup verificato e cutover confermato.
-- Il backup usa un suffisso timestamp per evitare snapshot stantii o riuso involontario.

do $$
declare
  backup_suffix text := to_char(now(), 'YYYYMMDD_HH24MISS');
begin
  if to_regclass('public.certificates') is not null then
    execute format(
      'create table public.certificates_legacy_backup_%s as select * from public.certificates',
      backup_suffix
    );
  end if;

  if to_regclass('public.certificate_chunks') is not null then
    execute format(
      'create table public.certificate_chunks_legacy_backup_%s as select * from public.certificate_chunks',
      backup_suffix
    );
  end if;
end;
$$;

drop function if exists public.match_certificate_chunks(vector, int, boolean);
drop function if exists public.hybrid_search_chunks;
drop table if exists public.certificate_chunks;
drop table if exists public.certificates;
