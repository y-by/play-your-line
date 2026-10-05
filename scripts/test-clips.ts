// Checks the clip-editing rules, the overlap rule, the grid and the waveform peaks.
// Run: npm run test:logic
import { audibleSegments, moveClip, trimClipStart, trimClipEnd, splitClip, duplicateClip, nextZ, clipEnd, clipsEnd, MIN_CLIP_SEC, type ClipData } from "../src/lib/clips.ts";
import { stepSec, snapTo, barAndBeat, formatBarsBeats, barSec, beatSec } from "../src/lib/grid.ts";
import { computePeaks } from "../src/lib/waveform.ts";
import { effectiveChannelMix } from "../src/lib/mix.ts";
import { upsertClip, removeClip, sameClip } from "../src/lib/remoteMerge.ts";
import type { Track } from "../src/types/project.ts";
import { findOrphanFiles, takeIdFromFileName, MIN_ORPHAN_AGE_MS } from "../src/lib/orphans.ts";
import { rolesOf, roleBadge, canMixFinal } from "../src/lib/roles.ts";
import { loopApplies, positionWithLoop, nextLoopPass } from "../src/lib/loop.ts";
import { gainToDb, dbToGain, MIN_DB, MAX_DB } from "../src/lib/dbFader.ts";
import { compressorParamsFromAmount, clampFx } from "../src/lib/channelFx.ts";
import { detectChords } from "../src/lib/chords.ts";
import { detectPitch, noteFromHz } from "../src/lib/tuner.ts";
import { barOfBeat, beatInBar, pinLabel, agoLabel, notesForTray, pinnedOpenNotes, mentionedIds, splitMentions, openMentionQuery } from "../src/lib/notes.ts";
import { orderTracks, defaultOrder, moveId } from "../src/lib/trackOrder.ts";

let fail = 0;
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;
const check = (name: string, ok: boolean, detail = "") => { console.log((ok ? "PASS " : "FAIL ") + name + (detail ? "  " + detail : "")); if (!ok) fail++; };
const clip = (id: string, start: number, dur: number, z: number, src = 0, take = "t1"): ClipData => ({ id, takeId: take, startSec: start, sourceStartSec: src, durationSec: dur, z });
const segs = (clips: ClipData[]) => audibleSegments(clips).map((s) => `${s.clipId}[${s.startSec}-${s.endSec}]@${s.sourceStartSec}`).join(" ");

// ---- overlap rule: newest on top, older keeps playing where nothing covers it
check("no overlap: every clip fully audible", segs([clip("a", 0, 2, 1), clip("b", 4, 2, 2)]) === "a[0-2]@0 b[4-6]@0");
check("newer clip covers the middle of an older one; older plays either side",
  segs([clip("old", 0, 8, 1), clip("new", 2, 3, 2)]) === "old[0-2]@0 new[2-5]@0 old[5-8]@5");
check("older clip fully hidden under a newer one is silent", segs([clip("old", 1, 2, 1), clip("new", 0, 5, 2)]) === "new[0-5]@0");
check("partial overlap: older is cut where the newer starts", segs([clip("old", 0, 4, 1), clip("new", 3, 4, 2)]) === "old[0-3]@0 new[3-7]@0");
check("three layers: only the top plays, middle shows through gaps",
  segs([clip("c1", 0, 10, 1), clip("c2", 2, 6, 2), clip("c3", 4, 2, 3)]) === "c1[0-2]@0 c2[2-4]@0 c3[4-6]@0 c2[6-8]@4 c1[8-10]@8");
check("segment source offset follows the clip's own trim", (() => {
  const s = audibleSegments([clip("old", 10, 6, 1, 3), clip("new", 12, 1, 2)]);
  const tail = s.find((x) => x.clipId === "old" && x.startSec === 13)!;
  return near(tail.sourceStartSec, 3 + 3) && near(tail.endSec, 16);
})());
check("empty list", audibleSegments([]).length === 0);

// ---- move
check("move keeps duration and source", (() => { const m = moveClip(clip("a", 2, 3, 1, 1), 5); return m.startSec === 5 && m.durationSec === 3 && m.sourceStartSec === 1; })());
check("move cannot go before the start of the song", moveClip(clip("a", 2, 3, 1), -4).startSec === 0);

