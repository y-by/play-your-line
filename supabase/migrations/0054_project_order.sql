-- 0054 — each person arranges their own Projects list by dragging the cards.
--
--   user_project_order   one row per person and project: its position in THAT person's list (smaller = earlier).
--                        A person reads and writes only their own rows. Projects without a row come after the placed
--                        ones, newest first, as before. Nobody else's list is touched.
--
-- Safe to run more than once. The OWNER RUNS THIS in the Supabase SQL editor (after 0053).

create table if not exists user_project_order (
  user_id uuid not null references profiles(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  position integer not null,
  primary key (user_id, project_id)
);

alter table user_project_order enable row level security;
revoke all on user_project_order from anon, authenticated;
grant select, insert, update, delete on user_project_order to authenticated;

drop policy if exists "my own project order" on user_project_order;
create policy "my own project order" on user_project_order
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
