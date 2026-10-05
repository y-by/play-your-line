// Our own chord detector. Pure (no imports), so it can be tested without a browser.
//
// How it works, in four steps:
//   1. Shrink the recording to about 12 kHz (chords live low) and slice it into short overlapping frames.
//   2. For each frame, find the spectral peaks and add each one's strength to its pitch class
//      (C, C#, D …) — a 12-number "chroma" fingerprint of which notes are sounding.
//   3. Average the frames inside each beat of the PROJECT's tempo grid, then score the 12 numbers against
//      chord templates (major, minor, 7, maj7, m7 on every root) with a cosine similarity.
//   4. Pick the best chord per beat with a Viterbi search that dislikes changing chord, and dislikes it
//      most in the middle of a bar — chords usually change on the bar line. Quiet beats become "no chord".
//
// It hears notes, not intent: distorted guitar, single-note lines and very sparse parts will fool it, so
// the results are always shown as suggestions.

export interface ChordSegment {
  /** Beat positions on the project timeline (4 beats to a bar). */
  startBeat: number;
  endBeat: number;
  /** For example "Am", "F", "G7"; null where nothing is playing. */
  chord: string | null;
  /** 0..1, how well the notes fit the chord (average over the segment). */
  confidence: number;
}

export interface ChordRegion {
  /** Where this audio sits on the project timeline, in seconds. */
  timelineStartSec: number;
  /** Where in the recording it starts, in seconds. */
  sourceStartSec: number;
  durationSec: number;
}

const BEATS_PER_BAR = 4;
const ROOTS = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

interface ChordType {
  suffix: string;
  /** Semitones above the root, and how much each note counts. */
  notes: [number, number][];
  /** Simpler chords are preferred when the evidence is close. */
  penalty: number;
}

const TYPES: ChordType[] = [
  { suffix: "", notes: [[0, 1], [4, 0.85], [7, 0.9]], penalty: 0 },
  { suffix: "m", notes: [[0, 1], [3, 0.85], [7, 0.9]], penalty: 0 },
  { suffix: "7", notes: [[0, 1], [4, 0.85], [7, 0.9], [10, 0.6]], penalty: 0.07 },
  { suffix: "maj7", notes: [[0, 1], [4, 0.85], [7, 0.9], [11, 0.6]], penalty: 0.07 },
  { suffix: "m7", notes: [[0, 1], [3, 0.85], [7, 0.9], [10, 0.6]], penalty: 0.07 },
];

interface Template {
  name: string;
  vector: Float64Array;
  penalty: number;
}

const TEMPLATES: Template[] = [];
for (const type of TYPES) {
  for (let root = 0; root < 12; root++) {
    const v = new Float64Array(12);
    for (const [semi, w] of type.notes) v[(root + semi) % 12] = w;
    let norm = 0;
    for (let i = 0; i < 12; i++) norm += v[i] * v[i];
    norm = Math.sqrt(norm);
    for (let i = 0; i < 12; i++) v[i] /= norm;
    TEMPLATES.push({ name: ROOTS[root] + type.suffix, vector: v, penalty: type.penalty });
  }
}

const FFT_SIZE = 4096;
const HOP = 1024;
const TARGET_RATE = 11025;
const MIN_HZ = 70;
const MAX_HZ = 1800;

/** In-place iterative radix-2 FFT. */
function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k];
        const ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

/** Average groups of samples to bring the rate down to about TARGET_RATE (a crude but sufficient low-pass). */
function shrink(samples: Float32Array, from: number, to: number, sampleRate: number): { data: Float32Array; rate: number } {
  const factor = Math.max(1, Math.floor(sampleRate / TARGET_RATE));
  const count = Math.max(0, Math.floor((to - from) / factor));
  const data = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    let sum = 0;
    for (let k = 0; k < factor; k++) sum += samples[from + i * factor + k] ?? 0;
    data[i] = sum / factor;
  }
  return { data, rate: sampleRate / factor };
}