// ---- trim
{
  const c = clip("a", 10, 4, 1, 2); // plays take 2s..6s at song 10s..14s
  const l = trimClipStart(c, 11);
  check("trim start inward: start, source and duration all shift by 1s", l.startSec === 11 && l.sourceStartSec === 3 && l.durationSec === 3 && clipEnd(l) === 14);
  const grow = trimClipStart(c, 5);
  check("trim start outward stops where the take begins (2s of audio available)", grow.startSec === 8 && grow.sourceStartSec === 0 && clipEnd(grow) === 14);
  check("trim start cannot pass the end", near(trimClipStart(c, 99).durationSec, MIN_CLIP_SEC));
  const r = trimClipEnd(c, 12, 20);
  check("trim end inward shortens the clip", r.startSec === 10 && r.durationSec === 2);
  const rg = trimClipEnd(c, 99, 8); // take is 8s long, clip reads from 2s -> at most 6s
  check("trim end outward stops at the end of the take", near(rg.durationSec, 6));
  check("trim end cannot pass the start", near(trimClipEnd(c, 0, 20).durationSec, MIN_CLIP_SEC));
}

// ---- split
{
  const c = clip("a", 4, 6, 3, 1);
  const parts = splitClip(c, 7, "b")!;
  check("split makes two clips that exactly tile the original", parts[0].startSec === 4 && clipEnd(parts[0]) === 7 && parts[1].startSec === 7 && clipEnd(parts[1]) === 10);
  check("split: right half reads the take from where the left stopped", parts[1].sourceStartSec === 1 + 3 && parts[0].sourceStartSec === 1);
  check("split halves keep the same z", parts[0].z === 3 && parts[1].z === 3 && parts[1].id === "b");
  check("split too close to an edge is refused", splitClip(c, 4.01, "x") === null && splitClip(c, 9.99, "x") === null && splitClip(c, 2, "x") === null);
  check("split halves are one continuous sound, so they play as one piece (no fade at the cut)", (() => {
    const whole = audibleSegments([c]);
    const two = audibleSegments(parts);
    return two.length === 1 && whole.length === 1 && near(two[0].startSec, whole[0].startSec) && near(two[0].endSec, whole[0].endSec) && near(two[0].sourceStartSec, whole[0].sourceStartSec);
  })());
  check("but a cut whose right half was moved is NOT merged (it jumps)", (() => {
    const moved = { ...parts[1], startSec: parts[1].startSec + 2 };
    return audibleSegments([parts[0], moved]).length === 2;
  })());
  check("a cut whose right half reads a different take is NOT merged", (() => {
    const other = { ...parts[1], takeId: "t2" };
    return audibleSegments([parts[0], other]).length === 2;
  })());
}

// ---- duplicate + z
{
  const c = clip("a", 4, 2, 1);
  const d = duplicateClip(c, "b", nextZ([c]));
  check("duplicate lands right after the original, on top", d.startSec === 6 && d.z === 2 && d.takeId === c.takeId && d.durationSec === 2);
  check("nextZ on empty list is 1", nextZ([]) === 1);
  check("song length is the end of the last clip", clipsEnd([c, d]) === 8 && clipsEnd([]) === 0);
}

// ---- grid
{
  check("120 bpm: beat 0.5s, bar 2s", beatSec(120) === 0.5 && barSec(120) === 2);
  check("step sizes at 120 bpm", stepSec(120, "bar") === 2 && stepSec(120, "beat") === 0.5 && stepSec(120, "eighth") === 0.25 && stepSec(120, "sixteenth") === 0.125);
  check("snap to 1/16 at 120 bpm", near(snapTo(1.07, 0.125), 1.125) && near(snapTo(1.05, 0.125), 1.0));
  check("snap to bar", snapTo(2.9, 2) === 2 && snapTo(3.1, 2) === 4);
  check("bar/beat at 0s is 1.1", JSON.stringify(barAndBeat(0, 120)) === '{"bar":1,"beat":1}');
  check("bar/beat at 2s (120bpm) is 2.1", formatBarsBeats(2, 120) === "2.1");
  check("bar/beat at 3.6s (120bpm) is 2.4", formatBarsBeats(3.6, 120) === "2.4");
  check("bar/beat is stable exactly on a boundary at an awkward tempo", formatBarsBeats(barSec(97) * 5, 97) === "6.1");
  check("negative positions clamp to 1.1", formatBarsBeats(-1, 120) === "1.1");
}

