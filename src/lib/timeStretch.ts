// Changing the speed of a recording without changing its pitch (WSOLA: waveform-similarity overlap-add). Pure maths on
// samples, so it is tested with made-up sounds. Used when a dropped loop is fitted to the project's tempo.
//
// Short frames of the sound are laid down at a different spacing than they were taken from, each one nudged a little so
// its waves line up with the one before; that keeps pitch and avoids the wobble of cruder methods.

/**
 * @param channels the sound, one array per channel
 * @param ratio    new length / old length: 1.25 makes it a quarter longer (slower), 0.8 a fifth shorter (faster)
 */
export function timeStretch(channels: Float32Array[], sampleRate: number, ratio: number): Float32Array[] {
  const inLen = channels[0]?.length ?? 0;
  const outLen = Math.max(1, Math.round(inLen * ratio));
  if (inLen === 0 || Math.abs(ratio - 1) < 1e-6) return channels.map((c) => c.slice());

  const frame = Math.max(512, 2 * Math.round((sampleRate * 0.046) / 2)); // about 46 ms (even)
  const half = frame / 2;
  const hopOut = half;
  const hopIn = hopOut / ratio;
  const tolerance = Math.round(frame / 4);
  const window = new Float32Array(frame);
  for (let i = 0; i < frame; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / frame); // sums to 1 at half overlap

  // The waves are lined up on a mono mix; every channel then gets the same placement, so stereo is not smeared.
  const mono = new Float32Array(inLen);
  for (const c of channels) for (let i = 0; i < inLen; i++) mono[i] += c[i] / channels.length;

  const out = channels.map(() => new Float32Array(outLen + frame));
  const frames = Math.ceil(outLen / hopOut) + 1;
  let previous = 0; // where in the input the last frame was taken from
  const step = 4; // compare every 4th sample: plenty to find the best alignment, and 4x faster
  for (let k = 0; k < frames; k++) {
    const target = Math.round(k * hopIn);
    let pos = target;
    if (k > 0) {
      // The sound that would naturally follow the last frame: the best new frame is the one most like it.
      const natural = previous + hopOut;
      let bestScore = -Infinity;
      for (let offset = -tolerance; offset <= tolerance; offset += 2) {
        const candidate = target + offset;
        if (candidate < 0 || candidate + frame > inLen + half) continue;
        let score = 0;
        for (let i = 0; i < half; i += step) {
          const a = natural + i < inLen ? mono[natural + i] : 0;
          const b = candidate + i < inLen ? mono[candidate + i] : 0;
          score += a * b;
        }
        if (score > bestScore) {
          bestScore = score;
          pos = candidate;
        }
      }
    }
    previous = pos;
    const start = k * hopOut;
    for (let ch = 0; ch < channels.length; ch++) {
      const src = channels[ch];
      const dst = out[ch];
      for (let i = 0; i < frame; i++) {
        const s = pos + i;
        if (s >= 0 && s < inLen && start + i < dst.length) dst[start + i] += src[s] * window[i];
      }
    }
  }
  return out.map((c) => c.slice(0, outLen));
}
