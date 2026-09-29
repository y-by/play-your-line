-- 0015 — anyone already in the song may add a new (empty) channel; only the
-- Owner still sends the invite that lets a player claim it. This only
-- widens who can INSERT a track row — every other rule (who can invite,
-- who can record on a channel, who can remove one) is unchanged.
--
-- Safe to run more than once.

drop policy if exists "only the initiator adds channels" on tracks;
drop policy if exists "any participant adds a channel" on tracks;

create policy "any participant adds a channel" on tracks
  for insert with check (
    exists (select 1 from projects p where p.id = project_id and is_project_participant(p.id, auth.uid()))
  );
