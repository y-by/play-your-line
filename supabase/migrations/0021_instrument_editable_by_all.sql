-- 0021 — anyone in the song may rename a channel's instrument label, not just
-- the owner (matches 0015's "anyone can add a channel" — channel bookkeeping
-- is participant-level, not owner-only). Colour and the default arrangement
-- position stay owner-only; volume/mute (the saved final mix) stay
-- owner/mixer-only — both enforced in guard_track_columns(), not by who may
-- attempt the update at all.
--
-- Widening the UPDATE policy to any participant (instead of owner/mixer/the
-- assigned player) also closes a gap the trigger had: volume/mute were only
-- checked "if the caller is this track's assigned player", so a participant
-- who was neither that nor owner/mixer had no check at all — harmless while
-- the old policy already kept such people out at the row level, but not
-- once the policy is this open. The rewritten check is just "not owner and
-- not mixer", independent of who the row's own assigned player happens to be.
--
-- Safe to run more than once.

drop policy if exists "owner, mixer, or the assigned player edits the track" on tracks;

create policy "any participant edits the track" on tracks
  for update
  using (is_project_participant(project_id, auth.uid()));

create or replace function guard_track_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_owner boolean;
  v_is_mixer boolean;
  v_via_rpc boolean;
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

  if not v_is_owner then
    if new.color is distinct from old.color
       or new.position is distinct from old.position
       or (new.assigned_user_id is distinct from old.assigned_user_id and not v_via_rpc) then
      raise exception 'Only the owner can change a channel''s colour, place or player.';
    end if;
  end if;

  -- Volume/mute are the saved final mix — Owner/Mixer only, full stop.
  if not v_is_owner and not v_is_mixer then
    if new.volume is distinct from old.volume or new.muted is distinct from old.muted then
      raise exception 'Only the owner or mixer can change the saved volume/mute.';
    end if;
  end if;

  return new;
end;
$$;
