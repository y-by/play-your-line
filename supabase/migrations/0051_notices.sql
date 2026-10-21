-- 0051 — notices: a short message waiting for a person the next time they open the app.
--
--   user_notices   one row per message. You can read and mark your own as seen; nobody can write one directly,
--                  only the functions below do.
--   leave_project  (replaces 0050) now leaves a notice for the new Owner ("project_handed_over") when the Owner hands
--                  the project over, and for the Owner ("member_left") when anyone else leaves.
--
-- Safe to run more than once. The OWNER RUNS THIS in the Supabase SQL editor.

create table if not exists user_notices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  kind text not null check (kind in ('project_handed_over', 'member_left')),
  project_id uuid references projects(id) on delete cascade,
  project_title text,
  from_name text,
  detail integer not null default 0,
  created_at timestamptz not null default now(),
  seen_at timestamptz
);

create index if not exists user_notices_unseen on user_notices (user_id) where seen_at is null;

alter table user_notices enable row level security;
revoke all on user_notices from anon, authenticated;
grant select on user_notices to authenticated;
grant update (seen_at) on user_notices to authenticated;

drop policy if exists "read my notices" on user_notices;
create policy "read my notices" on user_notices for select using (user_id = auth.uid());

drop policy if exists "mark my notices seen" on user_notices;
create policy "mark my notices seen" on user_notices for update using (user_id = auth.uid()) with check (user_id = auth.uid());

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
  v_title text;
  v_name text;
begin
  if v_me is null then
    raise exception 'Sign in required';
  end if;

  select initiator_id, title into v_owner, v_title from projects where id = p_project_id;
  if v_owner is null then
    raise exception 'No such project.';
  end if;
  select display_name into v_name from profiles where id = v_me;

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

  insert into user_notices (user_id, kind, project_id, project_title, from_name, detail)
  values (v_target, case when v_owner = v_me then 'project_handed_over' else 'member_left' end, p_project_id, v_title, v_name, v_kept);

  return v_kept;
end;
$$;

revoke execute on function leave_project(uuid, uuid) from public, anon;
grant execute on function leave_project(uuid, uuid) to authenticated;
