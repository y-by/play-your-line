-- Replaces the SELECT policies on projects/tracks/takes so none of them
-- depend on is_project_participant() or any subquery back onto a table
-- whose own policy could, in turn, depend on this one. Every "am I the
-- initiator / am I assigned" check is now a direct column comparison on the
-- row itself (or one level of join with a direct comparison at the bottom),
-- which is what makes INSERT ... RETURNING (used by every .insert().select()
-- call in the app) evaluate correctly and consistently, not just plain
-- multi-statement SELECTs.

drop policy "projects visible to participants or once published" on projects;
create policy "projects visible to participants or once published" on projects
  for select using (
    status = 'published'
    or initiator_id = auth.uid()
    or exists (select 1 from tracks where project_id = projects.id and assigned_user_id = auth.uid())
  );

drop policy "tracks visible with their project" on tracks;
create policy "tracks visible with their project" on tracks
  for select using (
    assigned_user_id = auth.uid()
    or exists (
      select 1 from projects p
      where p.id = tracks.project_id and (p.status = 'published' or p.initiator_id = auth.uid())
    )
  );

drop policy "takes visible with their track" on takes;
create policy "takes visible with their track" on takes
  for select using (
    exists (
      select 1 from tracks t
      join projects p on p.id = t.project_id
      where t.id = takes.track_id
        and (p.status = 'published' or p.initiator_id = auth.uid() or t.assigned_user_id = auth.uid())
    )
  );
