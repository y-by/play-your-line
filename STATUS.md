# Play Your Line — Status

Last updated: 2026-09-27

This file is for picking the project back up in a future session. It covers
what the app is, what's been built, how the backend is wired, and exactly
where things stand right now (**right before pushing to GitHub and
connecting Netlify**).

## Latest state (read this first)

**2026-09-27 — Logic-style control bar + loop (built, verified in a browser mock, NOT yet tried by the owner):**
new grey bar with the number display centred; settings / People / Add channel moved into the
bar; role badge moved to the song header; 1234 count-in in the brand blue; **per-channel R
buttons removed** — recording is the red button in the bar (or `R`) onto the "armed" channel
(click a channel's name to arm when you own several); **loop** (drag on the strip under the bar
numbers; scheduled per pass on the audio clock; verified the playhead wraps at the loop end in a
real browser). Phone layout: two rows, second row slides sideways. Still to consider:
resizable channel height (agreed idea, not started).

**2026-09-27 (later) — control bar colours + arm button + fader range (built, verified in a
browser mock, not yet by the owner):** bar restyled onto our own theme tokens (no more Logic
grey); loop / metronome / snap "on" state = brand blue, same as 1234; second toolbar row
right-aligned; per-channel R button replaced by an arm dot next to M/S (canEdit only); fader
range changed to 0–2 so unity (existing volume=1) sits at the middle instead of pinned to the
end. People panel clarified in the UI and README (regular players are invited per channel from
Add channel, not from People) and confirmed a displayed name like "Thinks Toomany" is a real
Google-assigned account name, not a bug.

**2026-09-27 (later still) — real dB fader + arm off by default (built, verified in a
browser mock, not yet by the owner):** fader is now a genuine dB scale (`src/lib/dbFader.ts`,
tested), -60..+6, unity (0 dB, the default) resting near the top like a real console instead
of a linear 0-2x mid-point; Record in the bar is disabled until a channel is explicitly armed
(no more auto-picking the first channel); People panel got a one-line intro pointing at Mixer
and Listener invites.

**2026-09-27 (latest) — arm button is a real toggle:** clicking an already-armed channel's dot
now un-arms it (Record goes back to off) instead of staying stuck armed; verified in a browser
mock (arm → click same → null; arm another → switches). Not yet tried by the owner.

**2026-09-27 (latest) — signal lights per channel:** each of your own channel strips shows a
5-segment level meter (green/green/green/amber/red) under the fader, driven by the same
microphone level as the Settings input meter (`src/components/arrangement/ChannelMeter.tsx`).
Arming a channel now starts input monitoring immediately (was previously only started by
opening Settings); unarming stops it unless a recording is under way; `leaveProject` also stops
it. Verified in a browser mock (armed channel lights respond to a simulated level, the other
channel stays dark). **Not yet tried with a real microphone.**

