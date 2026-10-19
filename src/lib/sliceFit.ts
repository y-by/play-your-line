// Fitting a drum loop (or any recording made of separate hits) to another tempo WITHOUT stretching the sound: it is cut
// at each hit, and every piece is put where that hit belongs at the new tempo, at its own original speed. The hits keep
// their exact sound (a stretch smears them). When the tempo gets faster a piece is cut short where the next hit comes in;
// when it gets slower there is a small silence after each ring. Pure maths on the samples, so it is testable.

import { PRE_ROLL_SEC } from "./quantise.ts";

const END_FADE_SEC = 0.008;
const START_FADE_SEC = 0.0015;

/**
 * @param ratio the new length divided by the old (the loop's tempo / the song's tempo): below 1 is faster
 * @param onsetsSec where each hit starts, in seconds from the start of the file (from detectOnsets)
 */
export function sliceFit(channels: Float32Array[], sampleRate: number, ratio: number, onsetsSec: number[]): Float32Array[] {
  const length = channels[0]?.length ?? 0;
  const outLength = Math.max(1, Math.round(length * ratio));
  const out = channels.map(() => new Float32Array(outLength));
  // Cut points: the start of the file, then a few milliseconds before each hit (so its attack is whole).
  const cuts = [0];
  for (const t of [...onsetsSec].sort((a, b) => a - b)) {
    const at = Math.round((t - PRE_ROLL_SEC) * sampleRate);
    if (at > cuts[cuts.length - 1] + Math.round(0.02 * sampleRate) && at < length - Math.round(0.02 * sampleRate)) cuts.push(at);
  }
  cuts.push(length);
  const endFade = Math.max(1, Math.round(END_FADE_SEC * sampleRate));
  const startFade = Math.max(1, Math.round(START_FADE_SEC * sampleRate));
  for (let i = 0; i < cuts.length - 1; i++) {
    const from = cuts[i];
    const to = cuts[i + 1];
    const place = Math.round(from * ratio);
    const nextPlace = i + 2 < cuts.length ? Math.round(to * ratio) : outLength;
    // The piece plays at its own speed until it ends, or until the next hit comes in (if that is sooner).
    const usable = Math.min(to - from, Math.max(0, nextPlace - place), outLength - place);
    const cutShort = usable < to - from;
    const isLast = i === cuts.length - 2;
    for (let c = 0; c < channels.length; c++) {
      for (let k = 0; k < usable; k++) {
        let g = 1;
        if (i > 0 && k < startFade) g = k / startFade;
        if ((cutShort || !isLast) && k >= usable - endFade) g = Math.min(g, (usable - k) / endFade);
        out[c][place + k] += channels[c][from + k] * g;
      }
    }
  }
  return out;
}
