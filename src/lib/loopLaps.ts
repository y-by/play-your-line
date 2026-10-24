// Recording while a loop plays ("cycle recording"): the song goes round the loop again and again while the microphone keeps one
// continuous capture. When it stops, the capture is cut into laps, and each lap becomes a take of its own, placed exactly where
// that lap was heard (with the delay between playing and recording taken out). Pure, so it is tested with plain numbers.

import type { LoopRegion } from "./loop.ts";

/** What the engine knows about a recording that started inside a loop. */
export interface LoopRecording {
  loop: LoopRegion;
  /** The song position the recording started from (the playhead when Record was pressed). */
  startPos: number;
  /** The audio-clock time that position began to sound (after any count-in). */
  anchorCtx: number;
}

/** Laps shorter than this are dropped when there are several (a stop just after the loop came round again). */
export const MIN_LAP_SEC = 1;

/** The first lap runs from where recording began to the end of the loop; every later lap is the whole loop. */
export function lapStartPos(r: LoopRecording, k: number): number {
  return k === 0 ? r.startPos : r.loop.startSec;
}

/** The audio-clock time lap `k` begins to sound. */
export function lapBeginCtx(r: LoopRecording, k: number): number {
  if (k <= 0) return r.anchorCtx;
  const first = r.loop.endSec - r.startPos;
  const length = r.loop.endSec - r.loop.startSec;
  return r.anchorCtx + first + (k - 1) * length;
}

/** Which lap is sounding at an audio-clock time (the first lap before the song has begun). */
export function lapIndexAtCtx(r: LoopRecording, ctxTime: number): number {
  const first = r.loop.endSec - r.startPos;
  const length = r.loop.endSec - r.loop.startSec;
  const elapsed = ctxTime - r.anchorCtx;
  if (elapsed < first) return 0;
  return 1 + Math.floor((elapsed - first) / length + 1e-9);
}

export interface Lap {
  index: number;
  /** The slice of the capture, in samples: [fromSample, toSample). */
  fromSample: number;
  toSample: number;
  /** Where on the song timeline this lap's take starts (latency taken out). */
  offsetSec: number;
  durationSec: number;
}

/**
 * Cuts a capture into laps. `captureStartCtx` is the audio-clock time of the first captured sample; what the player played at
 * song time T is captured `latencySec` later, so lap k is the part of the capture from `lapBegin + latency` to the next lap's.
 */
export function splitLoopLaps(p: {
  rec: LoopRecording;
  captureStartCtx: number;
  latencySec: number;
  sampleRate: number;
  totalSamples: number;
  minLapSec?: number;
}): Lap[] {
  const { rec, captureStartCtx, latencySec, sampleRate, totalSamples } = p;
  if (totalSamples <= 0) return [];
  const captureEndCtx = captureStartCtx + totalSamples / sampleRate;
  const last = Math.max(0, lapIndexAtCtx(rec, captureEndCtx - latencySec));
  const laps: Lap[] = [];
  for (let k = 0; k <= last; k++) {
    const begin = lapBeginCtx(rec, k);
    const from = Math.max(0, Math.ceil((begin + latencySec - captureStartCtx) * sampleRate));
    const to = k === last ? totalSamples : Math.min(totalSamples, Math.ceil((lapBeginCtx(rec, k + 1) + latencySec - captureStartCtx) * sampleRate));
    if (to - from <= 0) continue;
    const offset = lapStartPos(rec, k) + (from / sampleRate + captureStartCtx - latencySec - begin);
    laps.push({ index: k, fromSample: from, toSample: to, offsetSec: Math.round(offset * sampleRate) / sampleRate, durationSec: (to - from) / sampleRate });
  }
  const minLap = p.minLapSec ?? MIN_LAP_SEC;
  return laps.length > 1 ? laps.filter((l) => l.durationSec >= minLap) : laps;
}
