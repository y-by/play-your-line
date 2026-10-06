-- 0034 — channel FX upgrade: a power switch per channel (default OFF), a bypass per effect, a real
-- compressor (threshold / ratio / attack / release / make-up), and a lock so the Owner or Mixer can
-- stop a player changing their channel's FX.
--
-- Channels that already have FX set keep sounding exactly as they do now: their power switch is
-- turned ON and the old single "amount" knob is converted to the matching threshold and ratio.
-- New channels start with FX OFF. Safe to run more than once.

alter table tracks
  add column if not exists fx_on boolean not null default false,
  add column if not exists eq_on boolean not null default true,
  add column if not exists comp_on boolean not null default true,
  add column if not exists delay_on boolean not null default true,
  add column if not exists reverb_on boolean not null default true,
  add column if not exists comp_threshold_db double precision not null default 0,
  add column if not exists comp_ratio double precision not null default 1,
  add column if not exists comp_attack_ms double precision not null default 10,
  add column if not exists comp_release_ms double precision not null default 150,
  add column if not exists comp_makeup_db double precision not null default 0,
  add column if not exists fx_locked boolean not null default false;

-- Carry the old settings over (only while the new compressor columns are still untouched).
update tracks
set comp_threshold_db = -comp_amount * 30,
    comp_ratio = 1 + comp_amount * 11
where comp_amount > 0 and comp_threshold_db = 0 and comp_ratio = 1;

update tracks
set fx_on = true
where fx_on = false
  and (eq_low <> 0 or eq_mid <> 0 or eq_high <> 0 or comp_amount > 0 or delay_mix > 0 or reverb_mix > 0);

alter table tracks
  drop constraint if exists tracks_comp_threshold_db_range,
  drop constraint if exists tracks_comp_ratio_range,
  drop constraint if exists tracks_comp_attack_ms_range,
  drop constraint if exists tracks_comp_release_ms_range,
  drop constraint if exists tracks_comp_makeup_db_range;

alter table tracks
  add constraint tracks_comp_threshold_db_range check (comp_threshold_db between -60 and 0),
  add constraint tracks_comp_ratio_range check (comp_ratio between 1 and 20),
  add constraint tracks_comp_attack_ms_range check (comp_attack_ms between 0 and 200),
  add constraint tracks_comp_release_ms_range check (comp_release_ms between 10 and 1500),
  add constraint tracks_comp_makeup_db_range check (comp_makeup_db between 0 and 24);

-- Who may change what. This is the 0030 version of the guard, plus the FX lock: a plain player may change
-- their own channel's FX only while the channel is not locked, and only the Owner or the Mixer may lock or
-- unlock it. (comp_amount is no longer used by the app.)
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
