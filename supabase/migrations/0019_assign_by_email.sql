-- 0019 — assign a channel directly, without an invite link: either pick
-- someone already in the song from a list, or type their email.
--
-- New assignment path, alongside (not replacing) the existing invite-link
-- flow: the owner picks a target and the channel is assigned immediately,
-- no accept step — same trust model as `claim_own_track` and `set_mixer`.
--
-- profiles.email is added to make the lookup possible, but it must NOT
-- become readable through the existing "profiles are readable by signed-in
-- users" policy (that would leak every user's email to every other signed-in
-- user). Column-level privileges lock it down; only the security-definer
-- lookup function below can read it.
--
-- Safe to run more than once.

begin;

alter table profiles add column if not exists email text;
create index if not exists profiles_email_idx on profiles (lower(email));

revoke select on profiles from authenticated;
grant select (id, display_name, avatar_url, created_at) on profiles to authenticated;

-- Narrow, single-purpose lookup — returns only id/display_name for an exact
-- email match, never a full row, never a list.
create or replace function find_profile_by_email(p_email text)
returns table (id uuid, display_name text)
language sql
stable
security definer
set search_path = public
as $$
  select id, display_name from profiles where lower(email) = lower(p_email) limit 1;
$$;

grant execute on function find_profile_by_email(text) to authenticated;

-- Owner assigns an unclaimed channel straight to a known user id (either one
-- picked from the "already in this song" list, or found via the email
-- lookup above). Mirrors claim_own_track's shape, but for an arbitrary
-- target instead of the caller themself.
create or replace function assign_track_to_user(p_track_id uuid, p_user_id uuid)
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
    where t.id = p_track_id and p.initiator_id = auth.uid() and t.assigned_user_id is null
  ) then
    raise exception 'Only the owner can assign an unclaimed channel.';
  end if;

  if not exists (select 1 from profiles where id = p_user_id) then
    raise exception 'No account found for that person.';
  end if;

  perform set_config('pyl.assign_via_rpc', 'on', true);
  update tracks set assigned_user_id = p_user_id where id = p_track_id;
end;
$$;

grant execute on function assign_track_to_user(uuid, uuid) to authenticated;

commit;
