-- 0057 — "Send feedback": a person reports a problem or an idea from inside the app, optionally with a screenshot, and the
-- system owner reads it on the Admin page (Feedback tab).
--
--   * table `feedback`        the message, who sent it, which project they were in, the page, the app version, their
--                             browser and screen, a status (new / seen / done), and the screenshot's path
--   * private bucket `feedback`  JPEG / PNG / WebP up to 4 MB, stored as <userId>/<reportId>.jpg
--   * who may                 anyone signed in sends (not a blocked account), reads their own reports; the admin reads and
--                             manages all of them; nobody else sees a report or its picture
--   * flood guard             at most 20 reports an hour per person
--   * admin functions         admin_feedback(), admin_set_feedback_status(), admin_delete_feedback()
--   * also                    admin_health() now counts the feedback pictures in the storage total
--
-- Safe to run more than once. The OWNER RUNS THIS in the Supabase SQL editor (needs 0046 and 0049 first).

begin;

create table if not exists feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  message text not null check (char_length(btrim(message)) between 3 and 4000),
  screenshot_path text,
  project_id uuid references projects(id) on delete set null,
  page text check (page is null or char_length(page) <= 300),
  app_build text check (app_build is null or char_length(app_build) <= 40),
  device text check (device is null or char_length(device) <= 400),
  status text not null default 'new' check (status in ('new', 'seen', 'done'))
);

create index if not exists feedback_created_idx on feedback (created_at desc);

alter table feedback enable row level security;
revoke all on feedback from anon, authenticated;
grant select, insert on feedback to authenticated;

drop policy if exists "people send feedback" on feedback;
create policy "people send feedback" on feedback
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'new'
    and (screenshot_path is null or screenshot_path like (select auth.uid())::text || '/%')
  );

drop policy if exists "people read their own feedback, the admin reads all" on feedback;
create policy "people read their own feedback, the admin reads all" on feedback
  for select to authenticated
  using (user_id = (select auth.uid()) or (select is_admin()));

drop policy if exists "blocked people do nothing" on feedback;
create policy "blocked people do nothing" on feedback as restrictive
  for all to authenticated
  using (not (select is_blocked())) with check (not (select is_blocked()));

-- A flood guard: nobody sends more than 20 reports an hour.
create or replace function guard_feedback_rate()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (select count(*) from feedback where user_id = new.user_id and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Too many reports in the last hour. Try again later.';
  end if;
  return new;
end;
$$;

revoke execute on function guard_feedback_rate() from public, anon, authenticated;

drop trigger if exists feedback_rate on feedback;
create trigger feedback_rate before insert on feedback for each row execute function guard_feedback_rate();

-- ---- Screenshots ----------------------------------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('feedback', 'feedback', false, 4194304, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types, public = false;

drop policy if exists "people add their own report picture" on storage.objects;
create policy "people add their own report picture" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'feedback' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "people read their own report pictures, the admin reads all" on storage.objects;
create policy "people read their own report pictures, the admin reads all" on storage.objects
  for select to authenticated
  using (bucket_id = 'feedback' and ((storage.foldername(name))[1] = (select auth.uid())::text or (select is_admin())));

drop policy if exists "admin deletes report pictures" on storage.objects;
create policy "admin deletes report pictures" on storage.objects
  for delete to authenticated
  using (bucket_id = 'feedback' and (select is_admin()));

-- ---- Admin functions ------------------------------------------------------------------------------------------------

create or replace function admin_feedback(p_limit integer default 200)
returns table (
  id uuid, created_at timestamptz, user_id uuid, user_name text, email text, message text, screenshot_path text,
  project_id uuid, project_title text, page text, app_build text, device text, status text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform require_admin();
  return query
  select f.id, f.created_at, f.user_id, pr.display_name, coalesce(pr.email, u.email)::text, f.message, f.screenshot_path,
         f.project_id, p.title, f.page, f.app_build, f.device, f.status
  from feedback f
  left join profiles pr on pr.id = f.user_id
  left join auth.users u on u.id = f.user_id
  left join projects p on p.id = f.project_id
  order by f.created_at desc
  limit greatest(1, least(coalesce(p_limit, 200), 500));
end;
$$;

create or replace function admin_set_feedback_status(p_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform require_admin();
  if p_status not in ('new', 'seen', 'done') then
    raise exception 'Unknown status.';
  end if;
  update feedback set status = p_status where id = p_id;
end;
$$;

-- Returns the picture's path so the app can remove the file too.
create or replace function admin_delete_feedback(p_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_path text;
begin
  perform require_admin();
  select screenshot_path into v_path from feedback where id = p_id;
  delete from feedback where id = p_id;
  return v_path;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array['admin_feedback(integer)', 'admin_set_feedback_status(uuid, text)', 'admin_delete_feedback(uuid)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ---- The Health row counts the report pictures too -------------------------------------------------------------------

create or replace function admin_health()
returns table (
  storage_bytes bigint,
  db_bytes bigint,
  leftover_files integer,
  leftover_bytes bigint,
  unused_takes integer,
  unused_bytes bigint,
  missing_files integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform require_admin();
  return query
  with sz as (
    select o.bucket_id, o.name, coalesce((o.metadata->>'size')::bigint, 0) as bytes
    from storage.objects o
    where o.bucket_id in ('takes', 'covers', 'previews', 'feedback')
  ),
  leftover as (
    select s.name, s.bytes from sz s
    where s.bucket_id = 'takes' and not exists (select 1 from takes k where k.storage_path = s.name)
  ),
  unused as (
    select k.storage_path from takes k
    where not exists (select 1 from clips c where c.take_id = k.id)
      and not exists (select 1 from tracks t where t.active_take_id = k.id)
  )
  select
    (select coalesce(sum(bytes), 0) from sz)::bigint,
    pg_database_size(current_database())::bigint,
    (select count(*) from leftover)::int,
    (select coalesce(sum(bytes), 0) from leftover)::bigint,
    (select count(*) from unused)::int,
    (select coalesce(sum(s.bytes), 0) from unused u join sz s on s.bucket_id = 'takes' and s.name = u.storage_path)::bigint,
    (select count(*) from takes k
       where not exists (select 1 from sz s where s.bucket_id = 'takes' and s.name = k.storage_path))::int;
end;
$$;

commit;

-- Check (as the admin, in the app): Admin > Feedback lists reports. In SQL: select count(*) from feedback;
