-- 0058 — song sections: named marks on the timeline (Intro, Verse, Chorus, Bridge, Part C, ...).
--
-- A section is a mark at a place in the song (counted in beats, normally the first beat of a bar) with a name and a colour.
-- It lasts until the next mark; the last one runs to the end of the song. Everyone in the project sees them; only the Owner and
-- the Mixer add, rename, move or delete them (decided with the owner, 2026-10-24).
--
--   * table song_sections   one row per mark; at most one mark at the same place in a project
--   * beats_per_bar         a number of beats in a bar for this section only. NOT USED YET: it is here so that a different time
--                           signature for each section (the owner's plan) needs no new migration. Leave it empty.
--   * policies              read: everyone in the project (and the system owner); write: Owner and Mixer only; a blocked
--                           account does nothing (0046)
--   * live                  added to Realtime, so everyone's timeline updates at once
--
-- Safe to run more than once. The OWNER RUNS THIS in the Supabase SQL editor (needs 0046).

begin;

create table if not exists song_sections (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  color text not null check (color ~ '^#[0-9a-fA-F]{6}$'),
  at_beat numeric not null check (at_beat >= 0 and at_beat < 100000),
  beats_per_bar smallint check (beats_per_bar is null or beats_per_bar between 1 and 16),
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- One mark per place: two sections never start at the same beat.
create unique index if not exists song_sections_place_idx on song_sections (project_id, at_beat);

alter table song_sections enable row level security;
revoke all on song_sections from anon, authenticated;
grant select, insert, update, delete on song_sections to authenticated;

-- Who may change the sections: the Owner and the Mixer of the project.
create or replace function can_edit_sections(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from projects p
    where p.id = p_project_id and auth.uid() is not null and (p.initiator_id = auth.uid() or p.mixer_id = auth.uid())
  );
$$;

revoke execute on function can_edit_sections(uuid) from public, anon;
grant execute on function can_edit_sections(uuid) to authenticated;

drop policy if exists "people in the project read its sections" on song_sections;
create policy "people in the project read its sections" on song_sections
  for select to authenticated using (is_project_participant(project_id, (select auth.uid())) or (select is_admin()));

drop policy if exists "owner and mixer add sections" on song_sections;
create policy "owner and mixer add sections" on song_sections
  for insert to authenticated with check (can_edit_sections(project_id));

drop policy if exists "owner and mixer change sections" on song_sections;
create policy "owner and mixer change sections" on song_sections
  for update to authenticated using (can_edit_sections(project_id)) with check (can_edit_sections(project_id));

drop policy if exists "owner and mixer delete sections" on song_sections;
create policy "owner and mixer delete sections" on song_sections
  for delete to authenticated using (can_edit_sections(project_id));

drop policy if exists "blocked people do nothing" on song_sections;
create policy "blocked people do nothing" on song_sections as restrictive
  for all to authenticated using (not (select is_blocked())) with check (not (select is_blocked()));

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'song_sections') then
    alter publication supabase_realtime add table public.song_sections;
  end if;
end $$;

commit;

-- Check: select count(*) from song_sections;  (0 until someone adds a section)