**Bug found and fixed (owner reported "the light is not working"):** `startMonitoring` never
resumed the audio clock, which starts suspended on page load. Before Play or Record was pressed
once, the mic stream was live but the analyser read permanent silence — so arming a channel
before ever playing/recording showed dead lights (and the Settings input meter likely had the
same latent issue, just masked once you'd played/recorded earlier in the session). Fixed by
calling `engine.resume()` at the top of `startMonitoring` (`src/lib/audioEngine.ts`). Also added
a visible error toast if reading the mic fails outright. **Owner retested after that fix — mic indicator went active (Chrome), no error, still no lights.**
Root cause was very likely threshold sensitivity, not a broken pipe: my thresholds (first light
at 12%) were tuned against a loud simulated test value, not a real quiet laptop-mic level.
Lowered thresholds (first light now at 4%) and added a small numeric `%` readout next to the
lights (visible only while armed) so if it's *still* dark we can see the raw number and know
whether the pipeline itself is at fault instead of guessing again. **Owner needs to retest with
a real mic — I have no microphone hardware to verify this myself.**


Built and confirmed working by the owner unless marked otherwise:

- Clips/lanes on a 4/4 grid, snapping, overlap rule, undo/redo, shortcuts.
- Full-bleed Logic-style channel strips and one control bar; mobile layout
  (sticky bar, slim strips) tuned for a 375 px phone.
- Channel removal (empty channels only), drag-to-reorder (Owner sets the default
  for all, everyone else personal and local), channel colours (Owner saved,
  others personal), pinch-to-zoom on the timeline (**trackpad pinch not yet tried
  on a real Mac by the owner**).
- Live updates + **who's here** dots. **Not yet tested with two real people.**
- Storage cleanup of unused recording files (runs when a player opens a song;
  needs `0013`). **Not yet observed deleting anything for real.**
- **Roles** (Owner / Mixer / Player / Listener) with invite links `/join/<token>`;
  needs `0014` (run and songs load). **Mixer and Listener flows not yet tested
  end to end.**
- Owner **Unpublish** button (published song → draft, off the Songs list). Built,
  builds clean; **not yet clicked for real**.
- Errors show as a bottom toast; the home page shows load errors instead of
  spinning forever.

**Database:** migrations `0001`–`0003`, `0005`, `0009`–`0014` are the live set
(see README for the table). `0004`/`0006` debug leftovers, `0007`/`0008` cancel out.

**Dev servers:** the owner runs `npm run dev` (HTTPS, port 5180 — must stay 5180
for the sign-in redirect). For browser-pane checks use the `dev-preview` launch
entry (HTTP, port 5190; sign-in does not work there).

**Cost note:** recordings are 32-bit float WAV, ~11.5 MB per minute per channel.
Free Supabase limits (verify current numbers): ~1 GB storage, ~5 GB downloads/month,
50 MB per file. Before inviting many people, consider FLAC / 24-bit / compressed
playback copies.

**Next session — admin dashboard (owner only, planned, not started):** a private page
that only the owner's account can open. Shows every song (owner, roles, status,
date, storage used per song), and lets the owner hide/unpublish, feature or delete a
song and clear leftover recordings. Needs: an `is_admin` flag on `profiles` (set by
hand in Supabase for the owner only), database checks (RLS / functions) that honour
it, and a `/admin` route hidden from everyone else. Ties into the free-vs-paid
storage question. Until then the Songs list is controlled from Supabase: Table Editor
→ `projects` → `status`; or the Owner's new **Unpublish** button in the song header.

**Still to do:** first commit + GitHub + Netlify (nothing committed yet); test
two-person flows (invite, live updates, mixer, listener); cheaper audio storage;
small design adjustments list; later EQ/reverb/delay on the final mix, a live
"Dana is recording…" badge.

## Session 2026-09-26 (evening) — live updates + control bar

- Full-bleed channel area with Logic-style strips; one control bar (transport,
  LCD, tempo, count-in, click volume, edit tools).
- **Live updates** via Supabase Realtime: `src/lib/realtime.ts`,
  handlers in the store, pure merge helpers `src/lib/remoteMerge.ts` (tested).
  Needs migration `0010_realtime.sql`. **Untested with two real users yet.**
- To test: open the same song on two devices/accounts; add a channel, invite,
  record, move a clip — the other side should update without refresh.

## Session 2026-09-26 (later) — clip/lane architecture

Channels became **lanes on a 4/4 bar grid** holding **clips** (windows onto raw
takes). Rules and visuals are in README → *How a song works*.

- Done: clips table + permissions migration `0009` (**must be run in Supabase
  before the app works**), clip model + tests (`npm test`, 41 clip checks),
  arrangement UI (ruler, lanes, sticky info column, drag/trim/split/duplicate/
  delete, undo/redo, snap toggle + resolution, zoom, shortcuts), monitor vs
  final mix, tempo lock, initiator "I'll play it".
- Verified by me: typecheck, lint, build, unit tests, and a browser mock of the
  arrangement (render, snapped drag, Alt free drag, edge trim).
- **Not yet verified:** the real flow against Supabase (record → clip saved →
  reload), the second-person invite flow, real-hardware sync feel. Owner tests next.

