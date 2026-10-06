// Checks the clip-editing rules, the overlap rule, the grid and the waveform peaks.
// Run: npm run test:logic
import { audibleSegments, moveClip, trimClipStart, trimClipEnd, splitClip, duplicateClip, nextZ, clipEnd, clipsEnd, MIN_CLIP_SEC, fitFades, setClipFade, fadeGain, envelopePoints, type ClipData } from "../src/lib/clips.ts";
import { stepSec, snapTo, barAndBeat, formatBarsBeats, barSec, beatSec } from "../src/lib/grid.ts";
import { computePeaks } from "../src/lib/waveform.ts";
import { effectiveChannelMix } from "../src/lib/mix.ts";
import { upsertClip, removeClip, sameClip } from "../src/lib/remoteMerge.ts";
import type { Track } from "../src/types/project.ts";
import { findOrphanFiles, takeIdFromFileName, MIN_ORPHAN_AGE_MS } from "../src/lib/orphans.ts";
import { rolesOf, roleBadge, canMixFinal } from "../src/lib/roles.ts";
import { loopApplies, positionWithLoop, nextLoopPass } from "../src/lib/loop.ts";
import { gainToDb, dbToGain, MIN_DB, MAX_DB } from "../src/lib/dbFader.ts";
import { clampFx, eqResponseDb, hzToPos, posToHz, formatHz, EQ_FREQ_RANGE, activeStages, isNeutralFx, fxTailSec, fxFromRow, fxToRow, presetPatch, resetPatch, FX_PRESETS, DEFAULT_CHANNEL_FX } from "../src/lib/channelFx.ts";
import { detectChords } from "../src/lib/chords.ts";
import { detectPitch, noteFromHz, centsFromTarget, hzOfMidi, strobeSpeed, INSTRUMENTS } from "../src/lib/tuner.ts";
import { HELP_TOPICS, HELP_GROUPS, helpTopic } from "../src/lib/helpContent.ts";
import { parseTip } from "../src/lib/tooltip.ts";
import { barOfBeat, beatInBar, pinLabel, agoLabel, notesForTray, pinnedOpenNotes, mentionedIds, splitMentions, openMentionQuery } from "../src/lib/notes.ts";
import { orderTracks, defaultOrder, moveId } from "../src/lib/trackOrder.ts";

