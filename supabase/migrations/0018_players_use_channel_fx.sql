-- 0018 — a channel's own assigned player may now also use EQ/Compressor/Delay/
-- Reverb on their own channel (not just the Owner/Mixer). Volume, mute, name,
-- colour and position stay Owner/Mixer-only (the final-mix and channel-identity
-- decisions), enforced at the column level, not just the row level.
--
-- Safe to run more than once.

drop policy if exists "owner or mixer edits the track" on tracks;

create policy "owner, mixer, or the assigned player edits the track" on tracks
  for update
  using (
    assigned_user_id = auth.uid()
    or exists (
      select 1 from projects p
      where p.id = tracks.project_id and (p.initiator_id = auth.uid() or p.mixer_id = auth.uid())
    )
  );

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
begin
  if new.project_id is distinct from old.project_id then
    raise exception 'A channel cannot move to another song.';
  end if;

  -- (Changes made from the SQL editor have no signed-in user and are left alone.)
  if auth.uid() is null then
    return new;
  end if;

  select p.initiator_id = auth.uid(), p.mixer_id = auth.uid()
    into v_is_owner, v_is_mixer
  from projects p where p.id = old.project_id;
  v_is_player := old.assigned_user_id = auth.uid();

  if not v_is_owner then
    if new.instrument is distinct from old.instrument
       or new.color is distinct from old.color
       or new.position is distinct from old.position
       or new.assigned_user_id is distinct from old.assigned_user_id then
      raise exception 'Only the owner can change a channel''s name, colour, place or player.';
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
