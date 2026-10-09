# Research: Master channel (task 6) and Group channels (task 7)

Written 2026-10-09. Research only: nothing in the app was changed. Line numbers point at the code as it is today (uncommitted edits to a few files may shift them slightly).

---

## Summary (read this first)

- **Today there is no master channel.** Every channel plays straight into one hidden volume node that goes to the speakers (`audioEngine.ts` lines 71, 177-178, 373). The "M" and "S" buttons in the ruler corner are shortcuts: "M" mutes or un-mutes every channel one by one, "S" clears all solos. There is no master volume, no master meter, no master effects.
- **The export and the MP3 listening copy are built separately** from live playback (`mixdown.ts`). They repeat the channel wiring by hand, so a master channel has to be added in two places, ideally through one shared function so they cannot drift apart. The effect chain already works this way (`fxChain.ts`), so the pattern exists.
- **Master (task 6) is a medium job.** Recommended first version: a master fader, a stereo level meter with a clip light, and master EQ + compressor (reusing what channels already have) plus a simple safety limiter. It is saved on the project, and only the Owner and Mixer can change it. It needs one small migration (`0040`).
- **Groups (task 7) are a large job.** It needs a new table (`track_groups`), a "group" field on each channel, a new group strip in the screen, careful solo and mute rules, and the same effect chain again. Recommended first version: one level of groups (no groups inside groups), a group has volume, mute, solo, pan and the same EQ/Compressor effects as a channel, groups feed the master, and only the Owner makes and assigns groups.
- **Build master first.** Groups need the same "shared mix builder" and the same "saved mix settings with FX" pieces, so the master work lays the foundation. Rough total: master medium, groups large.
- **Biggest risks:** (1) the existing hidden master volume node is already used to fade the sound while a microphone opens (`withQuietOutput`), so the new master fader must be a separate node; (2) the Web Audio compressor is not a true brick-wall limiter, so "limiter" in version 1 is a safety net, not a mastering-grade tool; (3) the guard trigger on `tracks` has been rewritten in full by several migrations, so touching it again must start from the newest version (0037), or an old rule will be lost; (4) the published MP3 goes stale whenever the master or a group changes, same as for channel changes today.
- **Questions for the owner** are at the end (plain language).

---

## Part 1. How the sound is built today

### Live playback (`src/lib/audioEngine.ts`)

Each channel is a small chain of audio "boxes" wired in a row (lines 355-392):

```
clips -> fader (gain) -> effects (EQ, Compressor, Delay, Reverb) -> pan -> MASTER NODE -> speakers
                                         \-> level meter (analyser, tapped off the effects output)
```

- The master node is one plain gain box, created in the constructor (lines 177-178) and connected straight to the speakers. Every channel's pan connects to it (line 373). It has no fader the user can touch, no meter and no effects.
- Its only job today is `withQuietOutput` (lines 292-309): when a microphone is opened during playback, the whole song is faded to silence for a moment and back to 1, to hide the click the computer makes when it re-configures audio. **Important for the master work:** that function sets the gain to exactly 1 at the end, so it must not share a node with a user-controlled master fader.
- The metronome click goes straight to the speakers, not through the master (lines 180-183). That is correct and should stay: the click must not be affected by master effects, and it is never in the export.
- Volume, mute and solo are decided in `applyMixLevels` (lines 512-518): if any channel is soloed, only soloed channels are heard (solo beats mute), otherwise muted channels are silent. The result is just the channel's fader value.
- Meters: one small analyser per channel, read every 25 ms by a timer (lines 459-479) and eased in the store (`useProjectStore.ts` ~566-571). Master metering can use the same approach.

### Who decides what is heard (`useProjectStore.ts`, `lib/mix.ts`)

- `syncMixToEngine` (store ~572-583) pushes each channel's volume, mute, solo and pan into the engine.
- `effectiveMix` (`lib/mix.ts`): the Owner and Mixer hear and edit the **saved** mix. Everyone else either hears their own **personal monitor mix** (kept on their device only, `monitor` and `localSolo` in the store) or the saved mix read-only. Solo is never saved.
- The ruler corner (`Ruler.tsx` lines 107-135): "M" calls `setAllMuted` (store ~1617), which for the Owner/Mixer sets `muted` on every channel and saves each one; for a player in monitor mode it mutes every channel in their personal mix. "S" calls `clearSolo`.

