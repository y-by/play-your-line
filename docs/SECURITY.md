# Database functions: who can call what

Written 2026-10-10 after the Supabase security advisor listed "SECURITY DEFINER" functions that can be called through
the API. A SECURITY DEFINER function runs with its owner's rights, so every one of them has to check, inside, who is
calling. This page records each function, why it can be called, and what it checks. Migration `0045` applies the
cleanup; the query at its bottom shows the real permissions in your database.

Rule of thumb: nothing is callable without signing in, except the two invite previews on purpose.

## Callable without signing in (on purpose)

| Function | Why | What it returns |
| --- | --- | --- |
| `get_invite_details(token)` | The invite landing page explains a channel invite before sign-in. | Project title, instrument, invite status for a valid token. |
| `get_project_invite_details(token)` | Same for Mixer / Listener invites. | Project title, role, status. |

A token is a random uuid, so it cannot be guessed. If this ever feels too open, the page could ask for sign-in first.

## Callable by signed-in users: the app's own actions

Each checks the caller (`auth.uid()`) and the role inside; a wrong caller gets an error.

| Function | Who may succeed |
| --- | --- |
| `accept_track_invite`, `accept_project_invite` | The signed-in person holding a valid pending token. |
| `claim_own_track` | The Owner, for an empty channel. |
| `assign_track_to_user`, `reassign_track` | The Owner (a channel with recordings cannot be reassigned). |
| `add_project_member`, `set_mixer` | The Owner. |
| `find_profile_by_email` | Any signed-in user (used when the Owner adds someone by email). Accepted risk: it can look up whether an email has an account. |
| `upsert_own_profile` | Only writes the caller's own profile. |
| `set_master_mix`, `set_group_mix` | The Owner or the Mixer of that project. |
| `create_track_group`, `rename_track_group`, `delete_track_group`, `set_track_group` | The Owner of that project. |

## Callable by signed-in users: helpers the access rules use

`is_project_participant`, `is_project_contributor`, `can_write_notes`, `track_has_clips`. The access rules (RLS) run as
the signed-in user, so they need permission to call these. They only answer yes or no. `set_mixer` also asks
`is_project_participant` about another person, so these helpers cannot be limited to the caller's own id. Accepted: the
advisor will keep listing them.

## Not callable by anyone

The trigger functions `guard_track_columns`, `guard_project_notes`, `guard_tempo_lock`, `guard_track_assignment`,
`guard_mixer_change`. Triggers run without the permission to call them, so it is removed (0045). The debug functions
`debug_whoami` and `debug_test_insert` are dropped (0045).

## Owner dashboard (0046)

| Function | Who | What it checks |
| --- | --- | --- |
| `pyl_pre_request`, `is_admin`, `is_blocked`, `can_see_hidden_project` | Everyone, even signed out | They answer about the caller only (or say no when signed out). The first runs before every API request and refuses a blocked account; the others are used by the access rules, including the public Published list. |
| `my_account_status`, `touch_last_seen` | Signed-in users | Only the caller's own row. |
| `admin_users`, `admin_projects`, `admin_activity`, `admin_set_blocked`, `admin_force_signout`, `admin_set_hidden`, `admin_unpublish`, `admin_set_mixer`, `admin_remove_member`, `admin_transfer_ownership`, `require_admin` | Signed-in users | Each calls `require_admin` first: only a person with `user_status.is_admin` gets past it. |
| `admin_storage_by_project` | Nobody directly | Used inside `admin_projects`. |
| `admin_health` (0049) | Signed-in users | Calls `require_admin` first. Read-only: file sizes, database size, leftover files, unused takes, missing files. |

Rules added: the admin READS every row of every project table and every file in `takes`, `covers` and `previews`, and may
delete files there and any project row (for "Delete project"). The admin does NOT get write access to channels, clips,
notes or mixes: observing is read-only in the database, not only on screen. A blocked account is stopped three ways: the
pre-request check (every REST / RPC call), a restrictive "not blocked" rule on every table and on storage, and the app's
blocked screen. `user_status` has no write rules at all; only the functions above change it.

## Master up to +6 dB and moving clips (0047, 0048)

| Function / rule | Who | What it checks |
| --- | --- | --- |
| `set_master_mix` (replaced in 0047) | Signed-in Owner or Mixer of that project | The volume is 0 to 2 (up to +6 dB), the effects are a small object. The `projects` check on `master_volume` was widened to match. |
| `move_clip` (0048) | Signed-in, not blocked | The clip exists; both channels are in the same project and assigned to the SAME player; the caller is that player or the project's Owner; the clip fits inside the new take; the new take's file is already in storage under the destination channel. Then one step: add the take, remove the old clip, add the new clip. Execute is revoked from `public` and `anon`. |
| Storage insert rule "initiator uploads a moved take file" (0048) | The project's Owner | May put a file under the folder of a channel that has a player, so the Owner can move a player's clip. It only lets a file land: no take row or clip is created except through `move_clip`, which checks everything above. A stray file is removed by the unused-file cleanup. |

The Owner still cannot record on, trim, split, fade or delete a player's clips; the only thing the Owner may do to a player's recordings is move a clip
between that player's own channels.
