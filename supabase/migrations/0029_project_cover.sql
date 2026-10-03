-- 0029 — a cover image for each project (shown on the project tiles).
--
--   * projects.cover_path   path of the image in the private "covers" bucket
--   * "covers" bucket       private; JPEG/PNG/WebP up to 5 MB (the app also
--                           shrinks the image before uploading)
--   * who sees an image     the project's people, plus everyone once the
--                           project is published (the Published list)
--   * who changes it        only the Owner (upload, replace, remove)
--
-- Files are stored as <projectId>/<random>.jpg.
-- Safe to run more than once.

alter table projects add column if not exists cover_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('covers', 'covers', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "see covers of visible projects" on storage.objects;
drop policy if exists "owner adds a cover" on storage.objects;
drop policy if exists "owner replaces a cover" on storage.objects;
drop policy if exists "owner removes a cover" on storage.objects;

create policy "see covers of visible projects" on storage.objects
  for select using (
    bucket_id = 'covers'
    and exists (
      select 1 from projects p
      where p.id::text = (storage.foldername(name))[1]
        and (p.status = 'published' or is_project_participant(p.id, auth.uid()))
    )
  );

create policy "owner adds a cover" on storage.objects
  for insert with check (
    bucket_id = 'covers'
    and exists (
      select 1 from projects p
      where p.id::text = (storage.foldername(name))[1] and p.initiator_id = auth.uid()
    )
  );

create policy "owner replaces a cover" on storage.objects
  for update using (
    bucket_id = 'covers'
    and exists (
      select 1 from projects p
      where p.id::text = (storage.foldername(name))[1] and p.initiator_id = auth.uid()
    )
  );

create policy "owner removes a cover" on storage.objects
  for delete using (
    bucket_id = 'covers'
    and exists (
      select 1 from projects p
      where p.id::text = (storage.foldername(name))[1] and p.initiator_id = auth.uid()
    )
  );
