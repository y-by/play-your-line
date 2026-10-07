// Finding where each hit or note starts in a recording (drum hits, plucked or picked bass notes). Pure maths on
// the samples, so it can be tested with made-up sounds. Used by the quantiser.

const WINDOW = 1024; // about 23 ms at 44.1 kHz: longer than one wave of a low bass note, so its level does not wobble
const HOP = 128; // about 3 ms
const LOOKBACK = 4; // frames: compares the energy now with about 12 ms ago
const LONG_LOOKBACK = 10; // ...and with about 30 ms ago, which catches a soft note starting over the ring of the last one

export interface OnsetOptions {
  /** 0 = only the clear hits, 1 = also the soft ones. Default 0.5. */
  sensitivity?: number;
  /** Two hits closer than this are one (a hit's ring is not another hit). */
  minGapSec?: number;
}

/** How much louder (in natural-log RMS units; 0.69 = twice as loud) a frame must get to count as a hit. */
export function riseThreshold(sensitivity: number): number {
  const s = Math.min(1, Math.max(0, sensitivity));
  return 1.2 - s * 0.85;
}

function frames(samples: Float32Array, from: number, to: number): { full: Float32Array; high: Float32Array } {
  const n = Math.max(0, Math.floor((to - from - WINDOW) / HOP) + 1);
  const full = new Float32Array(n);
  const high = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    const start = from + f * HOP;
    let a = 0;
    let h = 0;
    for (let i = start; i < start + WINDOW; i++) {
      const x = samples[i];
      const d = x - samples[i - 1 >= 0 ? i - 1 : 0];
      a += x * x;
      h += d * d;
    }
    full[f] = Math.sqrt(a / WINDOW);
    high[f] = Math.sqrt(h / WINDOW);
  }
  return { full, high };
}

/**
 * The times (in seconds, from the start of the recording) at which hits or notes begin, within
 * `startSec`..`startSec + durationSec` of it. Sorted, at least `minGapSec` apart.
 */
export function detectOnsets(samples: Float32Array, sampleRate: number, startSec: number, durationSec: number, options: OnsetOptions = {}): number[] {
  const from = Math.max(0, Math.floor(startSec * sampleRate));
  const to = Math.min(samples.length, Math.floor((startSec + durationSec) * sampleRate));
  if (to - from < WINDOW * 2) return [];
  const { full, high } = frames(samples, from, to);
  const n = full.length;
  let peak = 0;
  for (let f = 0; f < n; f++) peak = Math.max(peak, full[f]);
  if (peak < 0.003) return [];

  const floor = peak * 0.002; // keeps the log from exploding in silence
  const minRise = riseThreshold(options.sensitivity ?? 0.5);
  const gate = peak * 0.03; // a hit has to be at least this loud (about -30 dB from the loudest part)

  // Onset strength: how much louder the sound just got, in the whole sound or in its sharp (high) part.
  const strength = new Float32Array(n);
  for (let f = LOOKBACK; f < n; f++) {
    const slow = f >= LONG_LOOKBACK ? 0.9 * Math.log((full[f] + floor) / (full[f - LONG_LOOKBACK] + floor)) : 0;
    const rise = Math.max(slow, Math.log((full[f] + floor) / (full[f - LOOKBACK] + floor)));
    const riseHigh = Math.log((high[f] + floor * 0.5) / (high[f - LOOKBACK] + floor * 0.5));
    strength[f] = Math.max(0, rise, riseHigh * 0.8);
  }

  const minGapFrames = Math.max(1, Math.round(((options.minGapSec ?? 0.045) * sampleRate) / HOP));
  const picks: number[] = [];
  for (let f = LOOKBACK; f < n; f++) {
    if (strength[f] < minRise || full[f] < gate) continue;
    // a local peak of the strength (the first frame of a plateau wins)
    let isPeak = true;
    for (let k = Math.max(LOOKBACK, f - 2); k <= Math.min(n - 1, f + 2); k++) {
      if (k !== f && (strength[k] > strength[f] || (strength[k] === strength[f] && k < f))) {
        isPeak = false;
        break;
      }
    }
    if (!isPeak) continue;
    const last = picks[picks.length - 1];
    if (last !== undefined && f - last < minGapFrames) {
      if (strength[f] > strength[last]) picks[picks.length - 1] = f;
      continue;
    }
    picks.push(f);
  }

  // Put each pick on the actual start of the sound: where the sound first climbs a third of the way from the
  // level just before it (the ring of the last hit) up to its own loudness.
  const result: number[] = [];
  const smooth = 48;
  for (const f of picks) {
    const lo = from + Math.max(0, f - LOOKBACK - 2) * HOP;
    const hi = Math.min(to - 1, from + f * HOP + WINDOW);
    const reach = Math.min(to - 1, hi + Math.round(0.02 * sampleRate));
    // Two views of the start of the sound: its overall level, and its sharp part (the pick or the stick).
    // The sharp part is the more exact of the two (it ignores the slow ring of the last note), so it is used
    // unless the overall level stands out from what came before clearly better.
    const view = (sharp: boolean) => {
      const level: number[] = [];
      let acc = 0;
      const value = (i: number) => (sharp ? Math.abs(samples[i] - samples[Math.max(0, i - 1)]) : Math.abs(samples[i]));
      for (let i = lo; i <= reach; i++) {
        acc += value(i);
        if (i - lo >= smooth) acc -= value(i - smooth);
        level.push(acc / Math.min(i - lo + 1, smooth));
      }
      let base = Infinity;
      let top = 0;
      for (let k = 0; k < level.length; k++) {
        if (lo + k <= hi) base = Math.min(base, level[k]);
        top = Math.max(top, level[k]);
      }
      return { level, base, top, contrast: top > 0 ? (top - base) / top : 0 };
    };
    const whole = view(false);
    const sharp = view(true);
    const chosen = sharp.contrast >= whole.contrast - 0.05 ? sharp : whole;
    const target = chosen.base + 0.33 * (chosen.top - chosen.base);
    let onset = hi;
    for (let k = 0; k < chosen.level.length; k++) {
      if (chosen.level[k] >= target) {
        onset = lo + k - smooth / 2;
        break;
      }
    }
    result.push(Math.max(0, onset) / sampleRate);
  }
  return result.filter((t, i) => i === 0 || t - result[i - 1] >= (options.minGapSec ?? 0.045) * 0.5);
}