// ---- waveform peaks
{
  const sr = 1000;
  const s = new Float32Array(4000);
  for (let i = 0; i < 1000; i++) s[i] = 0.5; // 1s of +0.5
  for (let i = 1000; i < 2000; i++) s[i] = -0.25; // 1s of -0.25
  const p = computePeaks(s, sr, 0, 2, 2);
  check("peaks: first half is +0.5, second half is -0.25", near(p[0], 0.5) && near(p[1], 0.5) && near(p[2], -0.25) && near(p[3], -0.25), Array.from(p).join(","));
  const q = computePeaks(s, sr, 1, 1, 1);
  check("peaks honour the clip's start inside the take", near(q[0], -0.25) && near(q[1], -0.25));
}

// ---- who hears what
{
  const saved = { volume: 0.4, muted: true };
  const mine = { volume: 0.9, muted: false };
  const initiator = effectiveChannelMix({ saved, canMix: true, listeningMode: "monitor", personal: mine, solo: false });
  check("initiator always hears the saved final mix", initiator.volume === 0.4 && initiator.muted === true);
  const player = effectiveChannelMix({ saved, canMix: false, listeningMode: "monitor", personal: mine, solo: false });
  check("a player in monitor mode hears their own mix, not the saved one", player.volume === 0.9 && player.muted === false);
  const fresh = effectiveChannelMix({ saved, canMix: false, listeningMode: "monitor", solo: false });
  check("a player who hasn't touched anything starts at full volume, unmuted", fresh.volume === 1 && fresh.muted === false);
  const final = effectiveChannelMix({ saved, canMix: false, listeningMode: "final", personal: mine, solo: false });
  check("a player switched to final mix hears exactly the saved mix", final.volume === 0.4 && final.muted === true);
  check("solo is carried through unchanged and is never part of the saved mix", effectiveChannelMix({ saved, canMix: true, listeningMode: "final", solo: true }).solo === true && !("solo" in saved));
}

// ---- changes arriving from other people
{
  const track = (id: string, clips: ClipData[]): Track => ({ id, projectId: "p", instrument: "x", color: "#fff", assignedUserId: null, assignedPlayerName: null, clips, volume: 1, muted: false, position: 0 });
  const tracks = [track("a", [clip("c1", 0, 2, 1)]), track("b", [])];
  check("a new clip from someone else is added to its channel", upsertClip(tracks, "b", clip("c2", 1, 1, 1))[1].clips.length === 1);
  check("an identical clip (our own echo) changes nothing", upsertClip(tracks, "a", clip("c1", 0, 2, 1)) === tracks);
  check("a moved clip replaces the old one instead of duplicating", (() => { const t = upsertClip(tracks, "a", clip("c1", 5, 2, 1)); return t[0].clips.length === 1 && t[0].clips[0].startSec === 5; })());
  check("a clip for a channel we don't know is ignored", upsertClip(tracks, "zzz", clip("c9", 0, 1, 1)) === tracks);
  check("a deleted clip is removed from its channel", removeClip(tracks, "c1")[0].clips.length === 0);
  check("deleting a clip we don't have changes nothing", removeClip(tracks, "nope") === tracks);
  check("sameClip compares every field", sameClip(clip("a", 0, 1, 1), clip("a", 0, 1, 1)) && !sameClip(clip("a", 0, 1, 1), clip("a", 0, 1, 2)));
}

// ---- channel order
{
  const t = (id: string, position: number): Track => ({ id, projectId: "p", instrument: id, color: "#fff", position, assignedUserId: null, assignedPlayerName: null, clips: [], volume: 1, muted: false });
  const tracks = [t("c", 2), t("a", 0), t("b", 1)];
  const ids = (l: Track[]) => l.map((x) => x.id).join("");
  check("default order follows the initiator's positions", ids(defaultOrder(tracks)) === "abc");
  check("no personal order: everyone sees the default", ids(orderTracks(tracks, null)) === "abc");
  check("a personal order wins for that person", ids(orderTracks(tracks, ["c", "a", "b"])) === "cab");
  check("a channel added after the personal order goes to the bottom", ids(orderTracks([...tracks, t("d", 3)], ["c", "a", "b"])) === "cabd");
  check("a removed channel drops out of the personal order", ids(orderTracks(tracks, ["x", "c", "a", "b"])) === "cab");
  check("moving down / up", moveId(["a", "b", "c"], 0, 2).join("") === "bca" && moveId(["a", "b", "c"], 2, 0).join("") === "cab");
  check("moving to the same place changes nothing", moveId(["a", "b", "c"], 1, 1).join("") === "abc");
}

