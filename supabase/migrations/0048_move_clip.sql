-- 0048 — move a clip from one channel to another channel of the SAME player.
--
-- Who may move: the player the two channels are assigned to, or the project's Owner (initiator) on that player's
-- behalf. Both channels must be in the same project and assigned to the same person. Nothing else about who may edit
-- a recording changes: trimming, splitting, deleting and recording stay with the channel's own player.
--
-- How a move works: a take belongs to one channel and its file lives under that channel's folder, so the app cuts the
-- clip's audio (plus a short handle each side, so it can still be trimmed a little) into a NEW take, uploads it to the
-- destination channel's folder, and then calls move_clip, which in one step adds that take, removes the clip from the
-- old channel and adds it to the new one, with its fades. The old take stays where it was (other clips may use it); the
-- unused-file cleanup removes it when nothing does.
--
-- Safe to run more than once. The OWNER RUNS THIS in the Supabase SQL editor.

-- The Owner uploads the new take's file into the player's channel folder (before today only the channel's own player
-- could). This only lets a file land; the take row and the clip are made by move_clip below, which checks everything.
drop policy if exists "initiator uploads a moved take file" on storage.objects;
create policy "initiator uploads a moved take file" on storage.objects
  for insert with check (
    bucket_id = 'takes'
    and exists (
      select 1 from tracks t
      join projects p on p.id = t.project_id
      where p.initiator_id = auth.uid()
        and t.assigned_user_id is not null
        and t.project_id::text = (storage.foldername(name))[1]
        and t.id::text = (storage.foldername(name))[2]
    )
  );

create or replace function move_clip(
  p_clip_id uuid,
  p_to_track_id uuid,
  p_new_take_id uuid,
  p_take_duration_sec double precision,
  p_new_clip_id uuid,
  p_start_sec double precision,
  p_source_start_sec double precision,
  p_duration_sec double precision,
  p_z integer,
  p_fade_in_sec double precision,
  p_fade_out_sec double precision
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from_track uuid;
  v_project uuid;
  v_from_player uuid;
  v_to_player uuid;
  v_initiator uuid;
  v_path text;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;
  if is_blocked() then
    raise exception 'This account is blocked.';
  end if;

  select c.track_id into v_from_track from clips c where c.id = p_clip_id;
  if v_from_track is null then
    raise exception 'That clip no longer exists.';
  end if;
  if v_from_track = p_to_track_id then
    raise exception 'The clip is already on that channel.';
  end if;

  select t.project_id, t.assigned_user_id into v_project, v_from_player from tracks t where t.id = v_from_track;
  select t.assigned_user_id into v_to_player from tracks t where t.id = p_to_track_id and t.project_id = v_project;
  select p.initiator_id into v_initiator from projects p where p.id = v_project;

  if v_to_player is null and not exists (select 1 from tracks where id = p_to_track_id and project_id = v_project) then
    raise exception 'The other channel is not in this song.';
  end if;
  if v_from_player is null or v_to_player is null or v_from_player <> v_to_player then
    raise exception 'A clip can only move between channels of the same player.';
  end if;
  if auth.uid() <> v_from_player and auth.uid() <> v_initiator then
    raise exception 'Only that player or the owner can move this clip.';
  end if;

  if p_duration_sec <= 0 or p_start_sec < 0 or p_source_start_sec < 0 or p_take_duration_sec <= 0
     or p_source_start_sec + p_duration_sec > p_take_duration_sec + 0.001 then
    raise exception 'The clip does not fit inside its take.';
  end if;

  v_path := v_project::text || '/' || p_to_track_id::text || '/' || p_new_take_id::text || '.wav';
  if not exists (select 1 from storage.objects o where o.bucket_id = 'takes' and o.name = v_path) then
    raise exception 'The moved audio was not uploaded.';
  end if;

  insert into takes (id, track_id, storage_path, duration_sec, created_by)
  values (p_new_take_id, p_to_track_id, v_path, p_take_duration_sec, auth.uid());

  delete from clips where id = p_clip_id;

  insert into clips (id, track_id, take_id, start_sec, source_start_sec, duration_sec, z, fade_in_sec, fade_out_sec)
  values (p_new_clip_id, p_to_track_id, p_new_take_id, p_start_sec, p_source_start_sec, p_duration_sec, p_z,
          greatest(0, least(p_fade_in_sec, p_duration_sec)), greatest(0, least(p_fade_out_sec, p_duration_sec)));
end;
$$;

revoke execute on function move_clip(uuid, uuid, uuid, double precision, uuid, double precision, double precision, double precision, integer, double precision, double precision) from public, anon;
grant execute on function move_clip(uuid, uuid, uuid, double precision, uuid, double precision, double precision, double precision, integer, double precision, double precision) to authenticated;
