-- 0040 — Players and Listeners cannot change anything that belongs to another player or to the Owner.
--
-- Found by a check of the rules (2026-10-09). Two gaps were left by earlier changes:
--   1. 0015 and 0021 let ANY "participant" add a channel and edit a channel row — and a participant includes
--      Listeners. So a Listener could, through the API, add channels and change a channel's effects or name.
--   2. A Player could change the effects (EQ, compressor, delay, reverb, power) and the name of ANOTHER
--      player's channel. The screen already hid this; the database did not stop it.
--
-- After this:
--   * Adding a channel: the Owner, the Mixer or a Player (someone assigned to a channel). Not a Listener.
--   * Editing a channel row at all: the same three kinds of people (the trigger below limits what).
--   * A channel's effects: the Owner, the Mixer, or the channel's own player (and not while it is locked).
--   * A channel's name: the Owner, the Mixer, the channel's own player, or anyone allowed to edit while the
--     channel has no player yet (channels people add for themselves start unassigned).
--   * Unchanged: colour, order and who plays it = Owner only; volume, mute, pan, lock = Owner or Mixer.
--
-- Safe to run more than once. The OWNER RUNS THIS in the Supabase SQL editor.

-- Owner, Mixer, or Player: the people who take part in making the song (not the Listeners).
create or replace function is_project_contributor(p_project_id uuid, p_user_id uuid)
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

revoke execute on function is_project_contributor(uuid, uuid) from public, anon;
grant execute on function is_project_contributor(uuid, uuid) to authenticated;

drop policy if exists "any participant adds a channel" on tracks;
create policy "contributors add a channel" on tracks
  for insert with check (is_project_contributor(project_id, auth.uid()));

drop policy if exists "any participant edits the track" on tracks;
create policy "contributors edit the track" on tracks
  for update using (is_project_contributor(project_id, auth.uid()));

-- Same as 0037's trigger, plus: a Player may not change another player's effects or channel name.
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
       or (new.assigned_user_id is distinct from old.assigned_user_id and not v_via_rpc) then
      raise exception 'Only the owner can change a channel''s colour, place or player.';
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
