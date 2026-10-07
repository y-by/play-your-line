# Play Your Line

Make music together without being in the same place. One person starts a **project** and adds
**channels** (Guitar, Bass, Vocals). Each channel belongs to one musician. Everyone records
**only their own channel**, on their own time, against the mix so far. When all the parts are
in, the Owner **publishes** the project, and any signed-in user can listen.

It looks and works like a studio app: stacked channels with waveforms, a shared playhead,
tempo and click, mute / solo / volume, and trimming that never destroys a recording.

> Why not live jamming? Network delay across distance (100-300 ms) is far more than musicians
> tolerate (about 20-30 ms), so the app is built around recording in turns, with the click and
> every part locked tightly together.

## How it works

**Projects.** The home page shows your projects as cover tiles: Drafts (large) and Published. Hover a tile (always visible on a touch screen) for **Publish / Unpublish** (the Owner), **Update listening copy** (a published project, the Owner) and **Export mix**. Publishing also makes a **listening copy** (one MP3 of the final mix, about 1 MB a minute) that Play on the Published list streams instead of downloading every channel; use the refresh button after you change the mix. Recordings you have downloaded stay on your device (browser cache, up to about 600 MB), so a project opens without downloading them again. Inside a project there is no separate header: the back button and the name (the Owner clicks it to rename) sit at the left of the control bar, and Draft / Live, who is here, and your role at the right.
The Owner can add a cover image in **Settings**; without one, the tile gets generated artwork.

**Roles.** One person owns a project; each channel belongs to one player.

| | Owner | Mixer | Player | Listener |
| --- | :---: | :---: | :---: | :---: |
| Who | Created the project | One person the Owner picks | Whoever is on a channel | Invited to hear the draft |
| Add a channel, rename a channel | ✅ | ✅ | ✅ | ✅ |
| Put someone on a channel (link, email or pick from the list), reassign it | ✅ | – | – | – |
| Tempo, channel order and colours, rename or delete the project, publish | ✅ | – | – | – |
| Final mix (volume, mute and pan per channel) | ✅ | ✅ | – | – |
| Channel FX (EQ, Compressor, Delay, Reverb) | ✅ | ✅ | their own channel, until the Owner or Mixer locks it | – |
| Write notes, tag people with @ | ✅ | ✅ | ✅ | – (they read the notes shared with them) |
| Record and edit clips | own channel | own channel | own channel | – |
| Listen to the draft | ✅ | ✅ | ✅ | ✅ |

The rules are enforced by the database, not just hidden in the screens. **Nobody touches a
player's recordings but that player.** A channel with recordings can't be reassigned.

**Joining.** The Owner can send a one-time link per channel, assign by email or from the people
already in the project, and invite a Mixer or Listener from the People button. A person's name
starts as their Google name; they can change it to a stage name in **Settings**.

**Recording.** Arm your channel (the dot), press the red button or `R`. A 4-click count-in plays
first, and the take lands exactly where you started. You can also drag an audio file onto your
own channel.

**Clips.** A recording is never modified. What you see on a channel are clips, windows onto the
recording: trim, split, move or duplicate them freely, and the original audio is always still
there. Each clip can **fade in and out**: hover or select a clip and drag the small round handle at
its top-left or top-right (double-click it to remove the fade). A shaded corner and a line show the
ramp; the fades are heard in playback and in Export Mix, and can be undone.

