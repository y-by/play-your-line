# Research: Bringing a local DAW into Play Your Line

Written 2026-10-11. Research only: nothing in the app was changed. Line numbers point at the code as it is today (`cc1a3cd`).

The question: a player wants a channel to come from their own DAW (Logic, Ableton, Reaper, Cubase, FL…) instead of a microphone. Three cases:

1. **A part they already recorded or produced in the DAW** (a finished stem).
2. **A sound that only exists in the DAW**: a plugin chain (amp sim, vocal chain) or a MIDI instrument (synth, drum sampler) played live and recorded into PYL.
3. **A MIDI part already programmed in the DAW**, played back in time with the PYL song and recorded.

---

## Summary (read this first)

- **A browser can't load VST/AU plugins or talk to a DAW directly.** Everything has to go through one of four doors: a **file** (import), the **operating system's audio devices** (a virtual cable or the interface's loopback), **MIDI** (Web MIDI, Chrome/Edge/Firefox only), or a **native companion plugin** we would have to build and ship ourselves.
- **Case 1 is already half-built and has a real blocker.** Dropping a file on your channel works (`ChannelLane.tsx` 67-73, `importAudioFile` store ~2838), it keeps stereo and even catches loops at the wrong tempo. But every import is re-encoded as 32-bit float WAV and capped at **50 MB** (`MAX_IMPORT_BYTES`, store line 41). A stereo 48 kHz stem is ~23 MB a minute, so **anything past ~2 minutes of stereo is refused**. Full-song stems from a DAW are exactly what people will drop. Fix this first.
- **Case 2 works today with zero code, but badly.** Install a virtual cable (BlackHole on Mac, VB-Cable on Windows) or use an interface with a loopback input, send the DAW's output there, pick it as the input in PYL Settings. Three things go wrong: (a) **recording is always mono** (`audioEngine.ts` 932-940 downmixes), which ruins stereo synths and reverbs; (b) the **latency correction is wrong** for this route (Calibrate measures speaker → mic, the DAW adds its own buffer and plugin delay); (c) **feedback**: interface loopback usually captures *all* computer audio, including PYL's own playback, so the backing track ends up in the take.
- **Case 3 needs MIDI sync.** PYL can send **MIDI Clock + MTC** through Web MIDI to a virtual MIDI port (IAC Driver on Mac, built-in loopback ports in Windows 11's new MIDI Services, or loopMIDI) so the DAW's transport follows PYL's play/stop and position. Then the DAW plays its programmed part, case 2's audio route carries the sound, PYL records it in time. Not available in Safari (Web MIDI is still unimplemented in WebKit).
- **The "pro" answer is a companion plugin** ("PYL Bridge", a VST3/AU insert in the DAW, built with JUCE) that records the DAW track sample-accurately and uploads it as a take. That's how LISTENTO, dBaton CUE, VST Connect and Source-Connect work. It solves sync, latency and stereo at once, but it's a native product (C++, Mac + Windows builds, signing, notarization, AAX needs Avid's program), not vanilla web. A later phase, if ever.
- **Recommended order:** (1) fix import (size, stereo, align to bar 1, several stems at once) → (2) a proper "Record from computer audio" mode (stereo, own latency offset, feedback warning, setup guide) → (3) MIDI Clock/MTC out → (4) only then think about the plugin or in-browser instruments.

---

## Part 1. What the app does today (relevant pieces)

**Import** (`ChannelLane.tsx` 63-73 → `importAudioFile` store ~2838 → `placeImportedBuffer` store ~758)
- One file per drop (`e.dataTransfer.files[0]`), placed where it was dropped (`dropAt(e)`), only on a channel you may edit.
- Decoded with `decodeAudioData`, so WAV, AIFF, MP3, M4A, FLAC, OGG are fine (browser-dependent for AIFF/FLAC).
- Loop tempo check (`detectLoopBpm`) asks what to do with a loop at another tempo. Non-loops are left alone.
- Re-encoded to 32-bit float WAV, channel count kept (`wav.ts` line 5 writes `numberOfChannels`). Refused above 50 MB.
- **Gaps:** single file only; no "snap to bar 1"; no warning when the file's sample rate or length doesn't match the song; the size cap; storage on the Free plan (1 GB, ~390 MB used on 2026-10-04) fills ~2× faster with stereo float stems.

**Recording** (`startRecording`, `audioEngine.ts` ~907-960)
- `getUserMedia` with echo cancellation, noise suppression and AGC off (`inputDevices.ts` 16-30): correct for loopback too.
- Per-channel input index on multi-input devices (splitter → 1-channel merger). Then an explicit **mono downmix** (`monoGain`, channelCount 1) into a 1-channel worklet. Every take is mono.
- Latency: automatic estimate from `baseLatency + outputLatency` + the input track's reported `latency`, or the Calibrate value (`latencyCompMs`, store ~1718-1748). One global number, not per input.
- Sample-rate mismatch notice (`getCaptureRateMismatch`): already useful for virtual cables, which have their own rate setting.

**No Web MIDI anywhere** in the code today.

---

## Part 2. The four doors

### Door A: Files (export from DAW → drop in PYL)

How others do it: BandLab, Soundtrap, Splice-style tools all accept stem drops; the DAW user "bounces in place" or exports all tracks from bar 1 at the song tempo.

What PYL should add:
- **Bigger files without the cap**: store imports as **16- or 24-bit WAV** (half / three-quarters of float), or **FLAC** (lossless, ~50-60% of 16-bit). Or upload straight to storage with a resumable upload and raise the bucket's file limit (Supabase Free plan's global per-file limit is 50 MB; Pro allows much more). Float is overkill for a bounced stem.
- **"Starts at bar 1" option** on drop (or automatic when the file is close to the song length): DAW stems exported from the start line up exactly, no hand-dragging.
- **Read the BWF timestamp** (`bext` chunk, "time reference") that Pro Tools, Logic, Reaper and Cubase can write: places a stem exported from the middle of the song at the right spot.
- **Drop several stems at once** on the empty area → one new channel per file (the dropper becomes the player on each; rule already allows players to add channels, auto-assigned via 0023/0042).
- **Check tempo and sample rate**: warn when the file's rate differs from the song's, and reuse the loop prompt.

Effort: small to medium. No new permissions, no new data model.

### Door B: The computer's audio devices (live route)

**Tools the player installs (or already has):**

| | Mac | Windows |
|---|---|---|
| Free virtual cable | **BlackHole** (open source, GPL-3.0; 2/16/64/128/256-channel builds; "zero additional driver latency"; `brew install blackhole-2ch`) | **VB-Audio Virtual Cable** (free, donationware); **VoiceMeeter** (mixer + cables) |
| Paid, friendlier | **Loopback** (Rogue Amoeba): grab one app's audio, no system-wide routing | Virtual Audio Cable (paid) |
| Built into the interface | Loopback inputs on many interfaces: Focusrite Scarlett 3rd/4th gen, MOTU, RME TotalMix, Audient, SSL | same |

Setup the player does: DAW output → the cable (or a Multi-Output Device: speakers + BlackHole, so they still hear it) → PYL Settings input = BlackHole → record on their channel. They play their MIDI keyboard into the DAW instrument while hearing PYL's backing.

What breaks and what PYL needs:
1. **Stereo takes.** A synth, a stereo amp sim, reverb: all collapse to mono today. Add a per-channel **Mono / Stereo** choice (stereo = input pair 1-2, 3-4…). Worklet, waveform, clip playback and storage must accept 2 channels. Medium job; it also helps stereo keyboards and drum overheads from mics.
2. **The right delay correction.** The acoustic Calibrate doesn't describe this route. Give each input its own offset (remembered per device, on this computer), and a **"Calibrate this route"** test: PYL plays a click into the DAW (through a second cable, or the DAW's input monitoring), the DAW sends it back, PYL measures the round trip. Simpler v1: a manual ms nudge per channel + "Nudge last take" (clips can already be moved).
3. **Feedback / recording the backing.** Interface loopback and system-wide routes include PYL's own playback. Warn when the chosen input's name looks like a loopback ("BlackHole", "CABLE Output", "Loopback", "VoiceMeeter"), and explain the fix: PYL output to a device that isn't in the loop (headphones / main out), or only the DAW into the cable. A "test signal" that checks whether PYL hears itself would make it automatic.
4. **Sample rate and drift.** The same class of problem as the Mbox case: DAW, cable and PYL's output must run at one rate; with an Aggregate / Multi-Output Device on Mac, drift correction must be on for every device except the clock source (BlackHole README). The existing notice catches the mismatch; the setup guide should say this up front.
5. **Safari:** captures one channel only (stereo `getUserMedia` works in Chrome and Firefox). Stereo route = Chrome/Edge/Firefox.

Effort: guide + warnings small; stereo medium; route calibration medium.

### Door C: MIDI (Web MIDI API)

- Available in **Chrome, Edge, Firefox** (Chrome asks permission for all MIDI now). **Not in Safari**: WebKit bug 107250 is still open and unassigned (last activity July 2025).
- Virtual MIDI ports to reach the DAW: **IAC Driver** (built into macOS, Audio MIDI Setup), **Windows MIDI Services** (rolled out in Windows 11 during 2026; built-in multi-client loopback endpoints that Web MIDI pages can use, no extra driver), or **loopMIDI** on older Windows.

Two uses:
1. **PYL as the clock (recommended).** PYL sends **MIDI Clock** (24 pulses per quarter note, Start / Stop / Continue / Song Position Pointer) and **MTC** to the virtual port. The DAW follows PYL's transport: press play in PYL at bar 17 and the DAW starts at bar 17 at the song tempo. Most DAWs follow external clock or MTC (Ableton, Reaper, Cubase, Studio One, Bitwig follow MIDI Clock; Logic and Pro Tools follow **MTC**, not clock, so send both). Combined with Door B, a programmed DAW part records into PYL in time. Web MIDI `send()` takes timestamps, so we can schedule from the same clock as the audio (needs care: `performance.now()` vs `AudioContext` time, and output latency offset). Effort: medium.
2. **MIDI instruments inside PYL** (a "MIDI channel" with notes instead of audio, played by a browser synth / sampler, e.g. Web Audio Modules 2.0 plugins). Big job: new data model (notes), editor, instruments, and the "nobody touches my recording" rule needs a new meaning. Safari users can't play in. Park it; Door B already lets people use their real DAW instruments.

(Ableton Link would be nicer than MIDI clock, but it's UDP on the local network, which browsers can't do; it'd need a helper app. Not worth it.)

### Door D: A native companion plugin ("PYL Bridge")

- How it'd work: a VST3/AU/AAX insert on the DAW track. Sign in, pick project + your channel. It plays nothing itself; it records the track while the DAW plays (synced by the DAW, sample-accurate, real stereo, no latency guesswork, plugin delay compensation by the DAW) and uploads the result as a take on your channel. Could also stream PYL's mix into the DAW as a backing track.
- Precedent: **Audiomovers LISTENTO** (insert on master, link, browser receiver, up to 128 channels), **dBaton CUE** (Aug 2026: AU/VST3/AAX, streams to browsers, 60-200 ms, so for listening, not playing), **Steinberg VST Connect**, **Source-Connect**.
- Cost: C++ / JUCE, two OS builds, Apple notarization, Windows signing, AAX needs Avid's developer program, DAW-by-DAW testing, support. The opposite of PYL's lean web stack. Only if PYL grows into a product for producers.

---

## Part 3. Recommended plan

| Step | What | Size | Unlocks |
|---|---|---|---|
| 1 | Import: no 50 MB wall (16/24-bit or FLAC, or bigger limit), "start at bar 1", BWF timestamp, several stems → several channels, rate check | S-M | Case 1 fully |
| 2 | "Record from computer audio": setup guide per OS in Help, loopback-name detection + feedback warning, per-input latency offset | S-M | Case 2, mono |
| 3 | Stereo takes (per-channel Mono/Stereo) | M | Case 2 properly (synths, FX) |
| 4 | MIDI Clock + MTC out (Chrome/Edge/Firefox), port picker in Settings › Audio | M | Case 3 |
| 5 | Route calibration test | M | Tighter timing for 2-3 |
| later | Companion plugin, or browser MIDI instruments | L-XL | Everything, natively |

Database: steps 1-2 need no migration (a "stereo" flag could live on the take; channel count is already in the WAV). Storage is the real constraint: stereo DAW stems double the Free-plan usage, so pair step 1/3 with 24-bit or FLAC storage.

---

## Questions for the owner

1. Should a player be able to drop **several stems at once** and get several channels (all theirs), or one channel per drop as today?
2. OK to store new takes at **24-bit** (or FLAC) instead of 32-bit float? Same quality for a finished stem, far smaller.
3. **Stereo takes**: for everyone, or only when the input is a pair / a loopback device?
4. Is **Safari-without-MIDI** acceptable for step 4 (show "use Chrome for DAW sync")?
5. Is a native plugin ever on the table, or do we stay web-only?

## Sources

- BlackHole: https://github.com/ExistentialAudio/BlackHole
- WebKit Web MIDI bug: https://bugs.webkit.org/show_bug.cgi?id=107250
- Chrome Web MIDI permission: https://developer.chrome.com/blog/web-midi-permission-prompt
- Windows MIDI Services (Feb 2026): https://blogs.windows.com/windowsexperience/2026/02/17/making-music-with-MIDI-just-got-a-real-boost-in-windows-11/
- Stereo getUserMedia (May 2026): https://blog.addpipe.com/recording-true-stereo-audio-using-getusermedia/
- dBaton CUE: https://www.production-expert.com/production-expert-1/dbaton-cue-stream-your-daws-master-bus-to-any-browser-in-real-time-for-remote-mix-approvals
- LISTENTO: https://www.musicconnection.com/new-toys-audiomovers-listento-plugin/
- VB-Audio forum (Virtual Cable): https://forum.vb-audio.com/viewtopic.php?p=4858
- Ableton virtual MIDI bus: https://help.ableton.com/hc/en-us/articles/209774225

---

## Addendum (2026-10-11): storage format for takes (32-bit float vs 24 vs 16 vs FLAC)

"Bit depth" (not bit rate) is how precisely each sample is stored. It only changes the **file in storage**; the browser decodes every take back to 32-bit float for playback, editing, effects and export, so the engine and mixing are untouched, and old float takes and new ones can live side by side.

| Format | Bytes/sample | Dynamic range | Mono MB/min (48 kHz) | Stereo MB/min | Fits in 50 MB (mono / stereo) |
|---|---|---|---|---|---|
| 32-bit float (today) | 4 | huge, and values above 0 dBFS survive | 11.5 | 23.0 | 4.3 / 2.2 min |
| 24-bit integer | 3 | ~144 dB (better than any real converter, ~120 dB) | 8.6 | 17.3 | 5.8 / 2.9 min |
| 16-bit integer | 2 | ~96 dB (CD) | 5.8 | 11.5 | 8.7 / 4.3 min |
| FLAC 24-bit (lossless) | ~1.5-2 | same as 24-bit | ~4.5-6 | ~9-12 | ~9 / ~4.5 min |
| FLAC 16-bit (lossless) | ~1-1.3 | same as 16-bit | ~3-4 | ~6-8 | ~14 / ~7 min |

(FLAC sizes vary with the music: dense distorted guitar compresses less, sparse vocals more.)

- **24-bit**: no audible or measurable loss for anything recorded through a microphone or interface (the converter itself is 24-bit at best). 25% smaller. Risk: a stem bounced from a DAW in float can peak above 0 dBFS and would clip; detect the peak on import and either lower it (and tell the user) or keep that one file as float.
- **16-bit**: half the size, still CD quality for a finished, well-levelled stem. Risk: quiet takes that are later pushed up on the fader bring up quantisation noise (needs dither when converting). Fine for imports of finished stems and the listening copy; less ideal for raw takes.
- **FLAC**: lossless compression on top of 24 or 16-bit, roughly another 40-50% off. All browsers decode it (`decodeAudioData`), but encoding needs a new library (e.g. a WASM build of libFLAC), so it needs the owner's OK for the dependency, and encoding a long take takes a moment.
- **Lossy (MP3 / AAC / Opus) for working takes: no.** Quality drops each time a mix is rebuilt from them, and MP3/AAC add silent padding at the start that shifts timing by a few milliseconds, which breaks sample-accurate alignment. Keep lossy for the listening copy only.
- **Other levers** instead of (or with) a smaller format: upload long files in chunks / split a long take into several files; Supabase Pro allows a much larger per-file limit and more storage; 44.1 kHz instead of 48 kHz saves only 8%, not worth it.

Recommendation: **24-bit WAV for all new takes and imports** (simple, no new dependency, safe), with the over-0 dBFS check on import. Add **FLAC** later if storage gets tight. Use **16-bit** only where the file is final (listening copy, exported previews).

---

## Addendum (2026-10-11): several stems at once + moving clips between your own channels

**Owner's decision:** dropping several stems makes one new channel per stem (all assigned to the person who dropped them), **and** a player must be able to move clips between channels assigned to them.

### Why moving a clip is more than a drag today

- A clip points at a take, and **a take belongs to one channel** (`takes.track_id`, 0001). The clip insert policy demands that the take's channel is the clip's channel (`0009` line 50: `k.track_id = clips.track_id`).
- **Nobody may update a take** (0009 drops the update policy and adds none), so a take can't simply be re-pointed.
- The audio file's path is `project/channel/take.wav` (`projectApi.ts` 513), and the storage upload / cleanup policies read the channel from that path (`0009` 97-106, `0013`).
- Deleting a channel cascades to its takes and their clips, so a clip on channel B that still pointed at a take of channel A would vanish if A were deleted.

### Plan

1. **Rule:** a player may move a clip from one channel to another only if **both are assigned to them** in the same project (Owner and Mixer included, but only for their own channels: "nobody touches a player's recordings but that player" stays true).
2. **What moves (decided 2026-10-11, "option 3"):** each clip moves on its own, like in a DAW.
   - If no other clip uses that clip's take, the **whole take moves** with it (take, its file, the clip). Nothing is copied.
   - If other pieces still use the take (a split recording), the moved piece is **cut out into its own new take**: only its audio plus a **2-second handle on each side** (so it can still be trimmed and faded a little), rendered exactly like Join (`renderClipsToBuffer`, `encodeTake`, 24-bit, bit-exact samples, fades kept on the clip, not baked in). The original take and the pieces left behind are untouched. Storage cost: only the moved piece's length.
   - Rejected: moving all pieces together (surprising, "I moved one, two moved"); copying the whole file (storage twice); a shared pool across channels (deleting / reassigning channels becomes unsafe).
3. **Database (one migration):** a `move_take(take_id, to_track_id)` function (used for the whole-take case; the cut-out case is a normal new take on the destination channel plus deleting the moved clip) (security definer) that checks both channels are the caller's, in the same project, moves the take and its clips in one transaction, and returns the new file path; plus moving the storage object (Storage `move`), or keeping the old path and teaching the cleanup policy to read the channel from `takes`, not from the path. Simpler and safer: move the file.
4. **Screen:** drag a clip up/down onto another lane that's yours (other lanes refuse the drop), plus "Move to channel ▸" in the clip menu. Undo moves it back. Realtime: both channels refresh.
5. **Side effect to keep:** "a channel with recordings can't be reassigned" now updates naturally (the old channel may become empty and reassignable again).

Size: medium (migration + store + drag between lanes). Build it **with** the multi-stem drop, so a wrong guess (stem on the wrong channel) is fixable right away.
