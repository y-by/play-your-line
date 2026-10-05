-- 0032 — notes for people working on a project to talk to each other:
--   * a note can be pinned to a beat (shown as a flag on the timeline), attached to a channel (optional),
--     marked done (which archives it), and optionally shared with listeners
--   * who writes and reads: the Owner, the Mixer and Players (anyone assigned to a channel).
--     Listeners read only the notes marked "shared with listeners" and cannot write.
--   * the author (or the Owner) edits or deletes a note; anyone who can write may mark it done.
--
-- Safe to run more than once.

create table if not exists project_notes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  author_id uuid not null references profiles(id),
  body text not null check (char_length(body) between 1 and 2000),
  at_beat double precision check (at_beat is null or at_beat >= 0),
  track_id uuid references tracks(id) on delete set null,
  shared_with_listeners boolean not null default false,
  done boolean not null default false,
  done_by uuid references profiles(id),
  done_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists project_notes_project_idx on project_notes (project_id, created_at);

alter table project_notes enable row level security;
grant select, insert, update, delete on public.project_notes to authenticated;

-- Owner, Mixer, or a Player (assigned to a channel in this project).
create or replace function can_write_notes(p_project_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from projects where id = p_project_id and (initiator_id = p_user_id or mixer_id = p_user_id)
  ) or exists (
    select 1 from tracks where project_id = p_project_id and assigned_user_id = p_user_id
  );
$$;

revoke execute on function can_write_notes(uuid, uuid) from public, anon;
grant execute on function can_write_notes(uuid, uuid) to authenticated;

drop policy if exists "writers read notes, listeners read the shared ones" on project_notes;
create policy "writers read notes, listeners read the shared ones" on project_notes
  for select using (
    can_write_notes(project_id, auth.uid())
    or (shared_with_listeners and is_project_participant(project_id, auth.uid()))
  );

drop policy if exists "writers add notes as themselves" on project_notes;
create policy "writers add notes as themselves" on project_notes
  for insert with check (author_id = auth.uid() and can_write_notes(project_id, auth.uid()));

drop policy if exists "writers update notes" on project_notes;
create policy "writers update notes" on project_notes
  for update using (can_write_notes(project_id, auth.uid())) with check (can_write_notes(project_id, auth.uid()));

drop policy if exists "author or owner deletes a note" on project_notes;
create policy "author or owner deletes a note" on project_notes
  for delete using (
    author_id = auth.uid()
    or exists (select 1 from projects p where p.id = project_notes.project_id and p.initiator_id = auth.uid())
  );

-- Only the author or the Owner may change what a note says, where it is pinned, or who sees it;
-- everyone else who can write may only mark it done / reopen it. Done-by and done-at are filled in here.
create or replace function guard_project_notes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_owner boolean;
begin
  if new.project_id is distinct from old.project_id or new.author_id is distinct from old.author_id then
    raise exception 'A note cannot change its project or author.';
  end if;

  if auth.uid() is not null then
    select p.initiator_id = auth.uid() into v_is_owner from projects p where p.id = old.project_id;
    if old.author_id <> auth.uid() and not coalesce(v_is_owner, false) then
      if new.body is distinct from old.body
         or new.at_beat is distinct from old.at_beat
         or new.track_id is distinct from old.track_id
         or new.shared_with_listeners is distinct from old.shared_with_listeners then
        raise exception 'Only the author or the owner can edit a note.';
      end if;
    end if;
  end if;

  if new.done is distinct from old.done then
    new.done_by := case when new.done then auth.uid() else null end;
    new.done_at := case when new.done then now() else null end;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists project_notes_guard on project_notes;
create trigger project_notes_guard
  before update on project_notes
  for each row execute function guard_project_notes();

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'project_notes'
  ) then
    alter publication supabase_realtime add table public.project_notes;
  end if;
end $$;
