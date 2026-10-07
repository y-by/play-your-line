// Quantising an audio clip: cut it at each hit or note, and move each piece toward the nearest step of the grid.
// Nothing in the recording changes: the result is just more clips (windows onto the same recording), so it can
// be undone. Pure maths: the hits are found by onsets.ts and handed in.

import type { ClipData } from "./clips";

/** Same rule as `fitFades` in clips.ts (kept here so this file needs no value imports): fades never outlast the piece. */
function limitFades(clip: ClipData): ClipData {
  const fadeIn = Math.min(Math.max(0, clip.fadeInSec), clip.durationSec);
  const fadeOut = Math.min(Math.max(0, clip.fadeOutSec), clip.durationSec - fadeIn);
  return fadeIn === clip.fadeInSec && fadeOut === clip.fadeOutSec ? clip : { ...clip, fadeInSec: fadeIn, fadeOutSec: fadeOut };
}

/** A piece starts a few milliseconds before the hit so the sharp start of the hit is not clipped. */
export const PRE_ROLL_SEC = 0.004;
/** Shortest piece worth keeping. */
const MIN_PIECE_SEC = 0.03;
/** A hit that moves by less than this is already on the grid; no cut is made for it. */
const ALREADY_ON_GRID_SEC = 0.0008;

export const QUANTISE_GRIDS: { value: number; label: string; beats: number }[] = [
  { value: 8, label: "1/8", beats: 0.5 },
  { value: 16, label: "1/16", beats: 0.25 },
  { value: 32, label: "1/32", beats: 0.125 },
];

export interface QuantiseOptions {
  /** The step of the grid, in beats (0.5 = an eighth note, 0.25 = a sixteenth, 0.125 = a thirty-second). */
  gridBeats: number;
  /** 0 = leave as played, 1 = exactly on the grid. */
  strength: number;
}

export interface QuantiseResult {
  clips: ClipData[];
  /** How many hits moved. */
  moved: number;
}

/** Where each hit would land: `{ from, to }` on the timeline, in seconds, for hits inside the clip. */
export function planMoves(clip: ClipData, onsetsTakeSec: number[], bpm: number, options: QuantiseOptions): { from: number; to: number }[] {
  const step = (60 / bpm) * options.gridBeats;
  const strength = Math.min(1, Math.max(0, options.strength));
  const takeStart = clip.sourceStartSec;
  const takeEnd = takeStart + clip.durationSec;
  return onsetsTakeSec
    .filter((t) => t > takeStart + PRE_ROLL_SEC && t < takeEnd - MIN_PIECE_SEC)
    .map((t) => {
      const from = clip.startSec + (t - takeStart);
      const snapped = Math.round(from / step) * step;
      return { from, to: from + (snapped - from) * strength };
    });
}

/**
 * The clips that replace `clip` once its hits are moved. Null when there is nothing to do (no hits found, or
 * every hit is already on the grid).
 */
export function quantiseClip(clip: ClipData, onsetsTakeSec: number[], bpm: number, options: QuantiseOptions, newId: () => string): QuantiseResult | null {
  const moves = planMoves(clip, onsetsTakeSec, bpm, options).sort((a, b) => a.from - b.from);
  if (moves.length === 0) return null;

  // Cut only where the shift changes: a hit that does not need to move is left inside its piece.
  interface Piece {
    sourceStart: number;
    delta: number;
  }
  const pieces: Piece[] = [{ sourceStart: clip.sourceStartSec, delta: 0 }];
  let moved = 0;
  for (const m of moves) {
    const delta = m.to - m.from;
    if (Math.abs(delta) > ALREADY_ON_GRID_SEC) moved++;
    const current = pieces[pieces.length - 1].delta;
    if (Math.abs(delta - current) <= ALREADY_ON_GRID_SEC) continue;
    const cutSource = m.from - clip.startSec + clip.sourceStartSec - PRE_ROLL_SEC;
    const last = pieces[pieces.length - 1];
    if (cutSource - last.sourceStart < MIN_PIECE_SEC) {
      // Too close to the last cut to be a piece of its own: the later hit takes over the shift.
      last.delta = delta;
      continue;
    }
    pieces.push({ sourceStart: cutSource, delta });
  }
  if (moved === 0) return null;

  const takeEnd = clip.sourceStartSec + clip.durationSec;
  const out: ClipData[] = [];
  pieces.forEach((piece, i) => {
    const sourceEnd = i + 1 < pieces.length ? pieces[i + 1].sourceStart : takeEnd;
    let start = clip.startSec + (piece.sourceStart - clip.sourceStartSec) + piece.delta;
    let sourceStart = piece.sourceStart;
    let length = sourceEnd - piece.sourceStart;
    if (start < 0) {
      // Can't begin before the start of the song: drop the part that would stick out.
      sourceStart -= start;
      length += start;
      start = 0;
    }
    if (length <= 0.005) return;
    // The previous piece must stop where this one starts (a hit moved earlier cuts the one before short).
    const previous = out[out.length - 1];
    if (previous && previous.startSec + previous.durationSec > start) {
      const trimmed = start - previous.startSec;
      if (trimmed < 0.005) out.pop();
      else {
        previous.durationSec = trimmed;
        previous.fadeOutSec = Math.min(0.006, trimmed / 3);
      }
    }
    out.push({
      ...clip,
      id: i === 0 ? clip.id : newId(),
      startSec: start,
      sourceStartSec: sourceStart,
      durationSec: length,
      fadeInSec: i === 0 ? clip.fadeInSec : 0,
      fadeOutSec: i + 1 === pieces.length ? clip.fadeOutSec : 0,
    });
  });
  if (out.length === 0) return null;

  // Where a gap opens up after a piece, let that piece fade out instead of stopping dead.
  for (let i = 0; i + 1 < out.length; i++) {
    const gap = out[i + 1].startSec - (out[i].startSec + out[i].durationSec);
    if (gap > 0.0005) out[i].fadeOutSec = Math.min(0.02, out[i].durationSec / 3);
  }
  return { clips: out.map(limitFades), moved };
}