### Export Mix and MP3 listening copy (`src/lib/mixdown.ts`, `projectActions.ts`, `mp3.ts`)

- `renderMix` (mixdown.ts lines 15-57) rebuilds the graph in an offline audio context: for each channel, fader -> effects (`createFxChain`, the same function the live engine uses) -> pan -> destination (lines 39-54). Muted channels are left out (line 24), solo is ignored ("a listening aid", line 11), and echo/reverb tails are added to the length (lines 31-33).
- Export Mix = `renderMix` -> 32-bit float WAV (`mixdownProject`, `exportMix`). Listening copy = `renderMix` -> 128 kbps MP3 (`buildListeningCopy` in `projectActions.ts` lines 20-28), made when a project is published or when the refresh button is pressed.
- **Gap to know about:** `mp3.ts` clamps samples to the range -1..+1 when it converts to 16-bit. Today, if the channels add up louder than full scale, the MP3 clips harshly and the WAV just contains values above 1. A master limiter would fix this properly. This is a real argument for building the master.

### Data and sharing today

- Mix values live as columns on the `tracks` table: `volume`, `muted`, `pan` (migration 0030), and the effect settings (0016, 0034, 0036, 0037). `fx_locked` lets the Owner/Mixer stop a player changing their channel's effects (0034).
- Who may change what is enforced in the database by a "guard" trigger on `tracks` (`guard_track_columns`), rewritten in full by 0018, 0030, 0034, 0036, 0037 (and earlier). Volume, mute, pan: Owner or Mixer only. The channel's own player may change its FX unless locked. Colour, place, name, player: Owner only.
- Live sharing: the `projects`, `tracks` and `clips` tables are in the realtime publication (0010). The store listens to project and channel changes (`realtime.ts` lines 33-50; `handleTrackChange` store ~757-800), and has a "don't fight my own pending save" rule (`pendingMixSaves`, `pendingFxSaves`).
- Undo (`undoStack`, store ~498-504) covers clip edits only. Effects have their own per-channel "step back" list kept for the visit (`fxUndoStacks`). Mix changes (volume, mute, pan) are not undoable.

---

## Part 2. Master channel (task 6)

### What other programs do (short)

- **Logic, Pro Tools, Ableton, BandLab:** every project has exactly one master (Logic: "Stereo Out", Pro Tools: "Master Fader", Ableton: "Master", BandLab: master/"Mastering" panel). It always has a fader and a stereo meter, and effects that go **after** everything else (EQ, compressor, limiter are the usual ones). It cannot be deleted. Pro Tools' master fader is a real channel; a limiter is normally the last effect so nothing goes over 0 dB.
- Export always goes through the master, so what you hear is what you export. Mute on a master silences the whole song (it is not the same as "mute every channel").

### What would change in the audio engine

1. Keep the existing node for the quiet-fade. Add a **master chain** after it, a new function `createMasterChain(ctx)` placed in its own file (like `fxChain.ts`) so live and offline share it:

```
all channels (or groups) -> [existing fade node] -> master fader -> master EQ -> master compressor -> safety limiter -> master meter -> speakers
```

2. Reuse `createFxChain` for EQ and Compressor with the delay and reverb stages simply left off (they are switches already, `fxChain.ts` `route`/`activeStages`). Delay and reverb on a master are unusual; leave them out of the screen.
3. Limiter, three options:
   - **A (minimum):** a second `DynamicsCompressorNode` set to threshold about -1 dB, ratio 20, fast attack. Cheap, works live and offline. It is a "safety squeezer", not a perfect brick wall; fast peaks can still slip slightly over.
   - **B:** an AudioWorklet limiter with look-ahead (a true limiter). The app already uses a worklet for recording (`worklets/pcm-recorder-processor.js`) and offline contexts can load worklets too, so it is possible; more work and more testing.
   - **C:** no limiter, only a "clipping" light. Honest and simple, but it leaves the MP3 clipping problem.
   Recommendation: **A in version 1**, call it "Limiter (safety)" not "mastering limiter", and plan B for later.
