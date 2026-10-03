-- 0026 — the Owner can hand a claimed channel to someone else, or make it
-- unclaimed again. Only while the channel has NO clips: once a player has
-- recorded on it, it stays theirs (their recordings are not silently moved).
--
-- Mirrors assign_track_to_user (0019), which only works on unclaimed
-- channels. p_user_id = null means "make it unclaimed".
--
-- Safe to run more than once.

create or replace function reassign_track(p_track_id uuid, p_user_id uuid)
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
    where t.id = p_track_id and p.initiator_id = auth.uid()
  ) then
    raise exception 'Only the owner can reassign a channel.';
  end if;

  if track_has_clips(p_track_id) then
    raise exception 'This channel already has recordings, so it can''t be reassigned.';
  end if;

  if p_user_id is not null and not exists (select 1 from profiles where id = p_user_id) then
    raise exception 'No account found for that person.';
  end if;

  perform set_config('pyl.assign_via_rpc', 'on', true);
  update tracks set assigned_user_id = p_user_id where id = p_track_id;
end;
$$;

grant execute on function reassign_track(uuid, uuid) to authenticated;
