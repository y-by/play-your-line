-- Invite accept flow needs two narrow, controlled exceptions to RLS:
-- someone holding an invite link isn't a project participant yet, so they
-- can't normally SELECT the track/project it points to, and can't UPDATE a
-- track's assigned_user_id (that's normally initiator-or-assignee only).
-- These SECURITY DEFINER functions do exactly one safe thing each, scoped
-- to the exact token presented and the caller's own auth.uid() — they don't
-- widen access beyond that.

-- Preview an invite before accepting (works signed-out too, so the landing
-- page can say what you're being invited to before asking you to sign in).
create or replace function get_invite_details(p_token uuid)
returns table (
  track_id uuid,
  instrument text,
  invite_status text,
  project_id uuid,
  project_title text
)
language sql
security definer
set search_path = public
as $$
  select t.id, t.instrument, ti.status, p.id, p.title
  from track_invites ti
  join tracks t on t.id = ti.track_id
  join projects p on p.id = t.project_id
  where ti.token = p_token;
$$;

grant execute on function get_invite_details(uuid) to authenticated, anon;

-- Claim a track via its invite token. Only succeeds once, only for a
-- pending invite, and only assigns the calling user (auth.uid()) — never an
-- arbitrary id passed in from the client.
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

  update tracks
  set assigned_user_id = auth.uid()
  where id = v_track_id and assigned_user_id is null;

  return v_track_id;
end;
$$;

grant execute on function accept_track_invite(uuid) to authenticated;
