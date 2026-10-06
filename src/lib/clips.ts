// Clip model and editing rules. Pure functions — no Web Audio, no database —
// so the behaviour can be tested with plain numbers.
//
// A recording ("take") is raw audio and is never modified. A clip is a
// window onto a take, placed on the song timeline:
//
//   startSec        where the clip begins on the song timeline
//   sourceStartSec  where in the take the clip begins playing
//   durationSec     how long the clip plays
//   z               stacking order; the newest clip has the highest z
//   fadeInSec       how long the clip takes to rise from silence at its start (0 = no fade)
//   fadeOutSec      how long it takes to fall to silence at its end
//
// Every edit (move, trim, split, duplicate) only changes these numbers.

export interface ClipData {
  id: string;
  takeId: string;
  startSec: number;
  sourceStartSec: number;
  durationSec: number;
  z: number;
  fadeInSec: number;
  fadeOutSec: number;
}

/** A stretch of a clip that is actually heard (not covered by a clip above it). */
export interface Segment {
  clipId: string;
  takeId: string;
  startSec: number;
  endSec: number;
  /** Position inside the take where this segment starts playing. */
  sourceStartSec: number;
  /** The clip this piece belongs to, with its fades: the fade curve follows the whole clip, not the piece. */
  clipStartSec: number;
  clipEndSec: number;
  fadeInSec: number;
  fadeOutSec: number;
}

/** Shortest a clip may be trimmed to. */
export const MIN_CLIP_SEC = 0.02;

export function clipEnd(clip: ClipData): number {
  return clip.startSec + clip.durationSec;
}

export function nextZ(clips: ClipData[]): number {
  return clips.reduce((max, c) => Math.max(max, c.z), 0) + 1;
}

type Interval = [number, number];

function addInterval(list: Interval[], [start, end]: Interval): Interval[] {
  const merged: Interval[] = [];
  let placed = false;
  let cur: Interval = [start, end];
  for (const iv of list) {
    if (iv[1] < cur[0]) {
      merged.push(iv);
    } else if (iv[0] > cur[1]) {
      if (!placed) {
        merged.push(cur);
        placed = true;
      }
      merged.push(iv);
    } else {
      cur = [Math.min(cur[0], iv[0]), Math.max(cur[1], iv[1])];
    }
  }
  if (!placed) merged.push(cur);
  return merged;
}

/**
 * The overlap rule: where clips overlap, the newest (highest z) plays and the
 * older one is silent underneath — but keeps playing wherever nothing covers
 * it. Returns the pieces that are actually heard, in timeline order.
 */
export function audibleSegments(clips: ClipData[]): Segment[] {
  const topFirst = [...clips].sort((a, b) => b.z - a.z || (a.id < b.id ? -1 : 1));
  let covered: Interval[] = [];
  const segments: Segment[] = [];

  for (const clip of topFirst) {
    const start = clip.startSec;
    const end = clipEnd(clip);
    let cursor = start;

    const push = (from: number, to: number) => {
      if (to - from < 0.001) return;
      segments.push({
        clipId: clip.id,
        takeId: clip.takeId,
        startSec: from,
        endSec: to,
        sourceStartSec: clip.sourceStartSec + (from - clip.startSec),
        clipStartSec: clip.startSec,
        clipEndSec: end,
        fadeInSec: clip.fadeInSec,
        fadeOutSec: clip.fadeOutSec,
      });
    };

    for (const [coveredStart, coveredEnd] of covered) {
      if (coveredEnd <= cursor) continue;
      if (coveredStart >= end) break;
      if (coveredStart > cursor) push(cursor, Math.min(coveredStart, end));
      cursor = Math.max(cursor, coveredEnd);
      if (cursor >= end) break;
    }
    if (cursor < end) push(cursor, end);

    covered = addInterval(covered, [start, end]);
  }

  return mergeContinuous(segments.sort((a, b) => a.startSec - b.startSec));
}

/**
 * Two neighbouring pieces that read one take without a gap or a jump (e.g. the
 * two halves of a clip that was cut in two) are really one continuous sound.
 * Playing them as one avoids a needless fade at the cut.
 */
function mergeContinuous(sorted: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const seg of sorted) {
    const last = out[out.length - 1];
    if (
      last &&
      last.takeId === seg.takeId &&
      Math.abs(last.endSec - seg.startSec) < 1e-6 &&
      Math.abs(last.sourceStartSec + (last.endSec - last.startSec) - seg.sourceStartSec) < 1e-6 &&
      // A fade at the cut itself means the two halves are not one smooth sound any more.
      last.fadeOutSec === 0 &&
      seg.fadeInSec === 0
    ) {
      // One sound again: it carries the first half's fade in and the second half's fade out.
      out[out.length - 1] = { ...last, endSec: seg.endSec, clipEndSec: seg.clipEndSec, fadeOutSec: seg.fadeOutSec };
    } else {
      out.push({ ...seg });
    }
  }
  return out;
}

/** Move a clip so it starts at `newStartSec` (never before the start of the song). */
export function moveClip(clip: ClipData, newStartSec: number): ClipData {
  return { ...clip, startSec: Math.max(0, newStartSec) };
}

