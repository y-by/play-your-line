-- 0053 — project-card news: a notice also shows on that project's card in the Projects list, highlighted until the
-- person opens the project. This is separate from the popup (seen_at), which is closed as soon as it is read.
--
-- Safe to run more than once. The OWNER RUNS THIS in the Supabase SQL editor (after 0052).

alter table user_notices add column if not exists card_cleared_at timestamptz;
grant update (card_cleared_at) on user_notices to authenticated;
