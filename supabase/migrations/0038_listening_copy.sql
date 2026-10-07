-- 0038 — a lighter "listening copy" (one MP3 of the final mix) for the Published list.
--
--   * projects.preview_path   path of the MP3 in the private "previews" bucket
--   * "previews" bucket       private; MP3 only, up to 50 MB
--   * who hears it            the project's people, plus everyone once the project is published
--   * who changes it         only the Owner (made when publishing, or with the refresh button on the card)
--
-- Files are stored as <projectId>/<random>.mp3.
-- Safe to run more than once.

alter table projects add column if not exists preview_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('previews', 'previews', false, 52428800, array['audio/mpeg'])
on conflict (id) do nothing;

drop policy if exists "see previews of visible projects" on storage.objects;
drop policy if exists "owner adds a preview" on storage.objects;
drop policy if exists "owner replaces a preview" on storage.objects;
drop policy if exists "owner removes a preview" on storage.objects;

create policy "see previews of visible projects" on storage.objects
  for select using (
    bucket_id = 'previews'
    and exists (
      select 1 from projects p
      where p.id::text = (storage.foldername(name))[1]
        and (p.status = 'published' or is_project_participant(p.id, auth.uid()))
    )
  );

create policy "owner adds a preview" on storage.objects
  for insert with check (
    bucket_id = 'previews'
    and exists (
      select 1 from projects p
      where p.id::text = (storage.foldername(name))[1] and p.initiator_id = auth.uid()
    )
  );

create policy "owner replaces a preview" on storage.objects
  for update using (
    bucket_id = 'previews'
    and exists (
      select 1 from projects p
      where p.id::text = (storage.foldername(name))[1] and p.initiator_id = auth.uid()
    )
  );

create policy "owner removes a preview" on storage.objects
  for delete using (
    bucket_id = 'previews'
    and exists (
      select 1 from projects p
      where p.id::text = (storage.foldername(name))[1] and p.initiator_id = auth.uid()
    )
  );