let fail = 0;
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;
const check = (name: string, ok: boolean, detail = "") => { console.log((ok ? "PASS " : "FAIL ") + name + (detail ? "  " + detail : "")); if (!ok) fail++; };
const clip = (id: string, start: number, dur: number, z: number, src = 0, take = "t1"): ClipData => ({ id, takeId: take, startSec: start, sourceStartSec: src, durationSec: dur, z, fadeInSec: 0, fadeOutSec: 0 });
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
  const on = { ...DEFAULT_CHANNEL_FX, fxOn: true };
  check("a new channel has the effects switched OFF", DEFAULT_CHANNEL_FX.fxOn === false);
  check("with the power switch off, no effect runs whatever the settings", activeStages({ ...on, fxOn: false, eqLow: 6, reverbMix: 0.5, compRatio: 8 }).length === 0);
  check("with everything neutral, nothing runs even when switched on", activeStages(on).length === 0 && isNeutralFx(on));
  check("only the effects that change the sound run, in order", activeStages({ ...on, reverbMix: 0.3, eqMid: 3, compRatio: 4 }).join() === "eq,comp,reverb");
  check("a bypassed effect is left out", activeStages({ ...on, eqLow: 5, eqOn: false, delayMix: 0.4 }).join() === "delay");
  check("Compare (hear dry) takes every effect out", activeStages({ ...on, eqLow: 5 }, true).length === 0);
  check("make-up gain alone counts as an effect", activeStages({ ...on, compMakeupDb: 3 }).join() === "comp");
  check("echoes and reverb get a tail in an export; a plain EQ does not", fxTailSec({ ...on, delayMix: 0.3, delayTimeMs: 400 }) === 3.2 && fxTailSec({ ...on, reverbMix: 0.2 }) === 2.5 && fxTailSec({ ...on, eqLow: 4 }) === 0);
  check("clampFx clamps each field to its own range", (() => { const c = clampFx({ eqLow: 99, compRatio: -5, compThresholdDb: -999, delayTimeMs: 5000, compMakeupDb: 90 }); return c.eqLow === 12 && c.compRatio === 1 && c.compThresholdDb === -60 && c.delayTimeMs === 1000 && c.compMakeupDb === 24; })());
  check("clampFx ignores junk and passes the switches through", (() => { const c = clampFx({ eqLow: NaN, fxOn: true, eqOn: false } as never); return c.eqLow === undefined && c.fxOn === true && c.eqOn === false; })());
  check("a database row becomes FX fields, and back", (() => { const row = { fx_on: true, eq_low: 3, comp_ratio: 4, comp_on: false, delay_time_ms: 250 }; const fx = fxFromRow(row); const back = fxToRow(fx); return fx.fxOn && fx.eqLow === 3 && fx.compRatio === 4 && !fx.compOn && fx.delayTimeMs === 250 && back.comp_ratio === 4 && back.fx_on === true && Object.keys(back).length === 19; })());
  check("each EQ band's frequency knob is evenly spaced by ear and round-trips", [["low", 40], ["low", 200], ["mid", 1000], ["high", 5000], ["high", 16000]].every(([b, hz]) => { const r = EQ_FREQ_RANGE[b as "low" | "mid" | "high"]; const back = posToHz(hzToPos(hz as number, r[0], r[1]), r[0], r[1]); return Math.abs(back - (hz as number)) / (hz as number) < 0.03; }));
  check("the frequency knob stays inside each band's range", posToHz(-5, 40, 800) === 40 && posToHz(500, 40, 800) === 800 && posToHz(100, 1500, 16000) === 16000);
  check("frequencies are shown as 250, 1.2k, 12k", formatHz(250) === "250" && formatHz(1200) === "1.2k" && formatHz(12000) === "12k");
  check("clampFx keeps each EQ frequency inside its band", (() => { const c = clampFx({ eqLowHz: 5, eqMidHz: 99999, eqHighHz: 10 }); return c.eqLowHz === 40 && c.eqMidHz === 8000 && c.eqHighHz === 1500; })());
  const flat = { eqLow: 0, eqMid: 0, eqHigh: 0, eqLowHz: 200, eqMidHz: 1000, eqHighHz: 5000 };
  check("a flat EQ draws a flat line", eqResponseDb(flat, [30, 200, 1000, 8000, 18000]).every((d) => Math.abs(d) < 0.01));
  check("the mid band peaks by its gain at its own frequency", Math.abs(eqResponseDb({ ...flat, eqMid: 9, eqMidHz: 2500 }, [2500])[0] - 9) < 0.05);
  check("moving the mid frequency moves the peak", (() => { const f = Array.from({ length: 200 }, (_, i) => 20 * Math.pow(1000, i / 199)); const peak = (hz: number) => { const db = eqResponseDb({ ...flat, eqMid: 9, eqMidHz: hz }, f); return f[db.indexOf(Math.max(...db))]; }; return Math.abs(peak(500) / 500 - 1) < 0.06 && Math.abs(peak(4000) / 4000 - 1) < 0.06; })());
  check("the low shelf lifts everything below its corner and leaves the top alone", (() => { const r = eqResponseDb({ ...flat, eqLow: 9, eqLowHz: 80 }, [20, 10000]); return Math.abs(r[0] - 9) < 0.5 && Math.abs(r[1]) < 0.1; })());
  check("the high shelf lifts everything above its corner and leaves the bottom alone", (() => { const r = eqResponseDb({ ...flat, eqHigh: -9, eqHighHz: 6000 }, [20, 18000]); return Math.abs(r[0]) < 0.1 && Math.abs(r[1] + 9) < 1; })());
  check("a row missing the new columns falls back to the defaults (FX off)", (() => { const fx = fxFromRow({ eq_low: 2 }); return fx.fxOn === false && fx.eqLow === 2 && fx.compAttackMs === 10; })());
  check("a live update only changes what it carries", fxFromRow({ reverb_mix: 0.4 }, { ...on, eqLow: 5 }).eqLow === 5);
  check("every preset sits inside the allowed ranges", FX_PRESETS.every((p) => { const patch = presetPatch(p.id)!; const c = clampFx(patch); return Object.keys(c).every((k) => (c as Record<string, unknown>)[k] === (patch as Record<string, unknown>)[k]); }));
  check("choosing a preset switches the effects on", FX_PRESETS.every((p) => presetPatch(p.id)!.fxOn === true));
  check("the Flat preset changes nothing audible", isNeutralFx({ ...DEFAULT_CHANNEL_FX, ...presetPatch("flat")! }));
  check("Reset makes everything neutral but keeps the switches", (() => { const cur = { ...on, eqLow: 6, reverbMix: 0.5, delayOn: false }; const r = { ...cur, ...resetPatch(cur) }; return isNeutralFx(r) && r.fxOn && !r.delayOn; })());
  check("clampFx leaves fields that weren't passed untouched (undefined)", clampFx({ eqLow: 3 }).eqMid === undefined);
}

