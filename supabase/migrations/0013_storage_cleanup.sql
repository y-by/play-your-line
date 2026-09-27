-- 0013 — lets the app delete recording FILES it no longer needs.
--
-- Until now nothing could delete from the private "takes" bucket, so files
-- left behind by deleted clips or removed channels piled up.
--
--   * A channel's player may delete files in their own channel's folder.
--   * The initiator may delete files only in a channel that has NO clips
--     (i.e. when removing an empty channel) — never a player's recordings.
--
-- File paths look like  <projectId>/<trackId>/<takeId>.wav
-- Safe to run more than once.

drop policy if exists "player or initiator deletes unused take files" on storage.objects;

create policy "player or initiator deletes unused take files" on storage.objects
  for delete using (
    bucket_id = 'takes'
    and exists (
      select 1 from tracks t
      join projects p on p.id = t.project_id
      where t.project_id::text = (storage.foldername(name))[1]
        and t.id::text = (storage.foldername(name))[2]
        and (
          t.assigned_user_id = auth.uid()
          or (p.initiator_id = auth.uid() and not track_has_clips(t.id))
        )
    )
  );

-- Removing an empty channel: the initiator also needs to clear leftover take
-- rows of that channel. (Cascade handles them when the channel row goes, so
-- nothing extra is required here.)
