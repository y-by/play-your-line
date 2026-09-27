-- 0009 — clips, stricter permissions, tempo lock.
--
-- What changes:
--   1. A channel now holds many CLIPS. A take is raw audio and is never
--      modified; a clip is a window onto a take, placed on the song timeline.
--   2. Only the channel's assigned player can add / move / trim / delete clips
--      and record takes. The initiator can NOT touch a player's clips.
--   3. The initiator (only) edits the saved final mix: channel volume and
--      mute. (Solo is never saved; it's a listening aid.)
--   4. A channel can only become assigned by accepting an invite, or by the
--      initiator taking an unassigned channel for themselves.
--   5. Tempo is locked once the song has any clip.
--
-- Run the whole file once in the Supabase SQL Editor. It is one transaction:
-- if anything fails, nothing is applied.

begin;

-- 1. Clips ------------------------------------------------------------------

create table clips (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references tracks(id) on delete cascade,
  take_id uuid not null references takes(id) on delete cascade,
  start_sec double precision not null default 0 check (start_sec >= 0),
  source_start_sec double precision not null default 0 check (source_start_sec >= 0),
  duration_sec double precision not null check (duration_sec > 0),
  z integer not null default 1,
  created_at timestamptz not null default now()
);

create index clips_track_id_idx on clips (track_id);
create index clips_take_id_idx on clips (take_id);

alter table clips enable row level security;
grant select, insert, update, delete on public.clips to authenticated;

create policy "clips visible with their track" on clips
  for select using (
    exists (
      select 1 from tracks t
      join projects p on p.id = t.project_id
      where t.id = clips.track_id and (p.status = 'published' or is_project_participant(p.id, auth.uid()))
    )
  );

create policy "only the channel's player adds clips" on clips
  for insert with check (
    exists (select 1 from tracks t where t.id = clips.track_id and t.assigned_user_id = auth.uid())
    and exists (select 1 from takes k where k.id = clips.take_id and k.track_id = clips.track_id)
  );

create policy "only the channel's player edits clips" on clips
  for update
  using (exists (select 1 from tracks t where t.id = clips.track_id and t.assigned_user_id = auth.uid()))
  with check (exists (select 1 from tracks t where t.id = clips.track_id and t.assigned_user_id = auth.uid()));

create policy "only the channel's player deletes clips" on clips
  for delete using (
    exists (select 1 from tracks t where t.id = clips.track_id and t.assigned_user_id = auth.uid())
  );

-- Carry over what already exists: each channel's active take becomes one clip,
-- placed and trimmed exactly as it played before.
insert into clips (track_id, take_id, start_sec, source_start_sec, duration_sec, z)
select
  t.id,
  t.active_take_id,
  coalesce(t.offset_sec, 0) + tk.trim_start_sec,
  tk.trim_start_sec,
  greatest(coalesce(tk.trim_end_sec, tk.duration_sec) - tk.trim_start_sec, 0.05),
  1
from tracks t
join takes tk on tk.id = t.active_take_id
where not exists (select 1 from clips c where c.track_id = t.id);

-- 2. Takes: only the channel's player records; recordings are never edited ----

drop policy "assigned player or initiator records a take" on takes;
drop policy "assigned player or initiator edits a take" on takes;
drop policy "assigned player or initiator deletes a take" on takes;

create policy "only the channel's player records a take" on takes
  for insert with check (
    created_by = auth.uid()
    and exists (select 1 from tracks t where t.id = takes.track_id and t.assigned_user_id = auth.uid())
  );

create policy "only the channel's player deletes a take" on takes
  for delete using (
    exists (select 1 from tracks t where t.id = takes.track_id and t.assigned_user_id = auth.uid())
  );

-- Audio files: same rule, and the upload path must be this player's own channel.
drop policy "assigned player or initiator uploads a take file" on storage.objects;

create policy "only the channel's player uploads a take file" on storage.objects
  for insert with check (
    bucket_id = 'takes'
    and exists (
      select 1 from tracks t
      where t.assigned_user_id = auth.uid()
        and t.project_id::text = (storage.foldername(name))[1]
        and t.id::text = (storage.foldername(name))[2]
    )
  );

-- 3. Tracks: only the initiator edits the saved mix ---------------------------

drop policy "assigned player or initiator edits the track" on tracks;

create policy "only the initiator edits the mix" on tracks
  for update using (
    exists (select 1 from projects p where p.id = tracks.project_id and p.initiator_id = auth.uid())
  );

-- 4. Assignment only through an invite, or the initiator taking their own ------

create or replace function guard_track_assignment()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('pyl.assign_via_rpc', true), '') <> 'on' then
    if tg_op = 'INSERT' and new.assigned_user_id is not null then
      raise exception 'A channel can only be assigned by accepting an invite.';
    end if;
    if tg_op = 'UPDATE' and new.assigned_user_id is distinct from old.assigned_user_id then
      raise exception 'A channel can only be assigned by accepting an invite, or by the initiator taking it.';
    end if;
  end if;
  return new;
end;
$$;

create trigger tracks_guard_assignment
  before insert or update on tracks
  for each row execute function guard_track_assignment();

-- Initiator plays a channel themselves.
create or replace function claim_own_track(p_track_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;

  if not exists (
    select 1 from tracks t
    join projects p on p.id = t.project_id
    where t.id = p_track_id and p.initiator_id = auth.uid() and t.assigned_user_id is null
  ) then
    raise exception 'Only the initiator can take an unassigned channel.';
  end if;

  perform set_config('pyl.assign_via_rpc', 'on', true);
  update tracks set assigned_user_id = auth.uid() where id = p_track_id;
end;
$$;

grant execute on function claim_own_track(uuid) to authenticated;

-- Accepting an invite (same as 0003, now marked as an allowed assignment).
create or replace function accept_track_invite(p_token uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_track_id uuid;
  v_status text;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;

  select track_id, status into v_track_id, v_status
  from track_invites
  where token = p_token
  for update;

  if v_track_id is null then
    raise exception 'Invite not found';
  end if;

  if v_status <> 'pending' then
    raise exception 'Invite is no longer available';
  end if;

  update track_invites
  set status = 'accepted', claimed_by = auth.uid()
  where token = p_token;

  perform set_config('pyl.assign_via_rpc', 'on', true);
  update tracks
  set assigned_user_id = auth.uid()
  where id = v_track_id and assigned_user_id is null;

  return v_track_id;
end;
$$;

grant execute on function accept_track_invite(uuid) to authenticated;

-- 5. Tempo lock -----------------------------------------------------------------

create or replace function guard_tempo_lock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.bpm is distinct from old.bpm and exists (
    select 1 from clips c join tracks t on t.id = c.track_id where t.project_id = old.id
  ) then
    raise exception 'Tempo is locked because this song already has recordings.';
  end if;
  return new;
end;
$$;

create trigger projects_tempo_lock
  before update on projects
  for each row execute function guard_tempo_lock();

-- A channel that already has recordings can't be removed from above: a
-- player's work is never deleted by the initiator.
drop policy if exists "only the initiator removes a channel" on tracks;
create policy "only the initiator removes an empty channel" on tracks
  for delete to authenticated
  using (
    exists (select 1 from projects p where p.id = tracks.project_id and p.initiator_id = auth.uid())
    and not exists (select 1 from clips c where c.track_id = tracks.id)
  );

commit;
