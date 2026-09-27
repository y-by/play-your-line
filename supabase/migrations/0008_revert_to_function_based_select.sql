-- Reverts 0007: inlining the cross-table checks directly created a genuine
-- circular dependency (projects' policy queries tracks, tracks' policy
-- queries projects), which Postgres's RLS recursion guard now correctly
-- refuses outright ("infinite recursion detected"). Back to routing through
-- is_project_participant(), which is SECURITY DEFINER (fixed in 0005) and
-- so bypasses RLS internally instead of re-entering these policies.
drop policy "projects visible to participants or once published" on projects;
create policy "projects visible to participants or once published" on projects
  for select using (status = 'published' or is_project_participant(id, auth.uid()));

drop policy "tracks visible with their project" on tracks;
create policy "tracks visible with their project" on tracks
  for select using (
    exists (
      select 1 from projects p
      where p.id = project_id and (p.status = 'published' or is_project_participant(p.id, auth.uid()))
    )
  );

drop policy "takes visible with their track" on takes;
create policy "takes visible with their track" on takes
  for select using (
    exists (
      select 1 from tracks t
      join projects p on p.id = t.project_id
      where t.id = track_id and (p.status = 'published' or is_project_participant(p.id, auth.uid()))
    )
  );
