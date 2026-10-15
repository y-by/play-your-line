-- 0046 — the owner dashboard (/admin): the system owner monitors and controls every person and every project.
--
-- What it adds:
--   1. `user_status`: one row per person with `is_admin`, `blocked` (+ reason, when), `signout_after` (force a sign-out)
--      and `last_seen_at` / `last_project_id` (the app sends a heartbeat about once a minute while it is open).
--      Nobody writes it directly; only the functions below do. A person reads their own row, the admin reads all.
--   2. `is_admin()` and `is_blocked()`, the two checks everything else uses.
--   3. Read-only access for the admin to every project (all tables + the three storage buckets), so the admin can open
--      any project as an OBSERVER. The screen gives an observer no roles, so every edit control stays off.
--   4. Blocking: a blocked person can still sign in, but
--        * every API request is refused before it runs (a PostgREST "pre-request" check, `pyl_pre_request`), and
--        * every table and stored file has a RESTRICTIVE rule "not blocked" (also stops live updates reaching them),
--      and the app shows them a "blocked" screen. (Nothing here can stop the Google sign-in itself; that would need an
--      Edge Function with the service key — not built, by the owner's choice on 2026-10-15.)
--   5. Hidden projects: `projects.hidden`. A hidden project disappears for everyone except its own people and the admin
--      (including the Published list and its files), without changing anything else about it.
--   6. Admin functions: lists of people / projects / activity, block, force sign-out, unpublish, hide, transfer
--      ownership, set or clear the Mixer, remove someone from a project, and delete any project (the app deletes the
--      files first, as for the Owner, then the row — allowed to the admin by the policies here).
--
-- AFTER RUNNING: make yourself the admin (the last statement below does it for janayby@gmail.com; change the email if
-- you sign in to Play Your Line with another Google account), then reload the app: "Admin" appears in the side menu.
--
-- Safe to run more than once. The OWNER RUNS THIS in the Supabase SQL editor. (The move_take migration planned for
-- local DAW routing becomes 0047.)

begin;

-- ---- 1. user_status -------------------------------------------------------------------------------------------------

create table if not exists user_status (
  user_id uuid primary key references auth.users(id) on delete cascade,
  is_admin boolean not null default false,
  blocked boolean not null default false,
  blocked_reason text,
  blocked_at timestamptz,
  signout_after timestamptz,
  last_seen_at timestamptz,
  last_project_id uuid references projects(id) on delete set null
);

alter table user_status enable row level security;
revoke all on user_status from anon, authenticated;
grant select on user_status to authenticated;

-- ---- 2. The two checks ----------------------------------------------------------------------------------------------

create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_admin from user_status where user_id = auth.uid()), false);
$$;

create or replace function is_blocked()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select blocked from user_status where user_id = auth.uid()), false);
$$;

revoke execute on function is_admin() from public;
revoke execute on function is_blocked() from public;
grant execute on function is_admin() to anon, authenticated;
grant execute on function is_blocked() to anon, authenticated;

drop policy if exists "people read their own status, the admin reads all" on user_status;
create policy "people read their own status, the admin reads all" on user_status
  for select to authenticated using (user_id = auth.uid() or (select is_admin()));

-- ---- 3 + 4. Admin reads everything; blocked people read and write nothing -------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['profiles', 'projects', 'tracks', 'takes', 'clips', 'track_invites', 'project_listeners',
                           'project_invites', 'project_notes', 'track_groups'] loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    execute format('drop policy if exists "admin reads everything" on public.%I', t);
    execute format('create policy "admin reads everything" on public.%I for select to authenticated using ((select is_admin()))', t);
    execute format('drop policy if exists "blocked people do nothing" on public.%I', t);
    execute format('create policy "blocked people do nothing" on public.%I as restrictive for all to authenticated '
                   'using (not (select is_blocked())) with check (not (select is_blocked()))', t);
  end loop;
end $$;