/** Drag the left edge: the clip shrinks (or grows back into the take) from the left. */
export function trimClipStart(clip: ClipData, newStartSec: number): ClipData {
  const earliest = Math.max(0, clip.startSec - clip.sourceStartSec); // can't reveal audio before the take begins
  const latest = clipEnd(clip) - MIN_CLIP_SEC;
  const start = Math.min(latest, Math.max(earliest, newStartSec));
  const delta = start - clip.startSec;
  return fitFades({ ...clip, startSec: start, sourceStartSec: clip.sourceStartSec + delta, durationSec: clip.durationSec - delta });
}

/** Drag the right edge: the clip shrinks (or grows back into the take) from the right. */
export function trimClipEnd(clip: ClipData, newEndSec: number, takeDurationSec: number): ClipData {
  const latest = clip.startSec + Math.max(MIN_CLIP_SEC, takeDurationSec - clip.sourceStartSec);
  const end = Math.min(latest, Math.max(clip.startSec + MIN_CLIP_SEC, newEndSec));
  return fitFades({ ...clip, durationSec: end - clip.startSec });
}

/** Cut a clip in two at `atSec`. Both halves keep the same z. Null if the cut is too close to an edge. */
export function splitClip(clip: ClipData, atSec: number, newId: string): [ClipData, ClipData] | null {
  if (atSec <= clip.startSec + MIN_CLIP_SEC || atSec >= clipEnd(clip) - MIN_CLIP_SEC) return null;
  const leftDuration = atSec - clip.startSec;
  // The fades stay on the outer edges: the cut itself is left smooth.
  const left: ClipData = fitFades({ ...clip, durationSec: leftDuration, fadeOutSec: 0 });
  const right: ClipData = fitFades({
    ...clip,
    id: newId,
    startSec: atSec,
    sourceStartSec: clip.sourceStartSec + leftDuration,
    durationSec: clip.durationSec - leftDuration,
    fadeInSec: 0,
  });
  return [left, right];
}

/** A copy placed straight after the original, on top of everything else. */
export function duplicateClip(clip: ClipData, newId: string, z: number): ClipData {
  return { ...clip, id: newId, startSec: clipEnd(clip), z };
}

/** How long the song is: the end of the last clip. */
export function clipsEnd(clips: ClipData[]): number {
  return clips.reduce((max, c) => Math.max(max, clipEnd(c)), 0);
}

/** Keeps a clip's fades inside the clip: together they can never be longer than the clip itself. */
export function fitFades(clip: ClipData): ClipData {
  const fadeIn = Math.min(Math.max(0, clip.fadeInSec), clip.durationSec);
  const fadeOut = Math.min(Math.max(0, clip.fadeOutSec), clip.durationSec - fadeIn);
  return fadeIn === clip.fadeInSec && fadeOut === clip.fadeOutSec ? clip : { ...clip, fadeInSec: fadeIn, fadeOutSec: fadeOut };
}

/** Sets a fade length. The other fade is left as it is; this one stops where the other begins. */
export function setClipFade(clip: ClipData, which: "in" | "out", sec: number): ClipData {
  const other = which === "in" ? clip.fadeOutSec : clip.fadeInSec;
  const length = Math.min(Math.max(0, sec), Math.max(0, clip.durationSec - other));
  return which === "in" ? { ...clip, fadeInSec: length } : { ...clip, fadeOutSec: length };
}

/** The volume (0..1) a clip's fades give at timeline position `t`. */
export function fadeGain(clipStartSec: number, clipEndSec: number, fadeInSec: number, fadeOutSec: number, t: number): number {
  let g = 1;
  if (fadeInSec > 0 && t < clipStartSec + fadeInSec) g = Math.min(g, Math.max(0, (t - clipStartSec) / fadeInSec));
  if (fadeOutSec > 0 && t > clipEndSec - fadeOutSec) g = Math.min(g, Math.max(0, (clipEndSec - t) / fadeOutSec));
  return g;
}

/**
 * The volume curve of one audible piece, from `fromSec` to `toSec` on the timeline, as points to join with
 * straight lines: a tiny fade at each end so a cut never clicks, shaped by the clip's own fades.
 */
export function envelopePoints(seg: Pick<Segment, "clipStartSec" | "clipEndSec" | "fadeInSec" | "fadeOutSec">, fromSec: number, toSec: number, declickSec: number): { t: number; g: number }[] {
  const d = Math.min(declickSec, (toSec - fromSec) / 2);
  const times = new Set<number>([fromSec, fromSec + d, toSec - d, toSec]);
  const fadeInEnd = seg.clipStartSec + seg.fadeInSec;
  const fadeOutStart = seg.clipEndSec - seg.fadeOutSec;
  if (seg.fadeInSec > 0 && fadeInEnd > fromSec && fadeInEnd < toSec) times.add(fadeInEnd);
  if (seg.fadeOutSec > 0 && fadeOutStart > fromSec && fadeOutStart < toSec) times.add(fadeOutStart);
  return [...times]
    .sort((a, b) => a - b)
    .map((t) => {
      const declick = d <= 0 ? 1 : Math.min(1, (t - fromSec) / d, (toSec - t) / d);
      return { t, g: Math.max(0, declick) * fadeGain(seg.clipStartSec, seg.clipEndSec, seg.fadeInSec, seg.fadeOutSec, t) };
    });
}
