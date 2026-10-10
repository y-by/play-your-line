-- 0045 — tighten who can call the database functions (Supabase security advisor, 2026-10-10).
--
-- The advisor lists SECURITY DEFINER functions that can be called through the API (/rest/v1/rpc/...).
--   * "Public can execute": anyone, even without signing in. This migration closes every one of them except the two
--     invite previews, which are open on purpose (the invite page explains an invite before sign-in).
--   * "Signed-in users can execute": most are the app's own actions and each checks the caller inside (see
--     docs/SECURITY.md). The helper functions the access rules call stay callable by signed-in users because the
--     rules run as the signed-in user; they only answer a yes/no.
--
-- What changes:
--   1. debug_whoami and debug_test_insert (leftovers from the early debugging, 0004 and 0006) are dropped.
--   2. The trigger functions (guard_*) lose EXECUTE for everybody: a trigger runs without that permission, and nobody
--      should call them as functions.
--   3. is_project_participant and track_has_clips are no longer callable without signing in.
--
-- Nothing the app does changes. Safe to run more than once. The OWNER RUNS THIS in the Supabase SQL editor.
-- To see the result, run the query at the bottom.

drop function if exists debug_whoami();
drop function if exists debug_test_insert();

revoke execute on function guard_mixer_change() from public, anon, authenticated;
revoke execute on function guard_project_notes() from public, anon, authenticated;
revoke execute on function guard_tempo_lock() from public, anon, authenticated;
revoke execute on function guard_track_assignment() from public, anon, authenticated;
revoke execute on function guard_track_columns() from public, anon, authenticated;

revoke execute on function is_project_participant(uuid, uuid) from public, anon;
grant execute on function is_project_participant(uuid, uuid) to authenticated;
revoke execute on function track_has_clips(uuid) from public, anon;
grant execute on function track_has_clips(uuid) to authenticated;

-- ---- Check: every function in the app's schema, and who can call it -------------------------------------------------
-- select p.proname as function, pg_get_function_identity_arguments(p.oid) as arguments, p.prosecdef as security_definer,
--        has_function_privilege('anon', p.oid, 'execute') as without_sign_in,
--        has_function_privilege('authenticated', p.oid, 'execute') as signed_in
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' order by 1;
-- Expected after this migration: without_sign_in is true only for get_invite_details and get_project_invite_details.
