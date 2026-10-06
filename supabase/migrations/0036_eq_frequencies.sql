-- 0036 — a frequency for each EQ band (low shelf, mid peak, high shelf), set by a knob in the FX window.
-- Until now the three centres were fixed at 200 Hz, 1 kHz and 5 kHz; those stay the defaults, so every
-- existing channel sounds exactly the same. Safe to run more than once.

alter table tracks
  add column if not exists eq_low_hz double precision not null default 200,
  add column if not exists eq_mid_hz double precision not null default 1000,
  add column if not exists eq_high_hz double precision not null default 5000;

alter table tracks
  drop constraint if exists tracks_eq_low_hz_range,
  drop constraint if exists tracks_eq_mid_hz_range,
  drop constraint if exists tracks_eq_high_hz_range;

alter table tracks
  add constraint tracks_eq_low_hz_range check (eq_low_hz between 40 and 800),
  add constraint tracks_eq_mid_hz_range check (eq_mid_hz between 200 and 8000),
  add constraint tracks_eq_high_hz_range check (eq_high_hz between 1500 and 16000);

-- The FX lock (0034) must cover the new columns too: a locked channel's player can't move them either.
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
    if new.fx_locked is distinct from old.fx_locked then
      raise exception 'Only the owner or mixer can lock or unlock a channel''s effects.';
    end if;
    if old.fx_locked and (
         new.fx_on is distinct from old.fx_on
         or new.eq_on is distinct from old.eq_on or new.comp_on is distinct from old.comp_on
         or new.delay_on is distinct from old.delay_on or new.reverb_on is distinct from old.reverb_on
         or new.eq_low is distinct from old.eq_low or new.eq_mid is distinct from old.eq_mid or new.eq_high is distinct from old.eq_high
         or new.eq_low_hz is distinct from old.eq_low_hz or new.eq_mid_hz is distinct from old.eq_mid_hz or new.eq_high_hz is distinct from old.eq_high_hz
         or new.comp_threshold_db is distinct from old.comp_threshold_db or new.comp_ratio is distinct from old.comp_ratio
         or new.comp_attack_ms is distinct from old.comp_attack_ms or new.comp_release_ms is distinct from old.comp_release_ms
         or new.comp_makeup_db is distinct from old.comp_makeup_db
         or new.delay_time_ms is distinct from old.delay_time_ms or new.delay_mix is distinct from old.delay_mix
         or new.reverb_mix is distinct from old.reverb_mix) then
      raise exception 'The owner or mixer has locked this channel''s effects.';
    end if;
  end if;

  return new;
end;
$$;