const WINDOW = (() => {
  const w = new Float64Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1));
  return w;
})();

/** The 12-note fingerprint of one frame. */
function frameChroma(frame: Float32Array, rate: number): Float64Array {
  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) re[i] = (frame[i] ?? 0) * WINDOW[i];
  fft(re, im);
  const half = FFT_SIZE / 2;
  const mag = new Float64Array(half);
  let loudest = 0;
  for (let k = 0; k < half; k++) {
    mag[k] = Math.hypot(re[k], im[k]);
    if (mag[k] > loudest) loudest = mag[k];
  }
  const chroma = new Float64Array(12);
  if (loudest <= 0) return chroma;
  const floor = loudest * 0.04;
  for (let k = 2; k < half - 1; k++) {
    const m = mag[k];
    if (m < floor || m < mag[k - 1] || m < mag[k + 1]) continue; // only real peaks
    const denom = mag[k - 1] - 2 * m + mag[k + 1];
    const delta = denom === 0 ? 0 : (0.5 * (mag[k - 1] - mag[k + 1])) / denom;
    const hz = ((k + delta) * rate) / FFT_SIZE;
    if (hz < MIN_HZ || hz > MAX_HZ) continue;
    const semis = 12 * Math.log2(hz / 440) + 69;
    const nearest = Math.round(semis);
    const off = Math.abs(semis - nearest);
    if (off > 0.35) continue; // between two notes: probably not a note
    const band = hz < 100 ? 0.6 : hz > 1000 ? 0.7 : 1;
    const pc = ((nearest % 12) + 12) % 12;
    chroma[pc] += Math.sqrt(m / loudest) * band * (1 - off);
  }
  return chroma;
}

function cosine(a: Float64Array, b: Float64Array): number {
  let dot = 0;
  let na = 0;
  for (let i = 0; i < 12; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
  }
  return na === 0 ? 0 : dot / Math.sqrt(na);
}

/**
 * Chords of one stretch of audio, on the project's beat grid. `samples` is the whole recording (mono).
 * The returned segments are in project beats, so they line up with the ruler and with notes.
 */