drop policy if exists "admin reads every file" on storage.objects;
create policy "admin reads every file" on storage.objects
  for select to authenticated using (bucket_id in ('takes', 'covers', 'previews') and (select is_admin()));

drop policy if exists "admin deletes project files" on storage.objects;
create policy "admin deletes project files" on storage.objects
  for delete to authenticated using (bucket_id in ('takes', 'covers', 'previews') and (select is_admin()));

drop policy if exists "blocked people do nothing" on storage.objects;
create policy "blocked people do nothing" on storage.objects as restrictive
  for all to authenticated using (not (select is_blocked())) with check (not (select is_blocked()));

drop policy if exists "admin deletes any project" on projects;
create policy "admin deletes any project" on projects
  for delete to authenticated using ((select is_admin()));

-- Every API request from a blocked person is refused before it runs. Only `my_account_status` gets through, so the app
-- can tell them why. Signed-out requests (no user) pass untouched.
create or replace function pyl_pre_request()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null
     and coalesce(current_setting('request.path', true), '') not like '%/rpc/my_account_status'
     and exists (select 1 from user_status where user_id = auth.uid() and blocked) then
    raise exception 'account_blocked: this account is blocked' using errcode = 'P0001', hint = 'account_blocked';
  end if;
end;
$$;

revoke execute on function pyl_pre_request() from public;
grant execute on function pyl_pre_request() to anon, authenticated;

-- The PostgREST setting only exists on Supabase (role authenticator); elsewhere this is skipped.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    execute 'alter role authenticator set pgrst.db_pre_request = ''public.pyl_pre_request''';
    perform pg_notify('pgrst', 'reload config');
  end if;
end $$;

-- ---- 5. Hidden projects ---------------------------------------------------------------------------------------------

alter table projects add column if not exists hidden boolean not null default false;

-- Callable without signing in (the Published list is public), so it must never fail for anon: it just says no.
create or replace function can_see_hidden_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and (
    coalesce((select is_admin from user_status where user_id = auth.uid()), false)
    or is_project_participant(p_project_id, auth.uid())
  );
$$;

revoke execute on function can_see_hidden_project(uuid) from public;
grant execute on function can_see_hidden_project(uuid) to anon, authenticated;

drop policy if exists "hidden projects only for their people and the admin" on projects;
create policy "hidden projects only for their people and the admin" on projects as restrictive
  for select using (not hidden or can_see_hidden_project(id));

-- ---- Heartbeat and the person's own status --------------------------------------------------------------------------