// ---- unused recording files
{
  const now = 10_000_000;
  const old = now - MIN_ORPHAN_AGE_MS - 1000;
  const files = [{ name: "used.wav", createdAtMs: old }, { name: "unused.wav", createdAtMs: old }, { name: "fresh.wav", createdAtMs: now - 1000 }];
  const orphans = findOrphanFiles(files, new Set(["used.wav"]), now).map((f) => f.name);
  check("a file no clip uses is an orphan", orphans.includes("unused.wav"));
  check("a file a clip still uses is kept", !orphans.includes("used.wav"));
  check("a brand-new file is never touched (its clip may not be saved yet)", !orphans.includes("fresh.wav"));
  check("nothing is an orphan when every file is used", findOrphanFiles(files.slice(0, 2), new Set(["used.wav", "unused.wav"]), now).length === 0);
  check("take id comes from the file name", takeIdFromFileName("abc-123.wav") === "abc-123");
}

// ---- roles
{
  const ctx = { initiatorId: "o", mixerId: "m", listenerIds: ["l"], assignedUserIds: ["p", null, "m"] };
  check("the owner is just the Owner", roleBadge(rolesOf(ctx, "o")) === "Owner");
  check("a mixer who also plays shows both", roleBadge(rolesOf(ctx, "m")) === "Mixer · Player");
  check("a plain player", roleBadge(rolesOf(ctx, "p")) === "Player");
  check("a listener", roleBadge(rolesOf(ctx, "l")) === "Listener");
  check("a stranger has no role", roleBadge(rolesOf(ctx, "x")) === null && roleBadge(rolesOf(ctx, null)) === null);
  check("only the owner and the mixer set the final mix", canMixFinal(ctx, "o") && canMixFinal(ctx, "m") && !canMixFinal(ctx, "p") && !canMixFinal(ctx, "l") && !canMixFinal(ctx, null));
}

// ---- loop
{
  const loop = { startSec: 4, endSec: 8 };
  check("no loop: position just advances", positionWithLoop(2, 3, null) === 5);
  check("before the loop end the playhead runs normally", positionWithLoop(2, 3, loop) === 5);
  check("at the loop end it jumps back to the loop start", near(positionWithLoop(2, 6, loop), 4));
  check("it keeps wrapping inside the loop", near(positionWithLoop(2, 6 + 4 + 1.5, loop), 5.5));
  check("starting inside the loop", near(positionWithLoop(5, 3.5, loop), 4.5));
  check("starting after the loop end: no looping", positionWithLoop(9, 100, loop) === 109 && !loopApplies(loop, 9));
  check("a tiny loop is ignored", !loopApplies({ startSec: 1, endSec: 1.01 }, 0));
  const p0 = { from: 2, to: 8, ctxStart: 10 };
  const p1 = nextLoopPass(p0, loop);
  const p2 = nextLoopPass(p1, loop);
  check("passes follow each other with no gap or overlap on the audio clock", p1.ctxStart === 16 && p2.ctxStart === 20 && p1.from === 4 && p2.to === 8);
}

// ---- dB fader
{
  check("unity gain reads as 0 dB", near(gainToDb(1), 0, 1e-6));
  check("0 dB converts back to unity gain", near(dbToGain(0), 1, 1e-6));
  check("+6 dB is roughly double the gain (headroom)", near(dbToGain(MAX_DB), Math.pow(10, 6 / 20), 1e-6));
  check("the lowest position is effectively silent", dbToGain(MIN_DB) < 0.002);
  check("silence (gain 0) reads as the floor, not -Infinity", gainToDb(0) === MIN_DB);
  check("out-of-range dB is clamped", near(gainToDb(dbToGain(999)), MAX_DB, 1e-6));
}