4. Metering: one stereo analyser (L and R via a channel splitter) after the limiter, read by the same 25 ms timer; peak-hold and a "clip" light that stays lit until clicked. The channel meter component (`ChannelMeter.tsx`, 68 lines) can be reused or copied for a vertical version.
5. Browser differences: the Web Audio compressor is built into the browser and behaves a little differently between Chrome, Safari and Firefox, so a mix may sound slightly different between browsers. Live and export in the **same** browser match; export done in another browser may differ slightly. Worth one line in Help.

### Offline mixdown, so playback, MP3 and Export Mix match

- In `renderMix`, replace the line `panner.connect(offlineCtx.destination)` (mixdown.ts line 48) with a connection to one master chain built by the same `createMasterChain(offlineCtx)`, set from the project's saved master settings.
- Add the master's own tail to the length calculation (lines 31-33) only if delay/reverb are ever allowed on it. A compressor/limiter adds none. A little silence after the last note (say 0.1 s) avoids chopping a limiter release.
- Master mute in the saved mix means the export is silent; the app should refuse or warn rather than quietly render silence (see risks).
- **Test idea (cheap, fits the existing test style):** render a short test mix through the live graph builder and the offline builder in an offline context and compare the numbers. The rule "one builder function for both" is the main protection.
- The MP3 copy uses the same `renderMix`, so it follows automatically. It becomes stale whenever the master changes, same as a channel change today (the refresh button exists).

### Data model and Supabase

The master belongs to the whole project, so it goes on the `projects` row (it is exactly one per project):

- `master_volume real not null default 1` (0..1; or allow up to +6 dB, see questions)
- `master_muted boolean not null default false`
- `master_fx jsonb not null default '{}'` for EQ/compressor/limiter settings. A json column avoids a new migration every time a master knob is added (the channel FX needed migrations 0016, 0034, 0036, 0037, each rewriting the guard trigger). The app validates and clamps values (as `clampFx` does for channels), and a database check can limit the size.

**Permissions:** today only the Owner updates `projects` (policy "only the initiator can update the project", 0001; check what 0014 changed for the Mixer before writing the migration). The master is "the final mix", so it should be **Owner and Mixer**, the same as volume and mute. Two ways:
1. A guard trigger on `projects` that lets the Mixer change only the three master columns (and the Owner everything), or
2. A small `security definer` function `set_master_mix(project_id, ...)` that checks Owner-or-Mixer and updates only those columns.
Option 2 is smaller and safer (no rewriting of a big trigger). Players and listeners cannot change it either way.

**Realtime:** `projects` is already in the publication and the store already handles project updates (`onProject`, realtime.ts line 36). The store needs to read the three new fields when a project update arrives, with the same "ignore the echo of my own pending save" rule. People hearing the song then get master changes live, like the channel faders.

**Loading:** `mapProject` (`projectApi.ts` line 13) and the project list queries must read the new columns. Old projects get the defaults, which sound exactly as today (volume 1, no FX) so **nothing changes for existing songs**.

Migration: **`0040_master_channel.sql`**, safe to run more than once, owner runs it (per working rules), plus tests for the clamping/defaults.

### Screen options

- **A (recommended): master strip pinned at the bottom (or the top) of the channel list**, always visible, same width as the channel info column: fader, meter, M, an "FX" button that opens the same effect panel used for channels (EQ + comp + limiter only). The ruler corner then goes back to just "Bar" and the follow button.
- **B:** keep the ruler corner and enlarge it. It is too small for a fader and meter.
- **C:** a separate "Master" panel that slides in from the side. Cleaner for small screens; one tap further away.
The existing `ChannelFx.tsx` (624 lines) is built around a Track; it needs to be made to work for "something with FX settings" (a channel, the master, later a group). That refactor is the largest part of the screen work and pays off twice (it is also needed for groups).

### The ruler "M" and "S" buttons

Decide what they become (open question). Suggestion: keep "S" ("clear all solos") where it is, and let a real master mute live on the master strip. Keep a "mute all channels" action only if the owner still wants it.

### How it fits with existing features

