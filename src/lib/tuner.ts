// Pitch detection for the tuner (YIN): finds the note a single instrument is sounding.

const NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];

export interface TunerReading {
  name: string;
  octave: number;
  /** How far from the note, -50..50 (negative = flat). */
  cents: number;
  hz: number;
}

/** The pitch in Hz of a buffer, or null when there is no clear single note (silence, noise). */
export function detectPitch(samples: Float32Array, sampleRate: number): number | null {
  const half = Math.floor(samples.length / 2);
  let energy = 0;
  for (let i = 0; i < samples.length; i++) energy += samples[i] * samples[i];
  if (Math.sqrt(energy / samples.length) < 0.01) return null;

  const minTau = Math.max(2, Math.floor(sampleRate / 1200));
  const maxTau = Math.min(half - 1, Math.floor(sampleRate / 50));
  const diff = new Float32Array(maxTau + 1);
  for (let tau = 1; tau <= maxTau; tau++) {
    let sum = 0;
    for (let i = 0; i < half; i++) {
      const d = samples[i] - samples[i + tau];
      sum += d * d;
    }
    diff[tau] = sum;
  }
  // Cumulative mean normalised difference.
  let running = 0;
  for (let tau = 1; tau <= maxTau; tau++) {
    running += diff[tau];
    diff[tau] = running === 0 ? 1 : (diff[tau] * tau) / running;
  }
  let tau = -1;
  for (let t = minTau; t <= maxTau; t++) {
    if (diff[t] < 0.15) {
      while (t + 1 <= maxTau && diff[t + 1] < diff[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) return null;
  // Parabolic refinement around the dip.
  const a = diff[tau - 1] ?? diff[tau];
  const b = diff[tau];
  const c = diff[tau + 1] ?? diff[tau];
  const denom = a - 2 * b + c;
  const shift = denom === 0 ? 0 : (a - c) / (2 * denom);
  return sampleRate / (tau + shift);
}

/** The nearest note to a frequency (A4 = 440 Hz) and how many cents off it is. */
export function noteFromHz(hz: number): TunerReading {
  const midi = 69 + 12 * Math.log2(hz / 440);
  const nearest = Math.round(midi);
  return {
    name: NAMES[((nearest % 12) + 12) % 12],
    octave: Math.floor(nearest / 12) - 1,
    cents: Math.round((midi - nearest) * 100),
    hz,
  };
}