// ---- channel FX
{
  check("compressor amount 0 is effectively off (0dB threshold, 1:1 ratio)", (() => { const p = compressorParamsFromAmount(0); return p.thresholdDb === 0 && p.ratio === 1; })());
  check("compressor amount 1 is the strongest setting", (() => { const p = compressorParamsFromAmount(1); return p.thresholdDb === -30 && p.ratio === 12; })());
  check("compressor amount is clamped to 0..1", (() => { const lo = compressorParamsFromAmount(-5), hi = compressorParamsFromAmount(5); return lo.thresholdDb === 0 && hi.thresholdDb === -30; })());
  check("clampFx clamps each field to its own range", (() => { const c = clampFx({ eqLow: 99, compAmount: -5, delayTimeMs: 5000 }); return c.eqLow === 12 && c.compAmount === 0 && c.delayTimeMs === 1000; })());
  check("clampFx leaves fields that weren't passed untouched (undefined)", clampFx({ eqLow: 3 }).eqMid === undefined);
}

// ---- notes
{
  const note = (id: string, over: Partial<import("../src/types/project.ts").ProjectNote> = {}) => ({
    id, projectId: "p", authorId: "u", authorName: "Dana", body: "x", atBeat: null, trackId: null,
    sharedWithListeners: false, done: false, doneBy: null, createdAt: 1000, ...over,
  });
  check("beat 0 is bar 1, beat 1", barOfBeat(0) === 1 && beatInBar(0) === 1);
  check("beat 4 starts bar 2", barOfBeat(4) === 2 && beatInBar(4) === 1);
  check("beat 38 is bar 10, beat 3", barOfBeat(38) === 10 && beatInBar(38) === 3);
  check("a note on the first beat reads just 'Bar 9'", pinLabel(32) === "Bar 9");
  const people = [{ id: "u1", name: "Dana" }, { id: "u2", name: "Dan" }, { id: "u3", name: "Mo Lee" }];
  check("@Dana tags Dana only, not Dan", mentionedIds("hey @Dana listen", people).join() === "u1");
  check("@Dan tags Dan, and is case-insensitive", mentionedIds("@dan, please", people).join() === "u2");
  check("a name with a space can be tagged", mentionedIds("@Mo Lee try again", people).join() === "u3");
  check("an email-like word is not a tag", mentionedIds("write to a@Dana.com", people).length === 0);
  check("text is cut around tags", splitMentions("hi @Dana ok", ["Dana"]).map((p) => (p.mention ? "[" + p.text + "]" : p.text)).join("") === "hi [@Dana] ok");
  check("typing @Da opens the menu with 'Da'", JSON.stringify(openMentionQuery("see @Da")) === JSON.stringify({ query: "Da", start: 4 }));
  check("no menu once the tag is followed by a space", openMentionQuery("see @Dana ") === null);
  check("a note mid-bar says which beat", pinLabel(34) === "Bar 9 · beat 3");
  check("recent notes read 'just now'", agoLabel(10_000, 20_000) === "just now");
  check("minutes, hours and days", agoLabel(0, 5 * 60_000) === "5 min ago" && agoLabel(0, 3 * 3600_000) === "3 h ago" && agoLabel(0, 2 * 86400_000) === "2 d ago");
  const all = [note("a", { createdAt: 1 }), note("b", { createdAt: 3, done: true }), note("c", { createdAt: 2, trackId: "t1" }), note("d", { createdAt: 4, trackId: "t1", atBeat: 8 })];
  check("the tray lists open notes, newest first", notesForTray(all, { done: false, trackId: null }).map((n) => n.id).join() === "d,c,a");
  check("done notes are archived, not mixed in", notesForTray(all, { done: true, trackId: null }).map((n) => n.id).join() === "b");
  check("a channel filter keeps only that channel's notes", notesForTray(all, { done: false, trackId: "t1" }).map((n) => n.id).join() === "d,c");
  check("only open, pinned notes become flags, in timeline order", pinnedOpenNotes([note("x", { atBeat: 12 }), note("y", { atBeat: 4 }), note("z", { atBeat: 2, done: true }), note("w")]).map((n) => n.id).join() === "y,x");
}

