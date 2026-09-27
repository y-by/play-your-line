-- Play Your Line — core schema + row-level security.
--
-- This is the real permission enforcement layer: the app's UI hides controls
-- the current user shouldn't see, but these policies are what actually stop
-- someone from editing another player's track or publishing a song they
-- didn't start, even if they call the Supabase API directly.

create extension if not exists pgcrypto;

-- One row per signed-in user, auto-populated from their Google profile.
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now()
);

create table projects (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'Untitled Song',
  bpm integer not null default 120,
  initiator_id uuid not null references profiles(id),
  status text not null default 'draft' check (status in ('draft', 'published')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz
);

create table tracks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  instrument text not null,
  color text not null default '#007aff',
  assigned_user_id uuid references profiles(id),
  offset_sec double precision not null default 0,
  volume double precision not null default 1,
  muted boolean not null default false,
  solo boolean not null default false,
  active_take_id uuid,
  created_at timestamptz not null default now()
);

create table takes (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references tracks(id) on delete cascade,
  storage_path text not null,
  duration_sec double precision not null default 0,
  trim_start_sec double precision not null default 0,
  trim_end_sec double precision,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now()
);

alter table tracks
  add constraint tracks_active_take_fk foreign key (active_take_id) references takes(id) on delete set null;

create table track_invites (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references tracks(id) on delete cascade,
  token uuid not null unique default gen_random_uuid(),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  created_by uuid not null references profiles(id),
  claimed_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- True if the user is the project's initiator or is assigned to any of its tracks.
create or replace function is_project_participant(p_project_id uuid, p_user_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from projects where id = p_project_id and initiator_id = p_user_id
  ) or exists (
    select 1 from tracks where project_id = p_project_id and assigned_user_id = p_user_id
  );
$$;

alter table profiles enable row level security;
alter table projects enable row level security;
alter table tracks enable row level security;
alter table takes enable row level security;
alter table track_invites enable row level security;

-- profiles: viewable by any signed-in user (needed to show player names on a
-- project); each user can only create/update their own row.
create policy "profiles are readable by signed-in users" on profiles
  for select using (auth.role() = 'authenticated');
create policy "users manage their own profile" on profiles
  for insert with check (id = auth.uid());
create policy "users update their own profile" on profiles
  for update using (id = auth.uid());

-- projects: participants can always see their own (draft or published);
-- anyone signed in can see published projects (the "Songs" list).
create policy "projects visible to participants or once published" on projects
  for select using (status = 'published' or is_project_participant(id, auth.uid()));
create policy "only the creator can start a project" on projects
  for insert with check (initiator_id = auth.uid());
-- Only the initiator can change anything on the project row — including
-- status, which is how publishing is gated.
create policy "only the initiator can update the project" on projects
  for update using (initiator_id = auth.uid());
create policy "only the initiator can delete the project" on projects
  for delete using (initiator_id = auth.uid());

-- tracks: visible to the same audience as their project.
create policy "tracks visible with their project" on tracks
  for select using (
    exists (
      select 1 from projects p
      where p.id = project_id and (p.status = 'published' or is_project_participant(p.id, auth.uid()))
    )
  );
create policy "only the initiator adds channels" on tracks
  for insert with check (
    exists (select 1 from projects p where p.id = project_id and p.initiator_id = auth.uid())
  );
-- Editing a track (mix settings, active take, offset) is restricted to the
-- player assigned to it, or the initiator.
create policy "assigned player or initiator edits the track" on tracks
  for update using (
    assigned_user_id = auth.uid()
    or exists (select 1 from projects p where p.id = project_id and p.initiator_id = auth.uid())
  );
create policy "only the initiator removes a channel" on tracks
  for delete using (
    exists (select 1 from projects p where p.id = project_id and p.initiator_id = auth.uid())
  );

-- takes: same visibility as the parent track; only the assigned player (or
-- the initiator) can record/trim/replace one — this is the "editing only to
-- the player channel" rule.
create policy "takes visible with their track" on takes
  for select using (
    exists (
      select 1 from tracks t
      join projects p on p.id = t.project_id
      where t.id = track_id and (p.status = 'published' or is_project_participant(p.id, auth.uid()))
    )
  );
create policy "assigned player or initiator records a take" on takes
  for insert with check (
    exists (
      select 1 from tracks t
      join projects p on p.id = t.project_id
      where t.id = track_id and (t.assigned_user_id = auth.uid() or p.initiator_id = auth.uid())
    )
  );
create policy "assigned player or initiator edits a take" on takes
  for update using (
    exists (
      select 1 from tracks t
      join projects p on p.id = t.project_id
      where t.id = track_id and (t.assigned_user_id = auth.uid() or p.initiator_id = auth.uid())
    )
  );
create policy "assigned player or initiator deletes a take" on takes
  for delete using (
    exists (
      select 1 from tracks t
      join projects p on p.id = t.project_id
      where t.id = track_id and (t.assigned_user_id = auth.uid() or p.initiator_id = auth.uid())
    )
  );

-- track_invites: an invite link is a bearer token — anyone signed in who has
-- the link can view/accept it (that's the point of sending it), but only the
-- initiator can create or revoke one.
create policy "a pending invite is viewable by any signed-in user with the link" on track_invites
  for select using (status = 'pending' or created_by = auth.uid() or claimed_by = auth.uid());
create policy "only the initiator sends track invites" on track_invites
  for insert with check (
    exists (
      select 1 from tracks t
      join projects p on p.id = t.project_id
      where t.id = track_id and p.initiator_id = auth.uid()
    )
  );
create policy "an invited user accepts their own invite" on track_invites
  for update using (status = 'pending')
  with check (claimed_by = auth.uid() and status = 'accepted');
create policy "only the initiator revokes an invite" on track_invites
  for delete using (
    exists (
      select 1 from tracks t
      join projects p on p.id = t.project_id
      where t.id = track_id and p.initiator_id = auth.uid()
    )
  );

-- Storage: audio takes live in a private "takes" bucket, one folder per
-- project (takes/<project_id>/<track_id>/<take_id>.wav). Run this after
-- creating that bucket in the Supabase dashboard (Storage → New bucket,
-- name "takes", keep it private).
create policy "read takes files for accessible projects" on storage.objects
  for select using (
    bucket_id = 'takes'
    and exists (
      select 1 from projects p
      where p.id::text = (storage.foldername(name))[1]
        and (p.status = 'published' or is_project_participant(p.id, auth.uid()))
    )
  );
create policy "assigned player or initiator uploads a take file" on storage.objects
  for insert with check (
    bucket_id = 'takes'
    and exists (
      select 1 from tracks t
      join projects p on p.id = t.project_id
      where p.id::text = (storage.foldername(name))[1]
        and (t.assigned_user_id = auth.uid() or p.initiator_id = auth.uid())
    )
  );
