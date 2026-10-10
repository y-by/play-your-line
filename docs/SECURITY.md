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
