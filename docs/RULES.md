# Who may do what

Written by `npm run docs:rules` from `src/lib/rules.ts`, which is the one source of truth for these rules. Do not edit
this file by hand: change the rule in `src/lib/rules.ts`, run the command, and write the database change the rule points to.
A test fails if this file is out of date.

| | Owner | Mixer | Player | Listener |
| --- | :---: | :---: | :---: | :---: |
| Who | Created the project | One person the Owner picks | Whoever is on a channel (or was added as a player) | Invited to hear the draft |
| Listen to the draft | ✅ | ✅ | ✅ | ✅ |
| Add a channel | ✅ | ✅ | ✅ | – |
| Rename a channel | ✅ | ✅ | their own channel (and any channel nobody plays yet) | – |
| Put someone on a channel (link, email or pick from the list), reassign it | ✅ | – | – | – |
| Channel order and colours, rename or delete a channel | ✅ | – | – | – |
| Tempo, time signature, rename or delete the project, cover image, publish | ✅ | – | – | – |
| Final mix (volume, mute and pan per channel) | ✅ | ✅ | – | – |
| Master channel (fader, EQ, compressor, limiter) | ✅ | ✅ | – | – |
| Group channels: create, rename, delete, put channels in them | ✅ | – | – | – |
| Group channels: volume, mute, pan, Tools (effects) | ✅ | ✅ | – | – |
| Channel Tools (EQ, Compressor, Delay, Reverb, Tuner) | ✅ | ✅ | their own channel, until the Owner or Mixer locks it | – |
| Lock or unlock a player's channel effects | ✅ | ✅ | – | – |
| Record and edit clips | their own channel | their own channel | their own channel | – |
| Invite a Mixer or Listeners, add someone by email, choose the Mixer | ✅ | – | – | – |
| Write notes, tag people with @ | ✅ | ✅ | ✅ | – |
| Edit a note, mark it done or reopen it | ✅ | their own notes | their own notes | – |

## What enforces each rule in the database

The screen hides what you cannot do, but the database is what really stops it.

| Rule | Enforced by | Note |
| --- | --- | --- |
| Listen to the draft | policies: participants read the song (0001, 0014) |  |
| Add a channel | policy: contributors add a channel (0040, 0042) | A person added by the Owner as a player counts as a Player even before they have a channel. |
| Rename a channel | trigger guard_track_columns (0040) |  |
| Put someone on a channel (link, email or pick from the list), reassign it | functions assign_track_to_user, reassign_track, claim_own_track, accept_track_invite (0009, 0019, 0026) | A channel with recordings can never be reassigned. |
| Channel order and colours, rename or delete a channel | trigger guard_track_columns; only an empty channel can be deleted (0011, 0040) | Everyone else can arrange the channels for themselves; that stays on their own device. |
| Tempo, time signature, rename or delete the project, cover image, publish | policies: only the initiator updates or deletes the project (0001); tempo lock (0009, 0039) |  |
| Final mix (volume, mute and pan per channel) | trigger guard_track_columns (0030, 0040) | Players and Listeners can still make their own monitor mix; it is saved only on their device. |
| Master channel (fader, EQ, compressor, limiter) | function set_master_mix (0043) | Only the Owner and the Mixer see the master. Everyone hears it. The master mute is personal and never saved. |
| Group channels: create, rename, delete, put channels in them | functions create_track_group, rename_track_group, delete_track_group, set_track_group; trigger guard_track_columns (0044) |  |
| Group channels: volume, mute, pan, Tools (effects) | function set_group_mix (0044) | Everyone hears the saved group settings, and anyone can fold a group or solo it for themselves. |
| Channel Tools (EQ, Compressor, Delay, Reverb, Tuner) | trigger guard_track_columns (0018, 0034, 0040) |  |
| Lock or unlock a player's channel effects | trigger guard_track_columns (0034) |  |
| Record and edit clips | policies on clips, takes and storage: only the channel's own player (0009) | Nobody touches a player's recordings but that player. The Owner cannot record on or edit someone else's channel. |
| Invite a Mixer or Listeners, add someone by email, choose the Mixer | functions set_mixer, add_project_member; policies on project_invites (0014, 0031) |  |
| Write notes, tag people with @ | function can_write_notes and note policies (0032) | A Player needs a channel to write notes. Listeners only read the notes shared with them. |
| Edit a note, mark it done or reopen it | trigger guard_project_notes (0033, 0041) |  |

See also `docs/SECURITY.md` for who can call each database function.
