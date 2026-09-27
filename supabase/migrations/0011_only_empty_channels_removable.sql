-- 0011 — only EMPTY channels can be removed (by the initiator). A channel
-- holding recordings is never deleted from above, not even the initiator's own;
-- delete the clips first.
--
-- The "does this channel have clips?" check runs inside a SECURITY DEFINER
-- helper. Asking the clips table directly from a tracks policy loops forever
-- ("infinite recursion detected in policy for relation tracks"), because the
-- clips access rules in turn read the tracks table.
--
-- Safe to run more than once, and replaces any earlier version of this rule
-- (including the version in 0009).

create or replace function track_has_clips(p_track_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from clips where track_id = p_track_id);
$$;

grant execute on function track_has_clips(uuid) to authenticated;

drop policy if exists "only the initiator removes an empty channel" on tracks;
drop policy if exists "initiator removes an empty or own channel" on tracks;

create policy "only the initiator removes an empty channel" on tracks
  for delete to authenticated
  using (
    exists (select 1 from projects p where p.id = tracks.project_id and p.initiator_id = auth.uid())
    and not track_has_clips(tracks.id)
  );
