-- 0030 — a pan control for every channel (-1 = hard left, 0 = centre, +1 = hard right).
-- Part of the saved final mix, like volume and mute: only the Owner and the Mixer may change it
-- (enforced here, in the channel guard trigger, not just in the screens).
--
-- Safe to run more than once.

alter table tracks add column if not exists pan real not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tracks_pan_range') then
    alter table tracks add constraint tracks_pan_range check (pan >= -1 and pan <= 1);
  end if;
end $$;

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

  -- Volume, mute and pan are the saved final mix — Owner/Mixer only, full stop.
  if not v_is_owner and not v_is_mixer then
    if new.volume is distinct from old.volume or new.muted is distinct from old.muted or new.pan is distinct from old.pan then
      raise exception 'Only the owner or mixer can change the saved volume, mute or pan.';
    end if;
  end if;

  return new;
end;
$$;
