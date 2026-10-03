-- 0024 — lets the Owner delete a whole project, including every recording
-- file in it. Deleting the project row already cascades to channels, takes,
-- clips, invites and listeners; this adds the missing piece, storage: until
-- now the Owner could only delete files of channels with NO clips (0013),
-- deliberately never a player's recordings.
--
-- That protection stays for everyday cleanup; this policy only matters
-- because the app removes the files as the first step of "Delete project"
-- (an explicit, confirmed, Owner-only action).
--
-- Safe to run more than once.

drop policy if exists "owner deletes every file of their own project" on storage.objects;

create policy "owner deletes every file of their own project" on storage.objects
  for delete using (
    bucket_id = 'takes'
    and exists (
      select 1 from projects p
      where p.id::text = (storage.foldername(name))[1]
        and p.initiator_id = auth.uid()
    )
  );