// ---- clip fades
{
  const fc = (over: Partial<ClipData> = {}): ClipData => ({ ...clip("f", 10, 4, 1), ...over });
  check("a fade can't be longer than the clip", setClipFade(fc(), "in", 99).fadeInSec === 4);
  check("fade in stops where the fade out begins", setClipFade(fc({ fadeOutSec: 1.5 }), "in", 99).fadeInSec === 2.5);
  check("a negative fade is none", setClipFade(fc(), "out", -3).fadeOutSec === 0);
  check("trimming a clip shorter shortens its fades to fit", (() => { const c = trimClipEnd(fc({ fadeInSec: 1, fadeOutSec: 2.5 }), 12, 100); return c.durationSec === 2 && c.fadeInSec === 1 && Math.abs(c.fadeOutSec - 1) < 1e-9; })());
  check("fades stay on the outer edges when a clip is split", (() => { const parts = splitClip(fc({ fadeInSec: 0.5, fadeOutSec: 0.7 }), 12, "g")!; return parts[0].fadeInSec === 0.5 && parts[0].fadeOutSec === 0 && parts[1].fadeInSec === 0 && parts[1].fadeOutSec === 0.7; })());
  check("a duplicate keeps its fades", duplicateClip(fc({ fadeInSec: 0.5 }), "d", 2).fadeInSec === 0.5);
  check("fadeGain: silent at the start, full after the fade in", fadeGain(10, 14, 1, 0, 10) === 0 && fadeGain(10, 14, 1, 0, 10.5) === 0.5 && fadeGain(10, 14, 1, 0, 11) === 1);
  check("fadeGain: full until the fade out, silent at the end", fadeGain(10, 14, 0, 2, 12) === 1 && fadeGain(10, 14, 0, 2, 13) === 0.5 && fadeGain(10, 14, 0, 2, 14) === 0);
  check("fadeGain: both fades together never exceed either", fadeGain(10, 14, 2, 2, 12) === 1 && fadeGain(10, 14, 2, 2, 11) === 0.5);
  check("fitFades leaves good fades alone", (() => { const c = fc({ fadeInSec: 1, fadeOutSec: 1 }); return fitFades(c) === c; })());
  const piece = (over = {}) => ({ clipStartSec: 10, clipEndSec: 14, fadeInSec: 1, fadeOutSec: 1, ...over });
  const pts = envelopePoints(piece(), 10, 14, 0.002);
  check("an envelope starts and ends at silence and has the fade corners in between", pts[0].g === 0 && pts[pts.length - 1].g === 0 && pts.some((p) => p.t === 11 && p.g === 1) && pts.some((p) => p.t === 13 && p.g === 1));
  check("an envelope starting part-way through the fade starts at that height", (() => { const p = envelopePoints(piece(), 10.5, 14, 0.002); return Math.abs(p[1].g - 0.5) < 0.01; })());
  check("a piece with no fades is just the little click-guard at each end", (() => { const p = envelopePoints(piece({ fadeInSec: 0, fadeOutSec: 0 }), 10, 14, 0.002); return p.length === 4 && p[1].g === 1 && p[2].g === 1; })());
  check("pieces of the audible mix carry their clip's fades", (() => { const s = audibleSegments([fc({ fadeInSec: 1 })]); return s.length === 1 && s[0].fadeInSec === 1 && s[0].clipStartSec === 10 && s[0].clipEndSec === 14; })());
  check("a cut clip with its two outer fades plays as one piece with both", (() => { const parts = splitClip(fc({ fadeInSec: 0.5, fadeOutSec: 0.7 }), 12, "g")!; const s = audibleSegments(parts); return s.length === 1 && s[0].fadeInSec === 0.5 && s[0].fadeOutSec === 0.7 && s[0].clipEndSec === 14; })());
  check("a fade at the cut itself keeps the two halves apart", (() => { const [a, b] = splitClip(fc(), 12, "g")!; return audibleSegments([setClipFade(a, "out", 0.5), b]).length === 2; })());
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
  const hzOf = (sr: number, hz: number, amps = [0.4, 0.15, 0.08]) => Float32Array.from({ length: 8192 }, (_, i) => amps.reduce((sum, a, k) => sum + a * Math.sin((2 * Math.PI * hz * (k + 1) * i) / sr), 0));
  const centsErr = (got: number | null, want: number) => (got === null ? 999 : Math.abs(1200 * Math.log2(got / want)));
  for (const sr of [44100, 48000]) {
    for (const hz of [30.87, 41.2, 55, 82.41, 110, 196, 329.63, 440, 1000]) {
      check(`tuner reads ${hz} Hz within 1 cent at ${sr / 1000} kHz`, centsErr(detectPitch(hzOf(sr, hz), sr), hz) < 1);
    }
  }
  check("a bass note whose fundamental is weak (strong 2nd harmonic) is still read as the fundamental", centsErr(detectPitch(hzOf(44100, 41.2, [0.25, 0.8, 0.5]), 44100), 41.2) < 1.5);
  const a4 = noteFromHz(detectPitch(hzOf(44100, 440), 44100) ?? 0);
  check("tuner reads 440 Hz as A4, in tune", a4.name === "A" && a4.octave === 4 && Math.abs(a4.cents) <= 1);
  check("the low B of a 5-string bass is B0", (() => { const r = noteFromHz(30.87); return r.name === "B" && r.octave === 0; })());
  const sharp = noteFromHz(440 * Math.pow(2, 20 / 1200));
  check("tuner reports 20 cents sharp", sharp.name === "A" && sharp.cents === 20);
  check("the reference pitch can be moved (A=442 makes 442 Hz in tune)", noteFromHz(442, 442).cents === 0 && noteFromHz(440, 442).cents < 0);
  check("tuner gives nothing for silence", detectPitch(new Float32Array(8192), 44100) === null);
  check("tuner gives nothing for noise", (() => { const noise = Float32Array.from({ length: 8192 }, () => (Math.random() * 2 - 1) * 0.3); return detectPitch(noise, 44100) === null; })());
  check("cents are measured from a chosen string, even far off", centsFromTarget(hzOfMidi(28) * Math.pow(2, 120 / 1200), 28) === 120);
  check("every instrument lists its strings low to high", INSTRUMENTS.filter((i) => i.id === "guitar" || i.id.startsWith("bass")).every((i) => i.strings.every((st, k) => k === 0 || st.midi > i.strings[k - 1].midi)));
  check("the strobe drifts right for sharp, left for flat, and stands still in tune", strobeSpeed(10, 1) > 0 && strobeSpeed(-10, 1) < 0 && strobeSpeed(0, 4) === 0);
  check("the strobe's speed is capped so it never flickers", Math.abs(strobeSpeed(50, 8)) <= 6);
}

