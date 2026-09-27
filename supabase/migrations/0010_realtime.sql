-- 0010 — live updates. Lets the app hear about changes to a song as they
-- happen, so other people's channels, clips and tempo appear without a refresh.
-- Who receives what is still decided by the row-level security policies.
--
-- Safe to run more than once.

do $$
declare
  t text;
begin
  foreach t in array array['projects', 'tracks', 'clips'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
