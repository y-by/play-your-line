-- Baseline table-level access for signed-in users.
--
-- RLS policies (0001_init.sql) control which *rows* a query can see/touch,
-- but Postgres also requires a coarser table-level GRANT before it will even
-- attempt the query — normally set up automatically for tables created
-- through the Supabase dashboard, but not guaranteed for tables created via
-- the SQL editor. Without this, every request is rejected before RLS ever
-- runs, regardless of policy correctness.
--
-- The "anon" role (fully unauthenticated) intentionally gets nothing here —
-- everything in this app requires being signed in, per the RLS design.

grant usage on schema public to authenticated;

grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.projects to authenticated;
grant select, insert, update, delete on public.tracks to authenticated;
grant select, insert, update, delete on public.takes to authenticated;
grant select, insert, update, delete on public.track_invites to authenticated;