// ---- help content
{
  check("every help question has a unique id", new Set(HELP_TOPICS.map((t) => t.id)).size === HELP_TOPICS.length);
  check("every help question belongs to a known group, and every group has questions", HELP_TOPICS.every((t) => (HELP_GROUPS as readonly string[]).includes(t.group)) && HELP_GROUPS.every((g) => HELP_TOPICS.some((t) => t.group === g)));
  check("every help answer says something", HELP_TOPICS.every((t) => t.question.trim().length > 5 && t.answer.length > 0 && t.answer.every((p) => p.trim().length > 20)));
  check("the topics the '?' buttons point to exist (fx, tuner, notes)", ["fx", "tuner", "notes"].every((id) => !!helpTopic(id)));
  check("ids are safe to use in a web address", HELP_TOPICS.every((t) => /^[a-z-]+$/.test(t.id)));
}

// ---- tooltip text
{
  const j = (t: string) => JSON.stringify(parseTip(t));
  check("'Play (Space)' becomes a name and a key", j("Play (Space)") === '{"name":"Play","hint":null,"key":"Space"}');
  check("a single letter in brackets is a key", parseTip("Record on Guitar (R)").key === "R" && parseTip("Record on Guitar (R)").name === "Record on Guitar");
  check("'Name — hint' splits into a name and a hint", j("Effects are off — EQ, Compressor, Delay and Reverb") === '{"name":"Effects are off","hint":"EQ, Compressor, Delay and Reverb","key":null}');
  check("'Name: hint' splits when the name is short", parseTip("Loop: repeat a highlighted part").name === "Loop" && parseTip("Loop: repeat a highlighted part").hint === "repeat a highlighted part");
  check("a long explanation in brackets is not a key", parseTip("Solo (only you hear this — never saved)").key === null);
  check("a plain hint stays one line", j("Back to start") === '{"name":"Back to start","hint":null,"key":null}');
  check("a shortcut with a modifier is a key", parseTip("Undo (⌘/Ctrl+Z)").key === "⌘/Ctrl+Z");
}

process.exit(fail ? 1 : 0);
