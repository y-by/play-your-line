-- 0022 — accepting an invite could fail with a foreign key violation (seen
-- live: "insert or update on table track_invites violates foreign key
-- constraint track_invites_claimed_by_fkey") if the invited person's own
-- `profiles` row hadn't been created yet at that exact moment. Their Google
-- sign-in itself succeeded (auth.uid() is real), but the separate
-- client-side upsert that creates their `profiles` row is a normal network
-- call and can fail silently (e.g. a flaky mobile connection right after the
-- OAuth redirect) — the app still treats them as signed in, so the very
-- first write that references their profile (claimed_by, or project_listeners
-- .user_id / mixer_id for a role invite) hits a table that doesn't have them
-- in it yet.
--
-- Self-heal at the point of use: ensure the caller has a profiles row before
-- touching anything that references one. A harmless no-op if it already
-- exists — this does not replace the client's own upsert, which still fills
-- in display_name/avatar_url/email; it just guarantees the row itself can't
-- be missing when one of these functions needs it.
--
-- Safe to run more than once.

create or replace function accept_track_invite(p_token uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_track_id uuid;
  v_status text;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;

  insert into profiles (id) values (auth.uid()) on conflict (id) do nothing;

  select track_id, status into v_track_id, v_status
  from track_invites
  where token = p_token
  for update;

  if v_track_id is null then
    raise exception 'Invite not found';
  end if;

  if v_status <> 'pending' then
    raise exception 'Invite is no longer available';
  end if;

  update track_invites
  set status = 'accepted', claimed_by = auth.uid()
  where token = p_token;

  perform set_config('pyl.assign_via_rpc', 'on', true);
  update tracks
  set assigned_user_id = auth.uid()
  where id = v_track_id and assigned_user_id is null;

  return v_track_id;
end;
$$;

grant execute on function accept_track_invite(uuid) to authenticated;

create or replace function accept_project_invite(p_token uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
  v_role text;
  v_status text;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;

  insert into profiles (id) values (auth.uid()) on conflict (id) do nothing;

  select project_id, role, status into v_project_id, v_role, v_status
  from project_invites
  where token = p_token
  for update;

  if v_project_id is null then
    raise exception 'Invite not found';
  end if;
  if v_status <> 'pending' then
    raise exception 'Invite is no longer available';
  end if;

  if v_role = 'mixer' then
    if exists (select 1 from projects where id = v_project_id and mixer_id is not null and mixer_id <> auth.uid()) then
      raise exception 'This song already has a mixer.';
    end if;
    perform set_config('pyl.assign_via_rpc', 'on', true);
    update projects set mixer_id = auth.uid() where id = v_project_id;
  else
    insert into project_listeners (project_id, user_id)
    values (v_project_id, auth.uid())
    on conflict do nothing;
  end if;

  update project_invites set status = 'accepted', claimed_by = auth.uid() where token = p_token;
  return v_project_id;
end;
$$;

grant execute on function accept_project_invite(uuid) to authenticated;
