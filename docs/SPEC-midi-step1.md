# Spec: MIDI step 1 — MIDI channels, note recording, a basic built-in synth

Written 2026-10-16. Spec only: nothing in the app has changed yet. Agreed with the owner in chat on 2026-10-16.
Read `docs/RESEARCH-local-daw-routing.md` first. It explains why a browser can't host VST/AU and why Safari has no Web MIDI.

## The decision (the big picture, all steps)

- **MIDI is control data, not sound.** A MIDI channel stores **notes**. Sound comes from an **instrument built
  into PYL** (Web Audio, no library), so every collaborator hears the same thing and the instrument can be
  swapped after recording.
- **No VST/AU inside PYL.** If a player wants their own plugins, they use the DAW route (record in the DAW, or
  route the DAW's audio into PYL; see the research doc).
- **Safari (Mac and every iOS browser) has no Web MIDI**, and nothing suggests Apple will add it (WebKit
  opposes it over fingerprinting). Safari users get the computer-keyboard / on-screen keyboard fallback, plus
  the audio route. The Safari-WebMIDI extension (triglavmodular.hu) works with our code unchanged, but its
  50-250 ms input polling makes it too sloppy for recording. Don't build for it.
- **Order of steps:**
  1. **This spec:** MIDI channel type and note data, MIDI input plus keyboard fallback, recording, playback, a
     basic synth so it is audible, notes drawn in the lane, included in Export Mix and the listening copy.
  2. **Sampler instrument:** one good keys patch from samples, then drums and bass. Check sample licences:
     many free packs don't allow redistribution inside an app.
  3. **Piano-roll editor** for editing notes, plus note quantise (reuse `quantise.ts` ideas).
  4. **Later:** MIDI out to the DAW or hardware, MIDI Clock/MTC (research doc case 3), a companion app.

A nice side effect: MIDI is tiny. A minute of playing is a few KB, compared with about 8 MB for a mono 24-bit
take, so it barely touches the Supabase egress or storage quota.

---

## 1. Data model

### Channel kind
- New column `tracks.kind text not null default 'audio' check (kind in ('audio','midi'))`.
- New column `tracks.midi_instrument text` (null for audio channels). Step 1 has one value: `'basic-synth'`.
  Later: `'keys'`, `'drums'`, `'bass'`… Keep the instrument settings for later (`midi_instrument_params jsonb`,
  not in step 1).
- `kind` is chosen when the channel is added (AddChannelPanel: "Audio" / "MIDI"). It can't change once the
  channel has clips (enforce it in `guard_track_columns`).
- `Track` in `src/types/project.ts` gets `kind: "audio" | "midi"` and `midiInstrument: string | null`.

### MIDI clips
New table `midi_clips` (migration **0050_midi_channels.sql (next free number when MIDI starts)**). It is separate from `clips`, because a MIDI clip
has no take:

| column | type | note |
| --- | --- | --- |
| id | uuid pk | |
| track_id | uuid → tracks, on delete cascade | must be a `midi` channel |
| start_sec | double precision ≥ 0 | on the song timeline, same as audio clips |
| source_start_sec | double precision ≥ 0 | the window into the notes, so trimming works exactly like audio |
| duration_sec | double precision > 0 | |
| z | integer | stacking, same rule as audio (newest on top) |
| notes | jsonb | `[{ p, v, t, d }]`: pitch 0-127, velocity 1-127, start in seconds **from the start of the recording** (not the clip), length in seconds. Sorted by `t`. Cap at about 20 000 notes per clip. |
| created_by | uuid | |
| created_at | timestamptz | |

- **Time in seconds, not beats**, to match audio clips and the existing tempo lock (0009). If the tempo ever
  becomes changeable with recordings in place, convert then.
- **Notes never change after recording** in step 1, like a take. Move / trim / split / duplicate / delete only
  change the window numbers, so all of `clips.ts` (overlap, segments, split, trim, fades = ignored for MIDI)
  works on a MIDI clip. Write a small adapter rather than a copy of the logic.
- **RLS:** a copy of the `clips` policies. Everyone on the project reads (and anyone on a published project);
  only the channel's own player inserts, updates or deletes. Add the table to the realtime publication (as in 0010)
  so live updates work.
- `rules.ts`: add "Choose a channel's MIDI instrument" (Owner, Mixer, the channel's player, same as Tools, and
  respects the FX lock), then `npm run docs:rules`.

## 2. MIDI input (`src/lib/midiInput.ts`, new, no library)

- Feature detect `navigator.requestMIDIAccess`. Call it (`{ sysex: false }`) **only** when the user arms a MIDI
  channel or opens the MIDI section in Settings, never on page load. The browser asks permission at that moment.
- Settings → new "MIDI" section: input device picker ("All inputs" by default). Saved per device in localStorage
  (`pyl.midiInput`). Hot-plug through `access.onstatechange`. Show a short note in Safari: "This browser can't use
  MIDI devices. Use Chrome, Edge or Firefox, or play with your computer keyboard."
- Parse only: note on (0x9n), note off (0x8n, **and note on with velocity 0**), sustain pedal (CC 64). Accept
  every MIDI channel (omni). Ignore everything else in step 1 (pitch bend, mod wheel, aftertouch: later).
- **Sustain while recording:** while CC64 ≥ 64, hold back note-offs; on pedal release, end the held notes at the
  release time. Store the result as plain note lengths (no pedal events in the data).
- **Timestamps:** use `MIDIMessageEvent.timeStamp` (performance.now() clock), not the time the handler ran.
  Convert it to the audio clock with `audioContext.getOutputTimestamp()` (pairs `contextTime` with
  `performanceTime`). Put the conversion in a pure function so it can be tested.

## 3. Fallback input (every browser, the only one on Safari)

- **Computer keyboard as a piano**, only while the armed MIDI channel's "Keys" toggle is on: `A W S E D F T G Y H
  U J K` = C to C (white and black keys), `Z` / `X` = octave down / up, `C` / `V` = velocity down / up. **While it is
  on it takes these keys away from the editing shortcuts** (`R`, `S`, `J` and others in `Arrangement.tsx` ~340-378).
  Show that clearly ("Keys on: shortcuts paused", Esc turns it off). Space still plays/stops.
- **On-screen mini keyboard** (two octaves, mouse and touch, pointer events, velocity from vertical position on
  the key) for phones and tablets.
- Both feed the same note on/off path as real MIDI, with `performance.now()` timestamps.

## 4. Sound: the basic synth (`src/lib/instruments/basicSynth.ts`, new)

- Plain Web Audio, polyphonic, 16 voices max (steal the oldest). Per voice: two oscillators (triangle + slightly
  detuned saw), a low-pass filter, an ADSR envelope on gain, velocity → level and a little filter opening.
- One instance per MIDI channel. Its output plugs in **where a channel's audio clips plug in**, so the channel's
  FX, fader, pan, mute/solo, group and master all apply unchanged. Signal flow: the synth is the "source" at the
  top of the channel strip.
- **Monitoring:** notes you play sound immediately through the armed channel (and only for you), whether or not
  recording is running.
- This is a placeholder good enough to hear the part. The sampler in step 2 is the real "sounds good" instrument.

## 5. Recording

- Same transport as audio: arm the MIDI channel, `R`, count-in, record, stop. Takes land where they were played.
- While recording, collect notes with audio-clock times. On stop, make **one MIDI clip** from the record-start
  position to the stop position, notes relative to that start. Notes still held at stop end at stop.
- **Timing correction for MIDI is different from audio.** There is no microphone path, but the player hears the
  backing track late by the output delay (`baseLatency + outputLatency`). So they press keys that much late.
  Shift recorded notes **earlier by the output delay only**, not the Calibrate round-trip value. Add it as a pure
  function in `latency.ts`, with tests.
- Undo / redo of the new clip like an audio take. Nothing is uploaded to Storage: the clip row holds the notes.
- Live drawing while recording: notes appear in the lane as they are played (simple version of the live waveform).

## 6. Playback and export

- In `audioEngine.ts`, schedule MIDI notes **on the audio clock with the same short look-ahead scheduler as the
  click** (queue note-on/off with exact `start(time)` / envelope times, never play them from a JS timer). For
  each MIDI clip use the same visible segments as audio (`clips.ts`), and play only notes whose start falls inside
  a segment. Cut notes at the segment end.
- Seek / loop / stop: release all voices at once (short fade, no clicks), then reschedule from the new position.
- **Export Mix and the Published listening copy must include MIDI channels.** `renderMix` (mixdown.ts) runs the same
  synth in the OfflineAudioContext. If this is skipped, published songs silently lose MIDI parts. Mark the
  listening copy stale when a MIDI clip changes (as for audio).

## 7. In the lane

- A MIDI clip looks like an audio clip (same frame, colour, selection) but shows small note bars instead of a
  waveform: time across, pitch up and down, scaled to the clip's lowest and highest note. Velocity → opacity.
- Move, trim, split, duplicate, delete, nudge: same tools and shortcuts. **Join** for MIDI clips: not in step 1
  (hide it or refuse it with a message).
- Drop an audio file on a MIDI channel: refuse it with a message. (`.mid` file import: later.)

## 8. Tests (`scripts/test-clips.ts` / `test-timing.ts`)

Pure functions with plain numbers:
- MIDI message parsing (note on / off / velocity-0 off / CC64 / ignored types).
- Sustain folding (held notes end at pedal up; a re-struck held note ends the earlier one).
- performance.now() → audio clock conversion.
- Output-delay shift of recorded notes.
- Which notes play for a clip window and its segments (trim, split, overlap by a newer clip).
- Computer-keyboard map (key → pitch, octave shift limits 0-127).

## 9. Done when (owner checks)

1. Add a MIDI channel and arm it. In Chrome a real MIDI keyboard plays the synth immediately with no audible lag.
2. Record 8 bars with the click: the notes land on the beat (check against the grid at high zoom).
3. Sustain pedal works. Unplug and replug the keyboard: it is picked up again.
4. In Safari: the "can't use MIDI devices" note shows, computer keys and the on-screen keyboard play and record.
5. Move, trim, split and duplicate a MIDI clip. Undo all of it.
6. A second person on another device sees and hears the new MIDI clip live.
7. Export Mix and the listening copy both contain the MIDI part.
8. `npm test`, typecheck, lint, build all pass. The MIDI migration runs cleanly twice (safe to run more than once).

## Out of scope for step 1

Sampler and other instruments, instrument settings, piano-roll editing, note quantise, `.mid` import/export, MIDI
out / clock, pitch bend / mod wheel, joining MIDI clips, recording MIDI and audio in the same pass on one channel.

## Open questions for the owner (answer before building)

1. Who may change a channel's MIDI instrument: same as Tools (Owner, Mixer, the player until locked), as written above?
2. Should a Listener hear MIDI parts in the draft? (Assumed yes, same as audio.)
