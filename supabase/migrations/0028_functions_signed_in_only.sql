-- 0028 — database functions are callable by anyone by default (Postgres grants
-- EXECUTE to PUBLIC on new functions). A live check found that
-- find_profile_by_email answered for a visitor who was not signed in, letting
-- anyone test whether an email has an account. The other functions below
-- refuse inside (no signed-in user), but none of them should be reachable
-- without signing in at all, so lock them to signed-in users.
--
-- Left open on purpose: get_invite_details and get_project_invite_details
-- (the invite page previews an invite before sign-in), and the small helper
-- functions that row-level policies call.
--
-- Safe to run more than once.

revoke execute on function find_profile_by_email(text) from public, anon;
revoke execute on function upsert_own_profile(text, text, text) from public, anon;
revoke execute on function assign_track_to_user(uuid, uuid) from public, anon;
revoke execute on function reassign_track(uuid, uuid) from public, anon;
revoke execute on function claim_own_track(uuid) from public, anon;
revoke execute on function accept_track_invite(uuid) from public, anon;
revoke execute on function accept_project_invite(uuid) from public, anon;
revoke execute on function set_mixer(uuid, uuid) from public, anon;

grant execute on function find_profile_by_email(text) to authenticated;
grant execute on function upsert_own_profile(text, text, text) to authenticated;
grant execute on function assign_track_to_user(uuid, uuid) to authenticated;
grant execute on function reassign_track(uuid, uuid) to authenticated;
grant execute on function claim_own_track(uuid) to authenticated;
grant execute on function accept_track_invite(uuid) to authenticated;
grant execute on function accept_project_invite(uuid) to authenticated;
grant execute on function set_mixer(uuid, uuid) to authenticated;