export function detectChords(samples: Float32Array, sampleRate: number, bpm: number, region: ChordRegion): ChordSegment[] {
  const beatSec = 60 / bpm;
  const t0 = region.timelineStartSec;
  const t1 = t0 + region.durationSec;
  const firstBeat = Math.floor(t0 / beatSec);
  const lastBeat = Math.ceil(t1 / beatSec);

  const from = Math.max(0, Math.floor(region.sourceStartSec * sampleRate));
  const to = Math.min(samples.length, Math.floor((region.sourceStartSec + region.durationSec) * sampleRate));
  if (to - from < sampleRate * 0.2) return [];
  const { data, rate } = shrink(samples, from, to, sampleRate);

  // Timeline second of a shrunk-sample index.
  const timeOf = (i: number) => t0 + i / rate;

  // One chroma per beat. A frame counts for a beat only if it lies (almost) entirely inside it, so a chord
  // change doesn't smear into the beat before; beats too short for a whole frame fall back to the closest one.
  const frameSec = FFT_SIZE / rate;
  const frames: { start: number; centre: number; chroma: Float64Array; sumSq: number }[] = [];
  for (let start = 0; start + FFT_SIZE <= data.length; start += HOP) {
    const frame = data.subarray(start, start + FFT_SIZE);
    let sumSq = 0;
    for (let i = 0; i < frame.length; i++) sumSq += frame[i] * frame[i];
    frames.push({ start, centre: timeOf(start + FFT_SIZE / 2), chroma: frameChroma(frame, rate), sumSq });
  }
  const beats: { beat: number; chroma: Float64Array; energy: number }[] = [];
  for (let beat = firstBeat; beat < lastBeat; beat++) {
    const bs = beat * beatSec;
    const be = bs + beatSec;
    if (Math.min(be, t1) - Math.max(bs, t0) < beatSec * 0.4) continue; // a sliver at the edge of the clip
    let chosen = frames.filter((f) => f.centre - frameSec / 2 >= bs - 0.03 && f.centre + frameSec / 2 <= be + 0.03);
    if (chosen.length === 0) {
      const mid = (Math.max(bs, t0) + Math.min(be, t1)) / 2;
      let best: (typeof frames)[number] | null = null;
      for (const f of frames) if (!best || Math.abs(f.centre - mid) < Math.abs(best.centre - mid)) best = f;
      if (!best || Math.abs(best.centre - mid) > frameSec) continue;
      chosen = [best];
    }
    const chroma = new Float64Array(12);
    let sumSq = 0;
    for (const f of chosen) {
      for (let i = 0; i < 12; i++) chroma[i] += f.chroma[i];
      sumSq += f.sumSq / FFT_SIZE;
    }
    beats.push({ beat, chroma, energy: Math.sqrt(sumSq / chosen.length) });
  }
  if (beats.length === 0) return [];

  const loudest = Math.max(...beats.map((b) => b.energy));
  const silent = (e: number) => e < loudest * 0.06 || e < 1e-4;

  // Viterbi: states 0..TEMPLATES.length-1 are chords, the last is "no chord".
  const S = TEMPLATES.length + 1;
  const NONE = S - 1;
  const emission: Float64Array[] = beats.map((b) => {
    const e = new Float64Array(S);
    if (silent(b.energy)) {
      e.fill(0);
      e[NONE] = 1;
      return e;
    }
    for (let s = 0; s < TEMPLATES.length; s++) e[s] = cosine(b.chroma, TEMPLATES[s].vector) - TEMPLATES[s].penalty;
    e[NONE] = 0.3;
    return e;
  });

  const switchCost = (beat: number) => (beat % BEATS_PER_BAR === 0 ? 0.2 : 0.5);
  const T = beats.length;
  const score = new Float64Array(S);
  const back: Uint8Array[] = [];
  for (let s = 0; s < S; s++) score[s] = emission[0][s];
  back.push(new Uint8Array(S));
  for (let t = 1; t < T; t++) {
    let bestPrev = 0;
    for (let s = 1; s < S; s++) if (score[s] > score[bestPrev]) bestPrev = s;
    const lam = switchCost(beats[t].beat);
    const next = new Float64Array(S);
    const ptr = new Uint8Array(S);
    for (let s = 0; s < S; s++) {
      const stay = score[s];
      const move = score[bestPrev] - lam;
      if (stay >= move) {
        next[s] = stay + emission[t][s];
        ptr[s] = s;
      } else {
        next[s] = move + emission[t][s];
        ptr[s] = bestPrev;
      }
    }
    score.set(next);
    back.push(ptr);
  }
  let state = 0;
  for (let s = 1; s < S; s++) if (score[s] > score[state]) state = s;
  const path = new Array<number>(T);
  for (let t = T - 1; t >= 0; t--) {
    path[t] = state;
    state = back[t][state];
  }

  // Merge runs of the same chord into segments.
  const segments: ChordSegment[] = [];
  let runStart = 0;
  for (let t = 1; t <= T; t++) {
    if (t === T || path[t] !== path[runStart]) {
      const s = path[runStart];
      let conf = 0;
      for (let i = runStart; i < t; i++) conf += s === NONE ? 0 : Math.max(0, cosine(beats[i].chroma, TEMPLATES[s].vector));
      segments.push({
        startBeat: beats[runStart].beat,
        endBeat: beats[t - 1].beat + 1,
        chord: s === NONE ? null : TEMPLATES[s].name,
        confidence: s === NONE ? 0 : conf / (t - runStart),
      });
      runStart = t;
    }
  }
  return segments;
}