## Session 2026-09-26 — click/channel sync + repo prep

**Why:** the click wasn't tightly locked to the channels. Three causes found
and fixed (see README → *Audio timing principles*):

1. The click took a longer route (hidden `<audio>` sink) than the channels.
   Now it goes straight to the same output; the separate sink is used only when
   a different click output device is chosen.
2. Takes weren't corrected for round-trip latency. Added automatic estimate,
   manual value, and a **Calibrate** button (plays clicks, listens, measures)
   in Settings → Timing. Math lives in `src/lib/latency.ts` and is checked by
   `npm run test:timing`.
3. Takes always landed at 0:00. They're now placed at the song position where
   recording started, minus latency (`tracks.offset_sec`).

Also: every channel + click now starts from one shared, slightly-future audio
clock time; trimming no longer slides the audio earlier (kept audio stays where
it was played, in playback, export and "bake trim"); dev server port pinned to
5180 (`dev:http` script for plain HTTP); removed unused `idb`/`clsx`; README
rewritten; `.gitignore` hardened (`.env*` ignored, `.env.example` tracked);
`netlify.toml` gets `NODE_VERSION=22`.

**Verified:** timing math against synthetic recordings (recovers a 37 ms delay
to <0.5 ms, refuses when no click is heard); in a real browser, the click and a
channel are scheduled on the identical audio-clock instant from any start
position. **Not verifiable without hardware:** the real-world Calibrate result
and a felt A/B of sync on a real interface — test this first.

**Added afterwards the same day:** a 4-click count-in before recording
(Settings → Metronome → Count-in, on by default). Takes now start exactly at the
song position where recording began (count-in / lead-in audio is dropped).
Queued clicks are now cancelled when you stop, turn the click off or change
tempo (they used to keep sounding for up to 0.2 s). **Written but not yet
tested — owner is testing by hand first, then run `npm run test:timing` and a
browser check.**

**Not done yet (ideas):** waveform lane doesn't draw a take at its timeline
position; take switching UI.

## What this is

A collaborative music app: an **initiator** starts a song, adds channels
(instruments), invites specific players to specific channels via one-time
links, each player records/trims only their own channel, and the initiator
publishes the finished song to a shared "Songs" list once everyone's parts
are in.

## Stack

- **Frontend**: React 19 + TypeScript + Vite, plain CSS (Apple HIG-inspired
  design system, light/dark aware). Client state via Zustand
  (`useAuthStore`, `useProjectStore`).
- **Routing**: `react-router-dom` — `/` (home/dashboard), `/song/:id`
  (editor), `/songs` (published list), `/invite/:token` (invite landing).
- **Backend**: Supabase — Postgres (schema + row-level security),
  Auth (Google OAuth only), Storage (private `takes` bucket for audio
  files).
- **Audio engine**: custom Web Audio implementation (`src/lib/audioEngine.ts`)
  — no framework. Records via a custom `AudioWorklet` to lossless 32-bit
  float WAV (no lossy codec at any point), supports per-channel/device
  input selection, output device routing (Chrome/Edge only, where the
  browser API exists), a metronome with independent output routing, and
  non-destructive (then optionally destructive) trim.

## What got built today, roughly in order

1. **Initial local-only MVP** — Pro-Tools-style track UI, per-track
   record/mute/solo/volume, WAV mixdown export, all persisted to
   IndexedDB in one browser (no accounts, no sharing).
2. **Apple HIG redesign** — system color tokens, light/dark, SF-style
   icons, HIG spacing/corner radii.
3. **Recording reliability fix** — a race condition where clicking Stop
   during the mic-permission prompt could leave an orphaned, unstoppable
   `MediaRecorder` running. Fixed with an explicit
   `idle → requesting-mic → recording` state machine.
4. **Input device/channel picker** — pick a specific mic or audio
   interface, and isolate a single channel on a multi-channel interface,
   using a `ChannelSplitterNode`/`ChannelMergerNode` graph.