// ---- chord detection (synthetic guitar-like chords: harmonics, a short strum, a decaying ring)
{
  const SR = 44100;
  const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);
  const strum = (notes: number[], seconds: number, out: Float32Array, startSec: number, amp = 0.25) => {
    notes.forEach((m, idx) => {
      const f = hz(m);
      const n = Math.floor(seconds * SR);
      const offset = Math.floor((startSec + idx * 0.012) * SR);
      for (let i = 0; i < n && offset + i < out.length; i++) {
        const t = i / SR;
        let v = 0;
        for (let h = 1; h <= 7; h++) v += Math.sin(2 * Math.PI * f * h * t) / h;
        out[offset + i] += amp * Math.exp(-t * 1.6) * Math.min(1, t * 200) * v;
      }
    });
  };
  const chords: [string, number[]][] = [["C", [48, 52, 55, 60, 64]], ["Am", [45, 52, 57, 60, 64]], ["F", [41, 48, 53, 57, 60, 65]], ["G", [43, 47, 50, 55, 59, 67]], ["Em", [40, 47, 52, 55, 59, 64]], ["D7", [50, 57, 60, 66, 62]]];
  const names = (segs: ReturnType<typeof detectChords>) => segs.map((x) => x.chord ?? "-").join(" ");
  const song = new Float32Array(SR * 2 * chords.length);
  chords.forEach(([, notes], i) => {
    strum(notes, 2, song, i * 2);
    strum(notes, 2, song, i * 2 + 1, 0.2);
  });
  const whole = { timelineStartSec: 0, sourceStartSec: 0, durationSec: song.length / SR };

  check("six clean chords, one per bar, are all named right", names(detectChords(song, SR, 120, whole)) === "C Am F G Em D7");
  check("they land on the right bars of the project grid", detectChords(song, SR, 120, whole).map((x) => `${x.startBeat}-${x.endBeat}`).join(" ") === "0-4 4-8 8-12 12-16 16-20 20-24");
  check("hiss at -20 dB does not change the answer", names(detectChords(Float32Array.from(song, (v) => v + (Math.random() - 0.5) * 0.12), SR, 120, whole)) === "C Am F G Em D7");
  check("a clip placed off the beat grid (0.3 s) still reads the same chords", names(detectChords(song, SR, 120, { ...whole, timelineStartSec: 0.3 }).filter((x) => x.chord)).startsWith("C Am F G Em D7"));
  const trimmed = detectChords(song, SR, 120, { timelineStartSec: 4, sourceStartSec: 2, durationSec: 6 });
  check("a trimmed clip is read from where it starts, placed where it sits", names(trimmed) === "Am F G" && trimmed[0].startBeat === 8);
  const gap = song.slice();
  gap.fill(0, SR * 4, SR * 6);
  check("a silent bar is 'no chord', not a guess", names(detectChords(gap, SR, 120, whole)) === "C Am - G Em D7");
  const quick = new Float32Array(SR * 8);
  for (let i = 0; i < 4; i++) {
    strum(chords[0][1], 1, quick, i * 2);
    strum(chords[3][1], 1, quick, i * 2 + 1);
  }
  check("chords that change every two beats are followed", names(detectChords(quick, SR, 120, { timelineStartSec: 0, sourceStartSec: 0, durationSec: 8 })) === "C G C G C G C G");
  const power = new Float32Array(SR * 4);
  strum([40, 47, 52], 2, power, 0);
  strum([45, 52, 57], 2, power, 2);
  check("two-note power chords are read by their root", names(detectChords(power, SR, 120, { timelineStartSec: 0, sourceStartSec: 0, durationSec: 4 })) === "E A");
  check("a recording shorter than a fifth of a second gives nothing", detectChords(new Float32Array(1000), SR, 120, { timelineStartSec: 0, sourceStartSec: 0, durationSec: 0.02 }).length === 0);
}

{
  const sr = 44100;
  const tone = (hz: number) => Float32Array.from({ length: 4096 }, (_, i) => 0.4 * Math.sin((2 * Math.PI * hz * i) / sr) + 0.15 * Math.sin((4 * Math.PI * hz * i) / sr));
  const e2 = detectPitch(tone(82.41), sr);
  check("tuner hears low E (82.41 Hz)", e2 !== null && Math.abs(e2 - 82.41) < 0.5);
  const a4 = noteFromHz(detectPitch(tone(440), sr) ?? 0);
  check("tuner reads 440 Hz as A4, in tune", a4.name === "A" && a4.octave === 4 && Math.abs(a4.cents) <= 2);
  const sharp = noteFromHz(440 * Math.pow(2, 20 / 1200));
  check("tuner reports 20 cents sharp", sharp.name === "A" && sharp.cents === 20);
  check("tuner gives nothing for silence", detectPitch(new Float32Array(4096), sr) === null);
}

process.exit(fail ? 1 : 0);
