-- Health check (read-only). Paste into the Supabase SQL editor to see the real numbers behind the Free plan limits.
-- The same numbers (rows 4, 8, 9 and more) are on the Admin page's Health row once migration 0049 is run; this is the
-- fallback that needs nothing from the app. Supabase's own dashboard figure can be days behind.
-- Row 4: total storage, the Free limit is 1024 MB.  Row 8: recording files with no take (leftovers).
-- Row 7: unused takes (clean up when their player opens the project).  Row 9: database size, limit 500 MB.
with sz as (
  select bucket_id, (metadata->>'size')::bigint as bytes, name
  from storage.objects
  where bucket_id in ('takes', 'covers', 'previews')
),
unused as (
  select k.id, k.storage_path
  from takes k
  where not exists (select 1 from clips c where c.take_id = k.id)
    and not exists (select 1 from tracks t where t.active_take_id = k.id)
)
select * from (
  select 1 as n, 'Storage: takes (MB)' as what,
         round(coalesce(sum(bytes) filter (where bucket_id = 'takes'), 0) / 1048576.0, 1)::text as value from sz
  union all select 2, 'Storage: covers (MB)',
         round(coalesce(sum(bytes) filter (where bucket_id = 'covers'), 0) / 1048576.0, 1)::text from sz
  union all select 3, 'Storage: previews (MB)',
         round(coalesce(sum(bytes) filter (where bucket_id = 'previews'), 0) / 1048576.0, 1)::text from sz
  union all select 4, 'Storage: TOTAL (MB), Free limit is 1024',
         round(coalesce(sum(bytes), 0) / 1048576.0, 1)::text from sz
  union all select 5, 'Files in storage', count(*)::text from sz
  union all select 6, 'Unused takes (no clip, not active): count', count(*)::text from unused
  union all select 7, 'Unused takes: size (MB), safe to clean up',
         round(coalesce(sum(s.bytes), 0) / 1048576.0, 1)::text
         from unused u left join sz s on s.bucket_id = 'takes' and s.name = u.storage_path
  union all select 8, 'Files with no take row (leftover files): count',
         count(*)::text from sz s
         where s.bucket_id = 'takes' and not exists (select 1 from takes k where k.storage_path = s.name)
  union all select 9, 'Database size (MB), Free limit is 500',
         round(pg_database_size(current_database()) / 1048576.0, 1)::text
  union all select 10, 'People (profiles)', count(*)::text from profiles
  union all select 11, 'People blocked', count(*)::text from user_status where blocked
  union all select 12, 'Seen in the last 7 days',
         count(*)::text from user_status where last_seen_at > now() - interval '7 days'
  union all select 13, 'Projects (draft / published)',
         count(*) filter (where status = 'draft')::text || ' / ' || count(*) filter (where status = 'published')::text from projects
  union all select 14, 'Hidden projects', count(*)::text from projects where hidden
  union all select 15, 'Channels / clips / takes',
         (select count(*) from tracks)::text || ' / ' || (select count(*) from clips)::text || ' / ' || (select count(*) from takes)::text
  union all select 16, 'Published without a listening copy',
         count(*)::text from projects where status = 'published' and preview_path is null
  union all select 17, 'Takes whose recording file is missing (must be 0)',
         count(*)::text from takes k
         where not exists (select 1 from sz s where s.bucket_id = 'takes' and s.name = k.storage_path)
) r
order by n;
