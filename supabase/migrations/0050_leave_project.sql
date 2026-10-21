-- 0050 — anybody can leave a project: Listener, Player, Mixer, and the Owner after handing it over.
--
--   leave_project(project, new_owner)
--     * Takes the caller out of the song: the listener / added-player row, the Mixer seat, and every channel of
--       theirs that has no recordings (those become free for someone else).
--     * Channels WITH recordings are kept: they pass to the Owner (nobody's recordings are deleted by someone
--       leaving; the Owner can delete a channel afterwards).
--     * The Owner cannot just leave: p_new_owner must be someone already in the song. The project is handed to
--       them first, then the old Owner leaves like anyone else. (To end a project nobody takes over, the Owner
--       deletes it.)
--
-- Signed-in users only. Safe to run more than once. The OWNER RUNS THIS in the Supabase SQL editor.

create or replace function leave_project(p_project_id uuid, p_new_owner uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_owner uuid;
  v_target uuid;
  v_kept integer;
begin
  if v_me is null then
    raise exception 'Sign in required';
  end if;

  select initiator_id into v_owner from projects where id = p_project_id;
  if v_owner is null then
    raise exception 'No such project.';
  end if;

  perform set_config('pyl.assign_via_rpc', 'on', true);

  if v_owner = v_me then
    if p_new_owner is null or p_new_owner = v_me then
      raise exception 'Choose who takes over the project before you leave.';
    end if;
    if not is_project_participant(p_project_id, p_new_owner) then
      raise exception 'The new Owner has to be in the project already.';
    end if;
    update projects
      set initiator_id = p_new_owner,
          mixer_id = case when mixer_id = p_new_owner then null else mixer_id end
      where id = p_project_id;
    delete from project_listeners where project_id = p_project_id and user_id = p_new_owner;
    v_target := p_new_owner;
  else
    if not is_project_participant(p_project_id, v_me) then
      raise exception 'You are not in this project.';
    end if;
    v_target := v_owner;
  end if;

  delete from project_listeners where project_id = p_project_id and user_id = v_me;
  update projects set mixer_id = null where id = p_project_id and mixer_id = v_me;

  -- Empty channels become free; channels with recordings go to the Owner so the music stays.
  update tracks t set assigned_user_id = null
  where t.project_id = p_project_id and t.assigned_user_id = v_me
    and not exists (select 1 from clips c where c.track_id = t.id);
  select count(*)::int into v_kept from tracks t where t.project_id = p_project_id and t.assigned_user_id = v_me;
  update tracks set assigned_user_id = v_target where project_id = p_project_id and assigned_user_id = v_me;

  return v_kept;
end;
$$;

revoke execute on function leave_project(uuid, uuid) from public, anon;
grant execute on function leave_project(uuid, uuid) to authenticated;
