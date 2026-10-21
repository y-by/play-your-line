-- 0055 — stereo channels: a channel is added as Mono (as before) or Stereo. A stereo channel records two inputs (left
-- and right) as one stereo take. Chosen when the channel is added; it cannot be switched once the channel has
-- recordings (a take is either one signal or two).
--
-- Safe to run more than once. The OWNER RUNS THIS in the Supabase SQL editor (after 0054).

alter table tracks add column if not exists stereo boolean not null default false;

create or replace function guard_track_stereo()
returns trigger
language plpgsql
as $$
begin
  if new.stereo is distinct from old.stereo and exists (select 1 from clips c where c.track_id = old.id) then
    raise exception 'A channel with recordings cannot change between mono and stereo.';
  end if;
  return new;
end;
$$;

drop trigger if exists tracks_guard_stereo on tracks;
create trigger tracks_guard_stereo
  before update of stereo on tracks
  for each row execute function guard_track_stereo();

revoke execute on function guard_track_stereo() from public, anon, authenticated;