5. **Initiator/tempo model** — `initiatorId` on the project; only the
   initiator can change BPM. (This was still client-only enforcement at
   this stage — became real server-side enforcement once Supabase landed.)
6. **Metronome** — click track scheduled against the same timeline clock
   as playback (lookahead scheduler), with its own volume and (later)
   independent output-device routing.
7. **Audio quality pass** (the "sound engineer" pass) — this is the one
   worth remembering in detail:
   - Disabled `echoCancellation`/`noiseSuppression`/`autoGainControl` on
     every mic capture — these are speech-call defaults that actively
     damage instrument/vocal recordings.
   - Replaced lossy `MediaRecorder` (Opus/webm) capture with a custom
     `AudioWorklet` (`src/worklets/pcm-recorder-processor.js`) that
     captures raw Float32 PCM and encodes to **32-bit float WAV**
     (`src/lib/wav.ts`) — no codec in the recording path at all.
   - Same 32-bit float WAV used for the final mixdown export.
   - Fixed a real bug in mixdown where tracks with no take yet caused
     every later track's volume/offset to be misapplied (array
     misalignment).
   - Non-destructive trim: `trimStartSec`/`trimEndSec` metadata on a take,
     applied via `AudioBufferSourceNode.start(when, offset, duration)` —
     original recording untouched.
8. **Settings panel** — Input, Output, and Metronome device/volume all
   consolidated into one modal (gear icon), replacing scattered inline
   controls. Output device routing uses `AudioContext.setSinkId` for the
   main mix and a separate hidden-`<audio>`-element sink for the
   metronome, so the click can be routed independently of the main mix.
9. **Responsive/header redesign** — fixed real overflow bugs on mobile
   (title wrapping to 3 lines, Export button pushed off-screen). Adopted a
   Logic-Pro-style layout: slim title bar + one unified transport/tempo
   strip, instead of everything crammed into one header row.
10. **The Supabase migration (the big one)** — moved from local-only to a
    real multi-user backend:
    - **Schema**: `profiles`, `projects`, `tracks`, `takes`,
      `track_invites` (see `supabase/migrations/0001_init.sql`).
    - **Row-level security** as the real permission layer (not just UI):
      only the initiator can publish/edit project settings/add channels;
      only the assigned player (or initiator) can record/trim a track;
      drafts are invisible to non-participants.
    - **Invite flow**: `track_invites` row with a bearer token; two
      `SECURITY DEFINER` RPC functions (`get_invite_details`,
      `accept_track_invite`, in `0003_invite_functions.sql`) handle the
      "I'm not a participant yet but I have the link" case safely.
    - **Auth**: Google sign-in via Supabase Auth (`useAuthStore.ts`),
      auto-upserts a `profiles` row on first sign-in.
    - **Storage**: audio takes uploaded to a private `takes` bucket,
      downloaded on demand and cached in memory as `Blob`s.
    - **Router + pages**: `HomePage` (my songs + create), `SongPage` (the
      editor, gated by `SignInGate`), `SongsListPage` (published songs,
      signed-in users only), `InvitePage` (claim a channel).
11. **The RLS recursion saga** — a long, real debugging session:
    - Symptom: creating a song failed with
      `new row violates row-level security policy for table "projects"`
      even though the user, their JWT, and the insert payload all matched
      perfectly (verified via decoded JWT, a `debug_whoami()` RPC, and a
      captured cURL of the actual failing request).
    - Root cause: a helper function (`is_project_participant`) was called
      *from inside* the `projects` SELECT policy, but its own body also
      queried `projects` — a self-referential RLS loop. This only broke
      `INSERT ... RETURNING` (i.e. every `.insert().select()` call in the
      app), not plain multi-statement inserts, which is why it was so
      confusing to pin down.
    - An intermediate attempt to fix it by inlining the checks directly
      created a **worse**, fully circular `projects ↔ tracks` dependency
      that Postgres correctly refused outright
      (`infinite recursion detected in policy`).
    - Final fix (now live): `is_project_participant` is `SECURITY
      DEFINER` (bypasses RLS internally instead of re-entering the
      policy) **and** the app no longer chains `.insert().select()` —
      every create path (`createProject`, `addTrack`, `uploadTake`,
      `createTrackInvite`) now generates its own id client-side, inserts
      without `RETURNING`, and reads the row back as a separate request.
      This combination is what's currently deployed in the database and
      the code.
    - Migrations `0004`–`0006` are diagnostic-only artifacts from this
      investigation (`debug_whoami`, `debug_test_insert`) — harmless to
      leave in place, safe to drop later if you want a cleaner migration
      history.
