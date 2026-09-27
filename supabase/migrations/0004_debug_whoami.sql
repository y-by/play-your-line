-- Temporary diagnostic — safe to leave, but only used for troubleshooting.
-- Lets the client ask Postgres "who do you think I am?" for the exact
-- request it just sent, to isolate whether auth.uid() is resolving
-- correctly server-side.
create or replace function debug_whoami()
returns table (uid uuid, role_name text)
language sql
security definer
set search_path = public
as $$
  select auth.uid(), auth.role();
$$;

grant execute on function debug_whoami() to authenticated, anon;
