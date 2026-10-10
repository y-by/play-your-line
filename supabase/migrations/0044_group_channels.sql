-- 0044 — group channels (busses): a group holds several channels and has its own fader, mute, pan and effects.
-- Channels in a group play through it; groups play through the master (0043).
--
--   * track_groups     one row per group: name, colour, order, volume, mute, pan, effects (json).
--   * tracks.group_id  which group a channel is in (empty = straight to the master). Deleting a group sets it empty.
--
-- Who may do what (the owner's answers, 2026-10-10):
--   * The Owner creates, renames and deletes groups and puts channels in them.
--   * The Owner and the Mixer set a group's volume, mute, pan and effects.
--   * Players and Listeners can only read. Everyone hears the saved group settings.
-- All writes go through the functions below (clients have no direct insert/update/delete on track_groups), and a
-- channel's group_id can only be changed by the Owner (guard_track_columns, below, from the 0040 version).
-- Any change that alters the sound marks the listening copy as out of date (projects.preview_stale, 0043).
--
-- Run 0043 first. Safe to run more than once. The OWNER RUNS THIS in the Supabase SQL editor.

create table if not exists track_groups (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  color text not null default '#8e8e93',
  position integer not null default 0,
  volume real not null default 1 check (volume >= 0 and volume <= 4),
  muted boolean not null default false,
  pan real not null default 0 check (pan >= -1 and pan <= 1),
  fx jsonb not null default '{}'::jsonb check (jsonb_typeof(fx) = 'object' and pg_column_size(fx) < 4000),
  created_at timestamptz not null default now()
);

create index if not exists track_groups_project_idx on track_groups (project_id);

alter table tracks add column if not exists group_id uuid references track_groups(id) on delete set null;
create index if not exists tracks_group_idx on tracks (group_id);

alter table track_groups enable row level security;

-- Everyone in the song can read its groups (they hear them, and see where their channel sits).
drop policy if exists "participants read the groups" on track_groups;
create policy "participants read the groups" on track_groups
  for select using (is_project_participant(project_id, auth.uid()));

revoke insert, update, delete on track_groups from authenticated, anon;
grant select on track_groups to authenticated;

-- ---- The Owner: create, rename, delete, place channels -------------------------------------------------------------

create or replace function create_track_group(p_project_id uuid, p_name text, p_color text default '#8e8e93')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;
  if not exists (select 1 from projects where id = p_project_id and initiator_id = auth.uid()) then
    raise exception 'Only the owner can create a group.';
  end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 40 then
    raise exception 'A group name has 1 to 40 characters.';
  end if;

  insert into track_groups (project_id, name, color, position)
  values (p_project_id, btrim(p_name), coalesce(p_color, '#8e8e93'), coalesce((select max(position) + 1 from track_groups where project_id = p_project_id), 0))
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function rename_track_group(p_group_id uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 40 then
    raise exception 'A group name has 1 to 40 characters.';
  end if;
  update track_groups g set name = btrim(p_name)
  where g.id = p_group_id
    and exists (select 1 from projects p where p.id = g.project_id and p.initiator_id = auth.uid());
  if not found then
    raise exception 'Only the owner can rename a group.';
  end if;
end;
$$;

create or replace function delete_track_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;
  select g.project_id into v_project
  from track_groups g join projects p on p.id = g.project_id
  where g.id = p_group_id and p.initiator_id = auth.uid();
  if v_project is null then
    raise exception 'Only the owner can delete a group.';
  end if;
  -- The channels stay and fall back to the master (tracks.group_id is set empty by the foreign key).
  delete from track_groups where id = p_group_id;
  update projects set preview_stale = preview_stale or preview_path is not null where id = v_project;
end;
$$;

-- Puts a channel in a group (or takes it out with a null group). Both must be in the same song.
create or replace function set_track_group(p_track_id uuid, p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;
  select t.project_id into v_project
  from tracks t join projects p on p.id = t.project_id
  where t.id = p_track_id and p.initiator_id = auth.uid();
  if v_project is null then
    raise exception 'Only the owner can put a channel in a group.';
  end if;
  if p_group_id is not null and not exists (select 1 from track_groups where id = p_group_id and project_id = v_project) then
    raise exception 'That group is not in this song.';
  end if;

  update tracks set group_id = p_group_id where id = p_track_id;
  update projects set preview_stale = preview_stale or preview_path is not null where id = v_project;
end;
$$;

-- ---- The Owner and the Mixer: the group's mix -----------------------------------------------------------------------
-- Only the fields that are passed are changed.

create or replace function set_group_mix(
  p_group_id uuid,
  p_volume real default null,
  p_muted boolean default null,
  p_pan real default null,
  p_fx jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;
  select g.project_id into v_project
  from track_groups g join projects p on p.id = g.project_id
  where g.id = p_group_id and (p.initiator_id = auth.uid() or p.mixer_id = auth.uid());
  if v_project is null then
    raise exception 'Only the owner or the mixer can change a group.';
  end if;
  if p_volume is not null and (p_volume < 0 or p_volume > 4) then
    raise exception 'The group volume is not valid.';
  end if;
  if p_pan is not null and (p_pan < -1 or p_pan > 1) then
    raise exception 'The group pan is not valid.';
  end if;
  if p_fx is not null and (jsonb_typeof(p_fx) <> 'object' or pg_column_size(p_fx) >= 4000) then
    raise exception 'The group effects are not valid.';
  end if;

  update track_groups
  set volume = coalesce(p_volume, volume),
      muted = coalesce(p_muted, muted),
      pan = coalesce(p_pan, pan),
      fx = coalesce(p_fx, fx)
  where id = p_group_id;
  update projects set preview_stale = preview_stale or preview_path is not null where id = v_project;
end;
$$;

revoke execute on function create_track_group(uuid, text, text) from public, anon;
revoke execute on function rename_track_group(uuid, text) from public, anon;
revoke execute on function delete_track_group(uuid) from public, anon;
revoke execute on function set_track_group(uuid, uuid) from public, anon;
revoke execute on function set_group_mix(uuid, real, boolean, real, jsonb) from public, anon;
grant execute on function create_track_group(uuid, text, text) to authenticated;
grant execute on function rename_track_group(uuid, text) to authenticated;
grant execute on function delete_track_group(uuid) to authenticated;
grant execute on function set_track_group(uuid, uuid) to authenticated;
grant execute on function set_group_mix(uuid, real, boolean, real, jsonb) to authenticated;

-- ---- Live: everyone in the song sees groups change as it happens --------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'track_groups'
  ) then
    alter publication supabase_realtime add table track_groups;
  end if;
end $$;

-- ---- A channel's group can only be changed by the Owner ---------------------------------------------------------------
-- The 0040 version of guard_track_columns, plus the group_id rule.

create or replace function guard_track_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_owner boolean;
  v_is_mixer boolean;
  v_is_own boolean;
  v_via_rpc boolean;
  v_fx_changed boolean;
begin
  if new.project_id is distinct from old.project_id then
    raise exception 'A channel cannot move to another song.';
  end if;

  -- (Changes made from the SQL editor have no signed-in user and are left alone.)
  if auth.uid() is null then
    return new;
  end if;

  v_via_rpc := coalesce(current_setting('pyl.assign_via_rpc', true), '') = 'on';

  select p.initiator_id = auth.uid(), p.mixer_id = auth.uid()
    into v_is_owner, v_is_mixer
  from projects p where p.id = old.project_id;

  v_is_own := old.assigned_user_id = auth.uid();

  if not v_is_owner then
    if new.color is distinct from old.color
       or new.position is distinct from old.position
       or new.group_id is distinct from old.group_id
       or (new.assigned_user_id is distinct from old.assigned_user_id and not v_via_rpc) then
      raise exception 'Only the owner can change a channel''s colour, place, group or player.';
    end if;
  end if;

  -- Volume, mute and pan are the saved final mix — Owner/Mixer only, full stop.
  if not v_is_owner and not v_is_mixer then
    if new.volume is distinct from old.volume or new.muted is distinct from old.muted or new.pan is distinct from old.pan then
      raise exception 'Only the owner or mixer can change the saved volume, mute or pan.';
    end if;
    if new.fx_locked is distinct from old.fx_locked then
      raise exception 'Only the owner or mixer can lock or unlock a channel''s effects.';
    end if;

    v_fx_changed :=
         new.fx_on is distinct from old.fx_on
         or new.eq_on is distinct from old.eq_on or new.comp_on is distinct from old.comp_on
         or new.delay_on is distinct from old.delay_on or new.reverb_on is distinct from old.reverb_on
         or new.eq_low is distinct from old.eq_low or new.eq_mid is distinct from old.eq_mid or new.eq_high is distinct from old.eq_high
         or new.eq_low_hz is distinct from old.eq_low_hz or new.eq_mid_hz is distinct from old.eq_mid_hz or new.eq_high_hz is distinct from old.eq_high_hz
         or new.eq_lowcut_hz is distinct from old.eq_lowcut_hz
         or new.comp_threshold_db is distinct from old.comp_threshold_db or new.comp_ratio is distinct from old.comp_ratio
         or new.comp_attack_ms is distinct from old.comp_attack_ms or new.comp_release_ms is distinct from old.comp_release_ms
         or new.comp_makeup_db is distinct from old.comp_makeup_db
         or new.delay_time_ms is distinct from old.delay_time_ms or new.delay_mix is distinct from old.delay_mix
         or new.reverb_mix is distinct from old.reverb_mix;

    -- Someone else's channel (or one nobody plays): its effects are not theirs to change.
    if v_fx_changed and not v_is_own then
      raise exception 'Only the owner, the mixer or the channel''s own player can change its effects.';
    end if;
    if v_fx_changed and old.fx_locked then
      raise exception 'The owner or mixer has locked this channel''s effects.';
    end if;

    -- A channel that has a player is named by that player (or the Owner / Mixer); an empty one by whoever may edit.
    if new.instrument is distinct from old.instrument and old.assigned_user_id is not null and not v_is_own then
      raise exception 'Only the owner, the mixer or the channel''s own player can rename it.';
    end if;
  end if;

  return new;
end;
$$;