12. **Post-fix feature requests, all implemented**:
    - Trim now visibly dims the cut-away portions of the waveform, not
      just a faint highlight on the kept part.
    - Destructive "bake trim" option (scissors-X icon) — re-encodes and
      re-uploads just the kept audio, permanently discarding the rest
      (with a confirm dialog).
    - `/songs` is now listen-first: each entry has an inline play button
      that downloads + mixes the song and plays it right there, instead
      of forcing a click-through to the full editor. A small "Open" link
      still gets you to the editor if needed.
    - Song title is now editable (click it in the header, initiator only).
    - "Add Channel" and "Invite a player" consolidated into one
      header-triggered panel (`AddChannelPanel.tsx`) — both are
      project-level actions now, not scattered per-track buttons.
13. **Project relocated** mid-session from
    `~/Desktop/Code/play-your-line` to its correct home:
    `~/Desktop/Code/2026 Projects/PlayYourLine` (this is now the working
    directory for the session and should be used going forward).

## Current setup state

- **Supabase project**: created, Google OAuth provider configured and
  verified working end-to-end (real sign-in tested successfully).
- **Database**: migrations `0001`–`0003`, `0005` and `0009`–`0014` have been
  run against the live project (see "Latest state" above).
- **Storage**: `takes` bucket created (private).
- **Auth URL config**: Site URL and Redirect URLs set to
  `https://localhost:5180` (needed because the dev server runs HTTPS via
  `@vitejs/plugin-basic-ssl`, for mic access when testing on a phone over
  LAN). **This will need a matching entry added for the eventual Netlify
  URL** once deployed — Supabase's redirect allow-list needs the
  production URL added, or Google sign-in will fail after deploy exactly
  the way it failed on localhost before that was fixed.
- **`.env.local`**: contains real `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_ANON_KEY` (the new "publishable key" format,
  `sb_publishable_...`). Gitignored via the `*.local` pattern — will not
  be committed. **Netlify will need these same two values added as its
  own environment variables** after the repo is connected.
- **End-to-end verified working**: sign-in, create song, add channel,
  record (initiator recording on their own unclaimed channel), trim
  (visual + destructive), invite generation, publish, and the `/songs`
  listen flow. The **invite-accept-by-a-second-person** path has not yet
  been tested by an actual second user/account — worth doing once, since
  it's the one multi-party flow nobody has run for real yet.

## Known loose ends / cleanup opportunities (not urgent)

- (`idb` and `clsx` were removed on 2026-09-26.)
- Migrations `0004_debug_whoami.sql` and `0006_debug_insert_isolate.sql`
  are debugging leftovers (harmless, but not needed going forward).
- No git repository has been initialized yet in this project folder.

## Next step: GitHub → Netlify

This is the very next thing to do, nothing else is blocking it:

1. `git init`, commit, create a GitHub repo, push.
2. Connect the repo in Netlify (build command `npm run build`, publish
   dir `dist` — already configured in `netlify.toml`).
3. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as environment
   variables in Netlify's site settings.
4. Add the deployed Netlify URL to Supabase's **Authentication → URL
   Configuration → Redirect URLs** (and update Site URL), or Google
   sign-in will fail on the live site the same way it initially failed
   locally.
5. Add the Netlify URL as an **Authorized JavaScript origin** in the
   Google Cloud OAuth client (Google Cloud Console → APIs & Services →
   Credentials → the Web client created earlier).