- **Mute/solo:** master mute silences the song; solo only affects which channels feed it. Solo is a listening aid and never saved, so it stays outside the master and outside the export.
- **Monitor mix (players):** personal monitor mixes change channel levels only. Recommendation: **master volume and master FX always apply as saved**, so players hear what the final mix will sound like (an EQ'd master that players don't hear would mislead them). A player who wants it louder uses the device volume.
- **Channel FX Compare** button: unchanged (it is per channel). A "Compare master" bypass (hear the master without its FX, device only, never saved) would be a natural small extra.
- **Undo:** reuse the per-visit FX step-back list (`fxUndoStacks`) with the key "master". Master fader and mute are not undoable today for channels either; keep it equal.
- **Count-in click and metronome:** unaffected (they bypass the master).
- **Recording:** latency compensation is measured on the output path. A limiter or compressor in the path can add a few milliseconds of look-ahead (the browser's compressor does), so latency calibration should be re-checked after building it; the tests with the real interface are for the owner.

### Risks and edge cases

- Fade node clash (above): keep two separate nodes.
- Gain stacking: a master fader above 1.0 plus a limiter is safer than letting the fader exceed 1 with no limiter; if the fader maximum is 1.0 (0 dB) only turning down is possible, which is simplest and matches how channels work today.
- Metering cost: one more analyser polled every 25 ms is negligible.
- Clip indicator should react to the **post-limiter** level and to the pre-limiter level separately in a later version; in version 1 one light after the limiter.
- A published song's listening copy goes stale (see above). Idea: when the master changes on a published project, show "Listening copy is out of date, refresh" (the list already has a refresh button).
- Master mute saved on a published project would produce a silent copy; warn before publishing.
- Existing songs must sound identical until someone touches the master (defaults are neutral). Worth a test: render with defaults before and after, numbers must be equal.

### Minimal first version vs later

**First version (recommended):** master fader (0 to 100 percent, shown in dB like the channel faders via `dbFader.ts`), stereo meter with clip light, master mute, EQ (the existing 3-band + low cut) and compressor (existing), safety limiter on/off with a ceiling, FX power switch + Reset, saved on the project, Owner/Mixer only, live to others, applied in playback / Export Mix / MP3 identically, Help text, tests.

**Later:** true look-ahead limiter (worklet), loudness reading (LUFS) with a target for streaming, mid/side or stereo width, a spectrum display, master "Compare", A/B presets ("Gentle glue", "Loud"), dither when making the 16-bit MP3, export-time options (normalise to a target loudness).

---

## Part 3. Group channels / busses (task 7)

### What other programs do (short)

- **Logic:** "Summing stack" or a bus/aux channel: channels send into it, the group strip has its own fader, mute, solo, pan and plugins, and can be folded open or closed. **Pro Tools:** an Aux track fed by a bus; the tracks' output is set to that bus. **Ableton:** "Group Track": select tracks, Cmd/Ctrl-G; it folds, has its own effects and meters, and soloing/muting a group affects all its tracks. **BandLab:** track groups/folders are basic (mainly mute/solo/collapse; effects are mostly per track and on the master).
- Shared ideas: grouping is a real sub-mix (sound is added together first, then goes through the group's effects); a group can be collapsed; a member keeps its own fader; the group feeds the master; deleting a group does not delete the tracks.

### What would change in the audio engine

Channel wiring becomes:

```
clips -> fader -> effects -> pan --+--> (no group)  -> MASTER
                                   |
                                   +--> group input -> group fader -> group effects -> group pan -> group meter -> MASTER
```

1. A `groups` map next to `tracks` in the engine, each with the same parts as a channel (fader, `createFxChain`, panner, analyser) but fed by other channels instead of clips.
2. `ensureTrack` (lines 355-392) connects the channel's pan to `masterGain` today. It would connect to the group's input instead if the channel has a group. Changing a channel's group means disconnecting and re-connecting its pan output; do it with a tiny fade (a few milliseconds) to avoid a click.
3. `removeTrack`, `disconnectTrack`, `resetProject` (lines 424-445, 488-496) must also tear groups down.
4. **Solo and mute logic** (`applyMixLevels`, lines 512-518) needs new rules (below).
5. Reuse: `createFxChain` already works for any chain, so no new audio code for the group's EQ/Compressor/Delay/Reverb.

### Solo and mute rules (the tricky part)

Today: if anything is soloed, only soloed channels are heard; otherwise muted channels are silent; solo beats mute. With groups, suggested rules (same as Ableton and Logic in spirit):

1. **Solo a channel:** that channel is heard, and its group path stays open (the group's fader and FX still apply, even if other channels in the group are not soloed or the group itself is muted). Everything else is silent.
2. **Solo a group:** every channel in the group is heard.
3. **Mute a group:** all its channels are silent, unless something inside is soloed (solo beats mute, as today).
4. **Mute a channel inside a group:** only that channel.
5. A group's own gain: if anything is soloed anywhere, a group is open when it is itself soloed or any member is soloed; otherwise open unless muted.
6. Solo stays device-only and never saved. In the saved mix and in the export, solo is ignored and mute counts: a muted group exports silent for all its members.

This is a pure function (inputs: channels, groups, mute/solo flags; output: gain for each), so it can be written once and tested with numbers like `lib/mix.ts`, and used by both the live engine and the offline render.

### Offline mixdown

`renderMix` builds the groups first (group chain -> master), then each channel connects to its group's input or to the master (mixdown.ts lines 39-54). Muted-channel skipping (line 24) must also skip channels whose group is muted. Tail length (lines 31-33) must include the group FX tails. Use the shared "mix builder" idea: one function builds the whole graph for any context (live or offline), so there is exactly one set of wiring rules. This is a bigger refactor than the master, because the live engine builds channels piece by piece as takes load and as realtime changes arrive.

### Data model and Supabase

New table (migration **`0041_track_groups.sql`**):

- `track_groups(id uuid, project_id, name text, color text, position int, volume real, muted bool, pan real, fx_on ... or fx jsonb, fx_locked?, created_at)`, with the same ranges and checks as channels.
- `tracks.group_id uuid null references track_groups(id) on delete set null`. A channel in no group goes straight to the master (so all existing songs are unchanged).
- Add `track_groups` to the realtime publication (as 0010 did).

**Permissions (suggested):**
- Create, rename, delete, recolour and assign channels to a group: **Owner only**, like adding channels and changing colour or place (0015 let anyone add a channel, but placement is Owner-only; groups change the structure of the song so Owner-only is safest).
- Group volume, mute, pan and effects: **Owner and Mixer**, like the saved mix. A channel's player does not get to touch the group's FX (it affects other people's channels).
- The `tracks` guard trigger must refuse a `group_id` change by anyone but the Owner. **Warning:** `guard_track_columns` was fully re-created in 0018, 0030, 0034, 0036, 0037; the new migration must copy the **newest** version (0037) and add one rule, or an earlier fix could be silently lost (0020 shows a regression like this happened once).
- RLS for `track_groups`: visible with the project (same pattern as "tracks visible with their project" in 0001/0008); insert/delete by the Owner; update by Owner or Mixer with a guard trigger that stops the Mixer from changing name/colour/position.
- Also a check that the group and the channel belong to the **same project**.

**Realtime:** new subscription for `track_groups` (like tracks in `realtime.ts`); note delete events cannot be filtered by project, so the store must ignore groups not in the open project (the notes table has the same issue). When a group is deleted, the database sets its channels' `group_id` to null; the store should also clear `groupId` locally at once rather than wait for the follow-up channel updates. Load groups in `getProject`; `mapTrack` (`projectApi.ts` line 63) reads `group_id`.

**Undo:** group changes (create, assign, delete) are not undoable in version 1 (channel mix changes are not either). Group FX can use the per-visit step-back list keyed by group id.

### Screen options

The channel list is one row per channel with the info column on the left and the clip lane on the right (`Arrangement.tsx`, `ChannelLane.tsx`, `ChannelInfo.tsx`).

- **A (recommended): a group header row** above its channels. The row has a fold arrow, name, colour, fader, M, S, pan, meter and an "FX" button, but no clips. Member lanes sit under it, indented with a thin bar in the group colour. Folding hides the member lanes; the header row stays and may show a simple combined picture of the members' clips (optional, later). It looks like Ableton/Logic and needs few new ideas.
- **B:** a "Mixer view" (a separate page with vertical strips, like a real console), where groups are drawn as wider strips. Very clear for mixing, but a second layout to build and keep consistent, and the app is built around the timeline.
- **C:** groups only as a coloured label on channels with no strip of their own, and the group's controls in a pop-up. Smallest, but not what "a group channel with its own FX" asks for.

**How a channel is assigned:** (1) a small "Group" drop-down in the channel's menu or info area (None / Drums / Bass / New group...) [version 1]; (2) later: select several channels and press "Group them" (like Ableton's Cmd-G); (3) later: drag a lane onto a group header.

**Order:** members must sit together under their group. Channel order today is a number per channel plus each person's own personal order (`lib/trackOrder.ts`, `moveTrack`). Rule: sort by group first (groups by their own position), then by the usual order inside the group, so a personal order only reorders inside a group and groups can't be torn apart. Dragging to reorder (`startDrag` in `Arrangement.tsx`) needs to stay inside a group, or drag the whole group by its header.

### Interaction with the other features

- **Mute/solo/monitor:** see rules above. In monitor mode (players), groups apply as saved and the player's personal channel mix sits inside them, same as the master (open question: a muted group in the saved mix will then be silent for players too, which is probably right but worth the owner's yes).
- **FX:** a group has its own chain; channel FX stay on the channel. Order is channel FX -> group FX -> master FX. Compressing a group ("drum glue") is the classic use.
- **Recording:** a channel being recorded plays in its group as usual; monitoring while recording sounds the same as playback.
- **Meters:** each group gets a meter like a channel; the channel meters stay post-channel-FX as now.
- **Master channel:** groups feed the master, so master FX and the limiter see the sum of groups and ungrouped channels. This is why the master comes first.

### Risks and edge cases

- **Deleting a group:** do not delete channels. Ask first ("Ungroup 3 channels?"); the channels go to the master and keep their own settings. The group's volume change is lost; the sound can get louder or quieter, so show a short message.
- **Group of one / empty group:** allowed, shown, and an empty group makes no sound. Optionally the Owner can delete it with one click.
- **A channel deleted** (only empty channels can be removed, 0011): it just leaves its group.
- **Nested groups:** not supported in version 1 (a group inside a group). Block it in the screen and by a database check (groups have no `group_id`).
- **Two people at once:** one Owner changes assignment while the Mixer moves the group fader. Both are different columns/rows, and the pending-save logic must be copied for groups (store keyed by group id).
- **Latency:** adding gain/pan/compressor nodes in the path costs no measurable delay; a compressor adds a few ms of look-ahead (same as a channel with comp on). All channels in all groups still start from the same scheduled instant (`play()`, line 539+), so sync is not at risk.
- **Pan:** pan on a channel then pan on a group: pans add (a channel hard left stays left inside a centred group). That is normal and correct, but a hard-left channel in a group panned hard right becomes quiet, as in other programs.
- **Meter count:** more analysers polled every 25 ms; with 16 channels and a few groups still small. Pause the timer when the page is hidden if it ever matters.
- **Solo bugs are the most likely bugs.** The pure-function approach with a table of test cases (as in `scripts/test-clips.ts`) is the best protection.
- **Old published songs** have no groups, so they sound as before.
- Personal colours and orders (`personalColors`, `personalOrder`) are local choices; groups should keep their own saved colour (Owner sets it).

### Minimal first version vs later

**First version (recommended):** one level of groups; create/rename/recolour/delete (Owner); assign by a drop-down on the channel; group header row with fold/unfold, fader, mute, solo, pan, meter, and the same FX panel as channels; solo/mute rules as above; saved and live-shared; identical in Export Mix and the MP3; Owner makes groups, Owner/Mixer set levels; Help text; tests for the solo logic and for render parity.

**Later:** select-several-and-group, drag lanes into a group, drag a whole group, a folded group showing the combined clips, group "FX lock" like channels, send/return effects (one shared reverb that channels feed by an amount; that is a different idea: an "aux send"), groups inside groups, a Mixer view page, group templates ("Drums kit"), group-level undo.

---

## Part 4. Suggested build order and rough size

| Step | What | Size |
|---|---|---|
| 1 | Pull the "FX panel" and "FX settings store logic" out of channel-only code so something other than a channel can use them (the master, later groups). No visible change. | small to medium |
| 2 | **Shared graph builder** for the end of the chain (master), used by the live engine and `renderMix`; test that existing songs render the same numbers as before. | small |
| 3 | **Master**: engine (fader node, EQ, comp, limiter, meter), migration `0040`, store, realtime, screen strip, Help, tests, STATUS/README/Systems Check updates. | medium |
| 4 | Solo/mute **pure rule function** with tests (works with or without groups). | small |
| 5 | **Groups engine + offline render** (group chains, routing, tear-down, same builder live and offline). | medium |
| 6 | **Groups data**: migration `0041` (table, column, RLS, guard trigger update, realtime), API, store, realtime merge, deleting rules. | medium |
| 7 | **Groups screen**: header row, fold, assign drop-down, ordering rules, Help, tests, status files. | medium to large |

Overall: **master = medium** (a few sessions of work), **groups = large** (about twice the master). Each can be pushed separately; the master is useful alone.

---

## Part 5. Questions for the owner (plain language)

1. **Master volume range:** should the master fader only turn the song down (0 to 100 percent, like channels), or also allow turning it up a little (for example up to +6 dB)? Turning down only is simplest and safest.
2. **What should the "M" button in the top-left corner do from now on?** Today it mutes every channel. With a real master, "M" would naturally mean "mute the whole song". Do you still want a "mute every channel" button, or can it go?
3. **Should players hear the master effects and the group settings?** Suggestion: yes, always, so everyone hears the real sound; players keep their own channel levels only. Or should players be able to switch the master effects off for themselves?
4. **Limiter:** is a simple "safety" limiter enough for now (it stops loud peaks from distorting the MP3), or do you want a proper mastering limiter even if that takes longer?
5. **Master FX list:** EQ, compressor and limiter only, or also reverb/delay on the master (unusual)? And do you want loudness reading (LUFS) soon?
6. **Who may create groups?** Suggestion: only you (the Owner) create, name, delete groups and put channels in them; you and the Mixer set group level, mute, pan and effects. Should players be able to add their own channel to a group?
7. **Do groups need their own effects in the first version, or just volume, mute, solo and pan?** Effects reuse the channel panel, so including them is not much extra work.
8. **Folding:** when a group is folded, is it enough to hide the channels, or do you want to still see all their clips merged into one lane?
9. **Deleting a group:** channels should stay and fall back to the master, with a warning first. OK?
10. **Soloing a channel inside a muted group:** you would hear it (solo beats mute, as it does for channels today). OK?
11. **Published songs:** when you change the master or a group on a published song, should the app remind you that the listening copy is out of date, or refresh it by itself?
12. **Order of work:** master first, then groups. OK, or is the order the other way round for your songs?

---

## Files that would be touched (for planning)

- Engine and render: `src/lib/audioEngine.ts`, `src/lib/mixdown.ts`, `src/lib/fxChain.ts` (shared use), a new `src/lib/masterChain.ts`, a new pure solo/mute file next to `src/lib/mix.ts`.
- Data: `src/types/project.ts`, `src/lib/projectApi.ts` (`mapProject`, `mapTrack`, new save calls), `src/lib/realtime.ts`, `src/store/useProjectStore.ts` (sync to engine, realtime merge, saves, undo keys), `src/lib/trackOrder.ts`.
- Screen: `src/components/arrangement/Arrangement.tsx`, `ChannelLane.tsx`, `ChannelInfo.tsx`, `ChannelFx.tsx` (make generic), `Ruler.tsx` (corner), a new master strip and a new group header component; `src/lib/helpContent.ts`.
- Database: new `supabase/migrations/0040_master_channel.sql` and `0041_track_groups.sql` (owner runs them).
- Docs to update when built: `STATUS.md`, `README.md`, `docs/ARCHITECTURE.md` (the audio diagram around line 260 shows a "Master mix" box that will become real), and the Systems Check.
