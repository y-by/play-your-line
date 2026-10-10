// Joining several clips of one channel into a single clip. Pure maths except `renderClipsToBuffer`, which needs an audio context.
//
// Two cases:
//  1. The clips are pieces of ONE recording that sit next to each other and continue each other (a clip that was split
//     and not moved): joining just makes it one clip again. Nothing is rendered and nothing is stored.
//  2. Otherwise (after a quantise cut moved the pieces, or the clips come from different recordings): what is heard of
//     the selected clips, with their fades and the newest-on-top overlap rule, is rendered into one new recording that
//     replaces them, with its gaps as silence.

import { audibleSegments, clipEnd, type ClipData } from "./clips.ts";

const EPS = 0.001;

/** One clip that replaces `clips` when they are consecutive pieces of the same recording, or null when they are not. */
export function mergeContiguous(clips: ClipData[]): ClipData | null {
  if (clips.length < 2) return null;
  const sorted = [...clips].sort((a, b) => a.startSec - b.startSec);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const next = sorted[i];
    if (next.takeId !== prev.takeId) return null;
    if (Math.abs(next.startSec - clipEnd(prev)) > EPS) return null; // a gap or an overlap on the timeline
    if (Math.abs(next.sourceStartSec - (prev.sourceStartSec + prev.durationSec)) > EPS) return null; // not the next bit of the recording
    if (prev.fadeOutSec > 0 || next.fadeInSec > 0) return null; // a fade in the middle would be lost
  }
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  return {
    ...first,
    durationSec: clipEnd(last) - first.startSec,
    z: Math.max(...sorted.map((c) => c.z)),
    fadeInSec: first.fadeInSec,
    fadeOutSec: last.fadeOutSec,
  };
}

/** From where to where on the song timeline the selected clips are heard. */
export function joinRange(clips: ClipData[]): { startSec: number; endSec: number } {
  const segments = audibleSegments(clips);
  if (segments.length === 0) return { startSec: Math.min(...clips.map((c) => c.startSec)), endSec: Math.max(...clips.map(clipEnd)) };
  return { startSec: Math.min(...segments.map((s) => s.startSec)), endSec: Math.max(...segments.map((s) => s.endSec)) };
}