-- Called by the app about once a minute while it is open (and when a project is opened).
create or replace function touch_last_seen(p_project_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;
  end if;
  insert into user_status (user_id, last_seen_at, last_project_id)
  values (auth.uid(), now(), (select id from projects where id = p_project_id))
  on conflict (user_id) do update
    set last_seen_at = excluded.last_seen_at, last_project_id = excluded.last_project_id;
end;
$$;

create or replace function my_account_status()
returns table (is_admin boolean, blocked boolean, blocked_reason text, signout_after timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(s.is_admin, false), coalesce(s.blocked, false), s.blocked_reason, s.signout_after
  from (select auth.uid() as uid) me
  left join user_status s on s.user_id = me.uid
  where me.uid is not null;
$$;

revoke execute on function touch_last_seen(uuid) from public, anon;
revoke execute on function my_account_status() from public, anon;
grant execute on function touch_last_seen(uuid) to authenticated;
grant execute on function my_account_status() to authenticated;

-- Live: the app hears at once when its own row changes (blocked, forced sign-out).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_status') then
    alter publication supabase_realtime add table public.user_status;
  end if;
end $$;

-- ---- 6. Admin functions ---------------------------------------------------------------------------------------------

create or replace function require_admin()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not coalesce((select is_admin from user_status where user_id = auth.uid()), false) then
    raise exception 'Only the system owner can do this.';
  end if;
end;
$$;

-- Bytes stored per project folder, across the three buckets.
create or replace function admin_storage_by_project()
returns table (project_id text, takes_bytes bigint, other_bytes bigint, files integer)
language sql
stable
security definer
set search_path = public
as $$
  select (storage.foldername(o.name))[1],
         coalesce(sum((o.metadata->>'size')::bigint) filter (where o.bucket_id = 'takes'), 0)::bigint,
         coalesce(sum((o.metadata->>'size')::bigint) filter (where o.bucket_id <> 'takes'), 0)::bigint,
         count(*)::int
  from storage.objects o
  where o.bucket_id in ('takes', 'covers', 'previews')
  group by 1;
$$;

create or replace function admin_users()
returns table (
  user_id uuid, display_name text, email text, avatar_url text, joined_at timestamptz, last_sign_in_at timestamptz,
  last_seen_at timestamptz, last_project_id uuid, last_project_title text, is_admin boolean, blocked boolean,
  blocked_reason text, blocked_at timestamptz, owned_projects integer, member_projects integer, takes integer,
  takes_bytes bigint, notes integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform require_admin();
  return query
  with membership as (
    select p.id as project_id, p.initiator_id as uid from projects p
    union select p.id, p.mixer_id from projects p where p.mixer_id is not null
    union select t.project_id, t.assigned_user_id from tracks t where t.assigned_user_id is not null
    union select l.project_id, l.user_id from project_listeners l
  ),
  take_sizes as (
    select t.created_by as uid, count(*)::int as n,
           coalesce(sum((o.metadata->>'size')::bigint), 0)::bigint as bytes
    from takes t
    left join storage.objects o on o.bucket_id = 'takes' and o.name = t.storage_path
    group by t.created_by
  )
  select pr.id, pr.display_name, coalesce(pr.email, u.email)::text, pr.avatar_url, pr.created_at, u.last_sign_in_at,
         s.last_seen_at, s.last_project_id, lp.title, coalesce(s.is_admin, false), coalesce(s.blocked, false),
         s.blocked_reason, s.blocked_at,
         (select count(*)::int from projects p where p.initiator_id = pr.id),
         (select count(distinct m.project_id)::int from membership m where m.uid = pr.id),
         coalesce(ts.n, 0), coalesce(ts.bytes, 0::bigint),
         (select count(*)::int from project_notes n where n.author_id = pr.id)
  from profiles pr
  left join auth.users u on u.id = pr.id
  left join user_status s on s.user_id = pr.id
  left join projects lp on lp.id = s.last_project_id
  left join take_sizes ts on ts.uid = pr.id
  order by s.last_seen_at desc nulls last, pr.created_at desc;
end;
$$;

create or replace function admin_projects()
returns table (
  project_id uuid, title text, status text, hidden boolean, created_at timestamptz, updated_at timestamptz,
  published_at timestamptz, cover_path text, owner_id uuid, owner_name text, mixer_id uuid, channels integer,
  clips integer, takes integer, notes integer, takes_bytes bigint, other_bytes bigint, files integer, members jsonb,
  last_activity timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform require_admin();
  return query
  with st as (select * from admin_storage_by_project())
  select p.id, p.title, p.status, p.hidden, p.created_at, p.updated_at, p.published_at, p.cover_path,
         p.initiator_id, owner.display_name, p.mixer_id,
         (select count(*)::int from tracks t where t.project_id = p.id),
         (select count(*)::int from clips c join tracks t on t.id = c.track_id where t.project_id = p.id),
         (select count(*)::int from takes k join tracks t on t.id = k.track_id where t.project_id = p.id),
         (select count(*)::int from project_notes n where n.project_id = p.id),
         coalesce(st.takes_bytes, 0::bigint), coalesce(st.other_bytes, 0::bigint), coalesce(st.files, 0),
         (
           select coalesce(jsonb_agg(jsonb_build_object(
                    'userId', m.uid, 'name', pr.display_name, 'roles', m.roles,
                    'channels', m.channels, 'canPlay', m.can_play) order by m.rank, pr.display_name), '[]'::jsonb)
           from (
             select x.uid,
                    array_remove(array[
                      case when bool_or(x.r = 'owner') then 'owner' end,
                      case when bool_or(x.r = 'mixer') then 'mixer' end,
                      case when bool_or(x.r = 'player') then 'player' end,
                      case when bool_or(x.r = 'listener') then 'listener' end], null) as roles,
                    array_remove(array_agg(x.channel order by x.channel), null) as channels,
                    bool_or(x.can_play) as can_play,
                    min(case x.r when 'owner' then 0 when 'mixer' then 1 when 'player' then 2 else 3 end) as rank
             from (
               select p.initiator_id as uid, 'owner'::text as r, null::text as channel, false as can_play
               union all select p.mixer_id, 'mixer', null, false where p.mixer_id is not null
               union all select t.assigned_user_id, 'player', t.instrument, false from tracks t
                 where t.project_id = p.id and t.assigned_user_id is not null
               union all select l.user_id, case when l.can_play then 'player' else 'listener' end, null, l.can_play
                 from project_listeners l where l.project_id = p.id
             ) x
             group by x.uid
           ) m
           left join profiles pr on pr.id = m.uid
         ),
         greatest(p.updated_at,
                  (select max(k.created_at) from takes k join tracks t on t.id = k.track_id where t.project_id = p.id),
                  (select max(n.updated_at) from project_notes n where n.project_id = p.id))
  from projects p
  left join profiles owner on owner.id = p.initiator_id
  left join st on st.project_id = p.id::text
  order by 20 desc nulls last;
end;
$$;

-- What happened lately, newest first, across the whole system.
create or replace function admin_activity(p_limit integer default 150)
returns table (at timestamptz, kind text, user_id uuid, user_name text, project_id uuid, project_title text, detail text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform require_admin();
  return query
  select e.at, e.kind, e.uid, pr.display_name, e.pid, p.title, e.detail
  from (
    select pr2.created_at as at, 'signed-up'::text as kind, pr2.id as uid, null::uuid as pid, null::text as detail from profiles pr2
    union all select p2.created_at, 'created-project', p2.initiator_id, p2.id, null from projects p2
    union all select p2.published_at, 'published', p2.initiator_id, p2.id, null from projects p2 where p2.published_at is not null
    union all select k.created_at, 'recorded', k.created_by, t.project_id, t.instrument
      from takes k join tracks t on t.id = k.track_id
    union all select n.created_at, 'wrote-note', n.author_id, n.project_id, left(n.body, 80) from project_notes n
    union all select l.created_at, 'joined-project', l.user_id, l.project_id,
      case when l.can_play then 'as a player' else 'as a listener' end from project_listeners l
    union all select t.created_at, 'added-channel', coalesce(t.assigned_user_id, p2.initiator_id), t.project_id, t.instrument
      from tracks t join projects p2 on p2.id = t.project_id
  ) e
  left join profiles pr on pr.id = e.uid
  left join projects p on p.id = e.pid
  order by e.at desc
  limit greatest(1, least(coalesce(p_limit, 150), 500));
end;
$$;

create or replace function admin_set_blocked(p_user_id uuid, p_blocked boolean, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform require_admin();
  if p_user_id = auth.uid() and p_blocked then
    raise exception 'You cannot block yourself.';
  end if;
  insert into user_status (user_id, blocked, blocked_reason, blocked_at)
  values (p_user_id, p_blocked, case when p_blocked then nullif(trim(p_reason), '') end, case when p_blocked then now() end)
  on conflict (user_id) do update
    set blocked = excluded.blocked, blocked_reason = excluded.blocked_reason, blocked_at = excluded.blocked_at;
end;
$$;

-- The person's app signs out at once (live) or the next time it starts. They can sign in again (that is what "block" is for).
create or replace function admin_force_signout(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform require_admin();
  insert into user_status (user_id, signout_after) values (p_user_id, now())
  on conflict (user_id) do update set signout_after = now();
end;
$$;

create or replace function admin_set_hidden(p_project_id uuid, p_hidden boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform require_admin();
  update projects set hidden = p_hidden where id = p_project_id;
end;
$$;

-- Back to a draft. The app removes the listening copy file afterwards (the admin may delete files).
create or replace function admin_unpublish(p_project_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_preview text;
begin
  perform require_admin();
  select preview_path into v_preview from projects where id = p_project_id;
  update projects set status = 'draft', published_at = null, preview_path = null where id = p_project_id;
  return v_preview;
end;
$$;

create or replace function admin_set_mixer(p_project_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform require_admin();
  if p_user_id is not null and not exists (select 1 from profiles where id = p_user_id) then
    raise exception 'No such person.';
  end if;
  perform set_config('pyl.assign_via_rpc', 'on', true);
  update projects set mixer_id = p_user_id where id = p_project_id;
end;
$$;

-- Takes the person out of the project: listener / added player, Mixer, and every channel of theirs that has no
-- recordings (those become free). Channels WITH recordings stay theirs (nobody touches a player's recordings);
-- the number of those is returned. The Owner cannot be removed; transfer the ownership first.
create or replace function admin_remove_member(p_project_id uuid, p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kept integer;
begin
  perform require_admin();
  if exists (select 1 from projects where id = p_project_id and initiator_id = p_user_id) then
    raise exception 'This person is the Owner. Transfer the ownership first.';
  end if;
  perform set_config('pyl.assign_via_rpc', 'on', true);
  delete from project_listeners where project_id = p_project_id and user_id = p_user_id;
  update projects set mixer_id = null where id = p_project_id and mixer_id = p_user_id;
  update tracks t set assigned_user_id = null
  where t.project_id = p_project_id and t.assigned_user_id = p_user_id
    and not exists (select 1 from clips c where c.track_id = t.id);
  select count(*)::int into v_kept from tracks t where t.project_id = p_project_id and t.assigned_user_id = p_user_id;
  return v_kept;
end;
$$;

-- Hands the project to someone already in it. The old Owner stays in it as a listener (unless they play a channel).
create or replace function admin_transfer_ownership(p_project_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old uuid;
begin
  perform require_admin();
  select initiator_id into v_old from projects where id = p_project_id;
  if v_old is null then
    raise exception 'No such project.';
  end if;
  if v_old = p_user_id then
    return;
  end if;
  if not is_project_participant(p_project_id, p_user_id) then
    raise exception 'The new Owner has to be in the project already.';
  end if;
  update projects set initiator_id = p_user_id, mixer_id = case when mixer_id = p_user_id then null else mixer_id end
  where id = p_project_id;
  delete from project_listeners where project_id = p_project_id and user_id = p_user_id;
  insert into project_listeners (project_id, user_id) values (p_project_id, v_old) on conflict do nothing;
end;
$$;

-- Admin functions: signed-in only (each checks for the admin inside).
do $$
declare
  f text;
begin
  foreach f in array array['require_admin()', 'admin_storage_by_project()', 'admin_users()', 'admin_projects()',
                           'admin_activity(integer)', 'admin_set_blocked(uuid, boolean, text)', 'admin_force_signout(uuid)',
                           'admin_set_hidden(uuid, boolean)', 'admin_unpublish(uuid)', 'admin_set_mixer(uuid, uuid)',
                           'admin_remove_member(uuid, uuid)', 'admin_transfer_ownership(uuid, uuid)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- admin_storage_by_project is only used inside admin_projects; nobody needs to call it directly.
revoke execute on function admin_storage_by_project() from authenticated;

-- ---- Make the system owner the admin ----------------------------------------------------------------------------------

insert into user_status (user_id, is_admin)
select id, true from auth.users where lower(email) = lower('janayby@gmail.com')
on conflict (user_id) do update set is_admin = true;

commit;

-- Check: should list exactly one row, you.
-- select u.email, s.is_admin from user_status s join auth.users u on u.id = s.user_id where s.is_admin;
