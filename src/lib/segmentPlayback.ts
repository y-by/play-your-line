// Schedules one audible piece of a take on the audio clock. Used by live
// playback and by the offline mixdown so both sound identical.

import { envelopePoints, type Segment } from "./clips";

/** Every piece fades in/out over this long so a cut never clicks. */
export const SEGMENT_FADE_SEC = 0.002;

/**
 * `piece` is the audible stretch being played, and `fromSec`..`toSec` the part of it that plays now (a piece
 * can be started part-way through). The clip's own fade in and fade out shape the volume across it.
 */
export function scheduleSegment(
  ctx: BaseAudioContext,
  destination: AudioNode,
  buffer: AudioBuffer,
  when: number,
  bufferOffset: number,
  duration: number,
  piece?: { seg: Segment; fromSec: number }
): AudioBufferSourceNode {
  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const envelope = ctx.createGain();
  if (piece) {
    const points = envelopePoints(piece.seg, piece.fromSec, piece.fromSec + duration, SEGMENT_FADE_SEC);
    envelope.gain.setValueAtTime(points[0].g, when);
    for (let i = 1; i < points.length; i++) envelope.gain.linearRampToValueAtTime(points[i].g, when + (points[i].t - piece.fromSec));
  } else {
    const fade = Math.min(SEGMENT_FADE_SEC, duration / 2);
    envelope.gain.setValueAtTime(0, when);
    envelope.gain.linearRampToValueAtTime(1, when + fade);
    envelope.gain.setValueAtTime(1, when + duration - fade);
    envelope.gain.linearRampToValueAtTime(0, when + duration);
  }

  source.connect(envelope);
  envelope.connect(destination);
  source.start(when, bufferOffset, duration);
  return source;
}
