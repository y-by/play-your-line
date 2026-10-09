-- 0042 — a person the Owner ADDS to the song as a player can add (and then play) their own channel.
--
-- 0040 limited adding channels to Owner, Mixer and Players. But a person the Owner adds by email
-- (add_project_member, 0031) has no channel yet, so they counted as a Listener and could not add one —
-- the chicken-and-egg the owner pointed out. People who joined through a LISTENER invite link stay plain
-- Listeners: they cannot add channels.
--
--   * project_listeners.can_play: true for people added as players, false for real listeners.
--   * Backfill: everyone already in the table counts as a player unless they joined through an accepted
--     listener invite link (those are the real listeners).
--   * add_project_member now sets can_play (and upgrades someone who was already there).
--   * is_project_contributor (0040) also accepts a member with can_play.
--
-- Safe to run more than once. The OWNER RUNS THIS in the Supabase SQL editor.

alter table project_listeners add column if not exists can_play boolean not null default false;

update project_listeners l
set can_play = true
where not l.can_play
  and not exists (
    select 1 from project_invites i
    where i.project_id = l.project_id and i.claimed_by = l.user_id and i.role = 'listener' and i.status = 'accepted'
  );

create or replace function add_project_member(p_project_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;

  if not exists (select 1 from projects where id = p_project_id and initiator_id = auth.uid()) then
    raise exception 'Only the owner can add people.';
  end if;

  if not exists (select 1 from profiles where id = p_user_id) then
    raise exception 'No account found for that person.';
  end if;

  insert into project_listeners (project_id, user_id, can_play)
  values (p_project_id, p_user_id, true)
  on conflict (project_id, user_id) do update set can_play = true;
end;
$$;

revoke execute on function add_project_member(uuid, uuid) from public, anon;
grant execute on function add_project_member(uuid, uuid) to authenticated;

create or replace function is_project_contributor(p_project_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from projects where id = p_project_id and (initiator_id = p_user_id or mixer_id = p_user_id)
  ) or exists (
    select 1 from tracks where project_id = p_project_id and assigned_user_id = p_user_id
  ) or exists (
    select 1 from project_listeners where project_id = p_project_id and user_id = p_user_id and can_play
  );
$$;

revoke execute on function is_project_contributor(uuid, uuid) from public, anon;
grant execute on function is_project_contributor(uuid, uuid) to authenticated;
