-- 0031 — the Owner can add someone who already has an account straight into the project (no invite
-- link to send and accept). They join as a member: they can listen, and add and play their own
-- channel, exactly like someone who accepted a link. Takes the person's id (the app finds it from
-- their email with find_profile_by_email first).
--
-- Signed-in users only; only the project's Owner may call it for their own project.
-- Safe to run more than once.

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

  insert into project_listeners (project_id, user_id)
  values (p_project_id, p_user_id)
  on conflict do nothing;
end;
$$;

revoke execute on function add_project_member(uuid, uuid) from public, anon;
grant execute on function add_project_member(uuid, uuid) to authenticated;
