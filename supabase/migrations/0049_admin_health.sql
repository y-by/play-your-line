-- 0049 — the owner dashboard's "Health" row: the real numbers behind the Free plan limits.
--
-- The Supabase dashboard's Storage figure can be days behind (on 2026-10-21 it said 972.6 MB when the files really held
-- 1786.8 MB). This reads the files themselves, so the Admin page always shows the true picture:
--   * storage_bytes    every file in the three buckets (the Free plan allows 1 GB)
--   * db_bytes         the database (the Free plan allows 500 MB)
--   * leftover_files   recording files with no take row (a failed save, a removed channel) and how many bytes they hold
--   * unused_takes     takes no clip uses and no channel has active, and how many bytes they hold (they clean themselves
--                      up when their player opens the project)
--   * missing_files    take rows whose recording file is gone (should always be 0; anything else means a broken clip)
--
-- Admin only: it calls require_admin() first (0046). Read-only, safe to run more than once.
-- The OWNER RUNS THIS in the Supabase SQL editor.

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
    where o.bucket_id in ('takes', 'covers', 'previews')
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

revoke execute on function admin_health() from public, anon;
grant execute on function admin_health() to authenticated;
