// Waveform peaks for drawing a clip. Pure — takes raw samples, returns numbers.

/**
 * For `columns` vertical slices across the clip, the lowest and highest sample
 * value in that slice. Returned as [min0, max0, min1, max1, ...].
 */
export function computePeaks(
  samples: Float32Array,
  sampleRate: number,
  startSec: number,
  durationSec: number,
  columns: number
): Float32Array {
  const out = new Float32Array(columns * 2);
  const first = Math.max(0, Math.floor(startSec * sampleRate));
  const total = Math.max(1, Math.floor(durationSec * sampleRate));
  const perColumn = total / columns;

  for (let c = 0; c < columns; c++) {
    const from = first + Math.floor(c * perColumn);
    const to = Math.min(samples.length, first + Math.floor((c + 1) * perColumn));
    let min = 0;
    let max = 0;
    if (to > from) {
      // Very wide slices are sampled, not scanned end to end — plenty accurate for drawing.
      const stride = Math.max(1, Math.floor((to - from) / 96));
      min = samples[from];
      max = samples[from];
      for (let i = from; i < to; i += stride) {
        const v = samples[i];
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    out[c * 2] = min;
    out[c * 2 + 1] = max;
  }
  return out;
}
