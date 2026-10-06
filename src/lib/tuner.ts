// The tuner's maths (pure, no audio context): pitch detection (YIN), note names and cents, instrument strings.
// Range 25 Hz to about 1.3 kHz, so a 5-string bass (low B is 30.9 Hz) works as well as a guitar.

const NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];

export const MIN_HZ = 25;
export const MAX_HZ = 1300;
const COARSE = 4; // the first, rough pass runs on a quarter of the samples (cheap, and it can see the lowest notes)

export interface TunerReading {
  name: string;
  octave: number;
  midi: number;
  /** How far from the note, in cents (negative = flat). */
  cents: number;
  hz: number;
}

function diffAt(x: Float32Array, tau: number, width: number): number {
  let sum = 0;
  for (let i = 0; i < width; i++) {
    const d = x[i] - x[i + tau];
    sum += d * d;
  }
  return sum;
}

/** The first, rough pitch (as a period in samples of `x`), by YIN's normalised difference. -1 if nothing clear. */
function coarsePeriod(x: Float32Array, sampleRate: number): number {
  const half = Math.floor(x.length / 2);
  const minTau = Math.max(2, Math.floor(sampleRate / MAX_HZ));
  const maxTau = Math.min(half - 1, Math.floor(sampleRate / MIN_HZ));
  const diff = new Float32Array(maxTau + 2);
  for (let tau = 1; tau <= maxTau; tau++) diff[tau] = diffAt(x, tau, half);
  let running = 0;
  for (let tau = 1; tau <= maxTau; tau++) {
    running += diff[tau];
    diff[tau] = running === 0 ? 1 : (diff[tau] * tau) / running;
  }
  for (let t = minTau; t <= maxTau; t++) {
    if (diff[t] < 0.15) {
      while (t + 1 <= maxTau && diff[t + 1] < diff[t]) t++;
      return t;
    }
  }
  return -1;
}

/** The pitch in Hz of a buffer (about 8192 samples is plenty), or null when there is no clear single note. */
export function detectPitch(samples: Float32Array, sampleRate: number): number | null {
  let energy = 0;
  for (let i = 0; i < samples.length; i++) energy += samples[i] * samples[i];
  if (Math.sqrt(energy / samples.length) < 0.005) return null;

  // Rough pass on a thinned-out copy.
  const n = Math.floor(samples.length / COARSE);
  const small = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k < COARSE; k++) s += samples[i * COARSE + k];
    small[i] = s / COARSE;
  }
  const rough = coarsePeriod(small, sampleRate / COARSE);
  if (rough < 0) return null;

  // Fine pass on the real samples, only near the rough answer.
  const center = rough * COARSE;
  const lo = Math.max(2, Math.floor(center * 0.96));
  const hi = Math.min(Math.floor(samples.length / 2) - 2, Math.ceil(center * 1.04));
  const width = samples.length - hi - 1;
  if (width < hi) return null;
  let best = lo;
  let bestVal = Infinity;
  const vals = new Map<number, number>();
  for (let tau = lo - 1; tau <= hi + 1; tau++) {
    const v = diffAt(samples, tau, width);
    vals.set(tau, v);
    if (tau >= lo && tau <= hi && v < bestVal) {
      bestVal = v;
      best = tau;
    }
  }
  const a = vals.get(best - 1) ?? bestVal;
  const c = vals.get(best + 1) ?? bestVal;
  const denom = a - 2 * bestVal + c;
  const shift = denom === 0 ? 0 : (a - c) / (2 * denom);
  const hz = sampleRate / (best + Math.max(-0.5, Math.min(0.5, shift)));
  return hz >= MIN_HZ && hz <= MAX_HZ ? hz : null;
}

/** The note number (69 = A4) a frequency sits at, as a fraction. */
export function midiOfHz(hz: number, refA = 440): number {
  return 69 + 12 * Math.log2(hz / refA);
}

export function hzOfMidi(midi: number, refA = 440): number {
  return refA * Math.pow(2, (midi - 69) / 12);
}

export function noteName(midi: number): { name: string; octave: number } {
  return { name: NAMES[((midi % 12) + 12) % 12], octave: Math.floor(midi / 12) - 1 };
}

/** The nearest note to a frequency (A4 = `refA`) and how many cents off it is. */
export function noteFromHz(hz: number, refA = 440): TunerReading {
  const exact = midiOfHz(hz, refA);
  const midi = Math.round(exact);
  return { ...noteName(midi), midi, cents: Math.round((exact - midi) * 100), hz };
}

/** How far `hz` is from a chosen note, in cents (not limited to half a semitone, so "way flat" reads as such). */
export function centsFromTarget(hz: number, targetMidi: number, refA = 440): number {
  return Math.round(1200 * Math.log2(hz / hzOfMidi(targetMidi, refA)));
}

export interface TunerString {
  label: string;
  midi: number;
}

const s = (label: string, midi: number): TunerString => ({ label, midi });

/** Open strings, low to high. */
export const INSTRUMENTS: { id: string; name: string; strings: TunerString[] }[] = [
  { id: "chromatic", name: "Any note", strings: [] },
  { id: "guitar", name: "Guitar", strings: [s("E", 40), s("A", 45), s("D", 50), s("G", 55), s("B", 59), s("E", 64)] },
  { id: "bass4", name: "Bass (4)", strings: [s("E", 28), s("A", 33), s("D", 38), s("G", 43)] },
  { id: "bass5", name: "Bass (5)", strings: [s("B", 23), s("E", 28), s("A", 33), s("D", 38), s("G", 43)] },
  { id: "ukulele", name: "Ukulele", strings: [s("G", 67), s("C", 60), s("E", 64), s("A", 69)] },
];

/** How fast a strobe band should drift, in stripe-cycles per second, for a pitch error in cents (band 0 = the base). */
export function strobeSpeed(cents: number, multiplier: number): number {
  return Math.max(-6, Math.min(6, cents * 0.12 * multiplier));
}