**Notes.** Switch notes on with the notes button (they are off by default). Write a note, tag
a person with `@`, pin it to any bar, attach it to a channel (it then wears that channel's colour)
and see it three ways: a tray along the bottom, floating cards, and flags on the bar ruler. Marking
a note done archives it. A person you tag gets an orange `@` badge on the notes button and a message.

**Help.** The menu has a Help page with short answers, grouped by what you are doing. Small "?" buttons in the FX box, the Tuner and the Notes tray open the short answer for that tool, with a link to the full page. (The answers live in `src/lib/helpContent.ts`.)

**Chords.** The ♪ button next to FX listens to a channel and suggests the chords along the top of
its lane. It is a suggestion, not a guarantee; click a chord to jump there.

**Tuner.** The tuning-fork button at the bottom of a channel's FX box opens a strobe tuner in its own window (it never lives inside the box: it stays when the box is closed, and its × closes it) in the spirit of a Peterson: rings of
stripes drift left when the note is flat, right when it is sharp, and stand still (and turn green) when
it is in tune, with the note, the cents and a needle. It reads from your first note down to a 5-string
bass's low B. Pick Guitar, Bass (4), Bass (5) or Ukulele and tap a string to tune to it, or leave it on
"Any note". The reference pitch (A = 440) can be moved.

**Effects.** FX is **off** for a channel until its power switch is turned on. Each effect has its
own bypass, each EQ band has a frequency knob under its gain knob, and a separate Low cut (a high-pass filter, off at the bottom of its knob) sits to the left of them, there are presets, undo, reset and a Compare (hear it dry) button, and each tab can be
dragged out into its own window (and docked back with its Dock button). Close the main FX window and any tab you pulled out stays on screen, on top. Drag the bottom-right corner of an FX window to make it bigger, up to double (double-click the corner for normal size); the main window remembers its size. Export Mix includes the effects.

**Mixes.** Players hear their own monitor mix (saved only on their device) or the Owner's saved
final mix. Solo is never saved.

**Live updates.** When someone else changes the project, you see it appear without refreshing.

**Shortcuts.** `Space` play / stop · `Enter` back to start · `R` record · `S` split ·
`⌘/Ctrl+D` duplicate · `Delete` remove clip · `⌘/Ctrl+Z` undo (`⇧` redo) · arrows nudge · `Esc` deselect.

## Run it locally

You need Node 22+ and a Supabase project (Google sign-in on, the files in `supabase/migrations/` run in number order, a private `takes` storage bucket; migrations 0029 and 0038 add the private `covers` and `previews` buckets).

```bash
git clone https://github.com/y-by/play-your-line.git
cd play-your-line
npm install
cp .env.example .env.local     # fill in your two Supabase values
npm run dev
```

Open **https://localhost:5180**. The `https://` is required, and your browser will warn about the
self-signed certificate (choose *Advanced → Proceed*): browsers only allow the microphone on
secure addresses. The port is fixed because Supabase and Google sign-in are set up for it. To
try it on a phone, use the same Wi-Fi and open `https://<your-computer's-IP>:5180`.

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server (HTTPS, port 5180) |
| `npm run build` | Type-check and build to `dist/` |
| `npm run lint` | Lint |
| `npm test` | Run the automated checks (timing, clips, grid, mixes, roles and more) |

## Under the hood

The design notes, diagrams, audio timing rules, design system and code layout are in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).


- **App:** React 19, TypeScript, Vite. State in Zustand. Screens are in `src/pages` and
  `src/components`.
- **Audio:** a plain Web Audio engine (`src/lib/audioEngine.ts`). Every channel and the click are
  scheduled on one audio clock with one shared start time, so they stay locked together. Mic input
  has echo cancellation and noise suppression off and is captured as raw samples, never through a
  lossy codec. Each take is shifted earlier by the measured round-trip delay (**Settings →
  Calibrate**).
- **Backend:** Supabase for Google sign-in, the database with row-level security, and private file
  storage. Every database call is in `src/lib/projectApi.ts`.
- **Tests:** `scripts/` holds the checks for the parts that can be tested without a browser.

## Known limits

- 4/4 time only. Recording is mono per channel. Choosing a separate output device works only in
  Chrome / Edge. Editing is desktop-first.
- No designed error pages yet, and not installable as an app yet.

## Troubleshooting

- **`ERR_EMPTY_RESPONSE` on localhost:** you opened `http://`; use `https://localhost:5180`.
- **Sign-in goes to a page that won't load:** the app address is missing from Supabase's
  *Redirect URLs*.
- **"row-level security" or "permission denied" errors:** a migration hasn't been run; run them
  all in order.
