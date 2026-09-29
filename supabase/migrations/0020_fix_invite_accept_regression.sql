-- 0020 — fixes a real regression introduced by 0018: accepting a track invite
-- (or claiming/being assigned a channel) started failing with "Only the owner
-- can change a channel's name, colour, place or player."
--
-- 0018's guard_track_columns() added assigned_user_id to the "owner only"
-- column check, without accounting for the fact that accepting an invite is
-- inherently done by the *invited player*, not the owner — auth.uid() there
-- is the player, so the check always failed. The other assignment-only
-- trigger (guard_track_assignment, 0009) already fully gates who may change
-- assigned_user_id at all — only claim_own_track / accept_track_invite /
-- assign_track_to_user can, via the pyl.assign_via_rpc flag they set. This
-- lets guard_track_columns trust that same flag instead of re-checking
-- ownership for assignment, and go back to only policing name/colour/place.
--
-- Safe to run more than once.

create or replace function guard_track_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_owner boolean;
  v_is_mixer boolean;
  v_is_player boolean;
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
  v_is_player := old.assigned_user_id = auth.uid();

  if not v_is_owner then
    if new.instrument is distinct from old.instrument
       or new.color is distinct from old.color
       or new.position is distinct from old.position
       or (new.assigned_user_id is distinct from old.assigned_user_id and not v_via_rpc) then
      raise exception 'Only the owner can change a channel''s name, colour or place.';
    end if;
  end if;

  -- A plain player (not also Owner/Mixer) may only touch their channel's FX —
  -- volume and mute are the saved final mix, which stays Owner/Mixer territory.
  if v_is_player and not v_is_owner and not v_is_mixer then
    if new.volume is distinct from old.volume or new.muted is distinct from old.muted then
      raise exception 'Only the owner or mixer can change the saved volume/mute.';
    end if;
  end if;

  return new;
end;
$$;
