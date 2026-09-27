-- 0014 — roles: Owner, Mixer, Player, Listener.
--
--   Owner     the song's initiator. All the superpowers, including publishing.
--   Mixer     one person (optional) who may set the FINAL mix: channel volume
--             and mute. Cannot touch clips, order, colours or publish.
--   Player    whoever is assigned to a channel (unchanged).
--   Listener  invited to hear a draft; can play it, nothing else.
--
-- Mixers and listeners join through an invite link (like players do), or the
-- Owner picks an existing participant as Mixer. Nobody can be given a role by
-- editing rows directly — only through the functions below.
--
-- Safe to run more than once.

begin;

-- 1. Who is who -----------------------------------------------------------

alter table projects add column if not exists mixer_id uuid references profiles(id) on delete set null;

create table if not exists project_listeners (
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create table if not exists project_invites (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  role text not null check (role in ('mixer', 'listener')),
  token uuid not null unique default gen_random_uuid(),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  created_by uuid not null references profiles(id),
  claimed_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

alter table project_listeners enable row level security;
alter table project_invites enable row level security;
grant select, insert, update, delete on public.project_listeners to authenticated;
grant select, insert, update, delete on public.project_invites to authenticated;

-- Anyone who takes part in the song may see who the listeners are.
-- (is_project_participant is SECURITY DEFINER, so this cannot loop.)
create or replace function is_project_participant(p_project_id uuid, p_user_id uuid)
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
  ) or exists (
    select 1 from project_listeners where project_id = p_project_id and user_id = p_user_id
  );
$$;

drop policy if exists "participants see the listeners" on project_listeners;
create policy "participants see the listeners" on project_listeners
  for select using (is_project_participant(project_id, auth.uid()));

-- The Owner removes a listener; a listener may leave.
drop policy if exists "owner removes a listener or they leave" on project_listeners;
create policy "owner removes a listener or they leave" on project_listeners
  for delete using (
    user_id = auth.uid()
    or exists (select 1 from projects p where p.id = project_listeners.project_id and p.initiator_id = auth.uid())
  );

-- Role invites: an invite link is a bearer token, like track invites.
drop policy if exists "only the owner sees and sends role invites" on project_invites;
create policy "only the owner sees and sends role invites" on project_invites
  for select using (
    exists (select 1 from projects p where p.id = project_invites.project_id and p.initiator_id = auth.uid())
  );

drop policy if exists "only the owner creates role invites" on project_invites;
create policy "only the owner creates role invites" on project_invites
  for insert with check (
    created_by = auth.uid()
    and exists (select 1 from projects p where p.id = project_invites.project_id and p.initiator_id = auth.uid())
  );

drop policy if exists "only the owner revokes role invites" on project_invites;
create policy "only the owner revokes role invites" on project_invites
  for delete using (
    exists (select 1 from projects p where p.id = project_invites.project_id and p.initiator_id = auth.uid())
  );

-- 2. The mixer changes only through functions ----------------------------------

create or replace function guard_mixer_change()
returns trigger
language plpgsql
as $$
begin
  if new.mixer_id is distinct from old.mixer_id
     and coalesce(current_setting('pyl.assign_via_rpc', true), '') <> 'on' then
    raise exception 'The mixer can only be set through an invite or by the owner picking a participant.';
  end if;
  return new;
end;
$$;

drop trigger if exists projects_guard_mixer on projects;
create trigger projects_guard_mixer
  before update on projects
  for each row execute function guard_mixer_change();

-- Owner picks (or clears) the mixer. The person must already be in the song.
create or replace function set_mixer(p_project_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from projects where id = p_project_id and initiator_id = auth.uid()) then
    raise exception 'Only the owner can choose the mixer.';
  end if;

  if p_user_id is not null
     and p_user_id <> auth.uid()
     and not is_project_participant(p_project_id, p_user_id) then
    raise exception 'That person is not part of this song yet — invite them first.';
  end if;

  perform set_config('pyl.assign_via_rpc', 'on', true);
  update projects set mixer_id = p_user_id where id = p_project_id;
end;
$$;

grant execute on function set_mixer(uuid, uuid) to authenticated;

-- Preview a role invite (works signed-out, so the landing page can explain it).
create or replace function get_project_invite_details(p_token uuid)
returns table (project_id uuid, project_title text, role text, invite_status text)
language sql
security definer
set search_path = public
as $$
  select p.id, p.title, i.role, i.status
  from project_invites i
  join projects p on p.id = i.project_id
  where i.token = p_token;
$$;

grant execute on function get_project_invite_details(uuid) to authenticated, anon;

-- Accept a role invite. Only for a pending invite, and only for the caller.
create or replace function accept_project_invite(p_token uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
  v_role text;
  v_status text;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;

  select project_id, role, status into v_project_id, v_role, v_status
  from project_invites
  where token = p_token
  for update;

  if v_project_id is null then
    raise exception 'Invite not found';
  end if;
  if v_status <> 'pending' then
    raise exception 'Invite is no longer available';
  end if;

  if v_role = 'mixer' then
    if exists (select 1 from projects where id = v_project_id and mixer_id is not null and mixer_id <> auth.uid()) then
      raise exception 'This song already has a mixer.';
    end if;
    perform set_config('pyl.assign_via_rpc', 'on', true);
    update projects set mixer_id = auth.uid() where id = v_project_id;
  else
    insert into project_listeners (project_id, user_id)
    values (v_project_id, auth.uid())
    on conflict do nothing;
  end if;

  update project_invites set status = 'accepted', claimed_by = auth.uid() where token = p_token;
  return v_project_id;
end;
$$;

grant execute on function accept_project_invite(uuid) to authenticated;

-- 3. The mix: Owner or Mixer -------------------------------------------------------

drop policy if exists "only the initiator edits the mix" on tracks;
drop policy if exists "owner or mixer edits the track" on tracks;

create policy "owner or mixer edits the track" on tracks
  for update
  using (
    exists (
      select 1 from projects p
      where p.id = tracks.project_id and (p.initiator_id = auth.uid() or p.mixer_id = auth.uid())
    )
  );

-- A mixer may change only volume and mute — not the channel's name, colour or
-- place. (Handing a channel to a player through an invite only changes the
-- assignee, which is allowed for anyone.)
create or replace function guard_track_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.project_id is distinct from old.project_id then
    raise exception 'A channel cannot move to another song.';
  end if;
  -- (Changes made from the SQL editor have no signed-in user and are left alone.)
  if auth.uid() is not null
     and not exists (select 1 from projects p where p.id = old.project_id and p.initiator_id = auth.uid()) then
    if new.instrument is distinct from old.instrument
       or new.color is distinct from old.color
       or new.position is distinct from old.position then
      raise exception 'Only the owner can change a channel''s name, colour or place.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists tracks_guard_columns on tracks;
create trigger tracks_guard_columns
  before update on tracks
  for each row execute function guard_track_columns();

-- 4. Live updates for listeners ---------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'project_listeners'
  ) then
    alter publication supabase_realtime add table public.project_listeners;
  end if;
end $$;

commit;
