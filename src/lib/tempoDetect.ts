// Finding the tempo of a dropped loop. Pure maths on the samples, so it can be tested with made-up sounds.
//
// A loop is cut to a whole number of beats, so two clues work together: the length of the file (beats / tempo = length)
// and the hits inside it (they repeat once per beat). The name of the file often says it too ("drums_96bpm.wav").

export interface DetectedTempo {
  bpm: number;
  /** Where the number came from. */
  source: "filename" | "audio";
}

/** "kick_loop_96bpm.wav", "120 BPM groove", "bpm-85-guitar": a tempo written in the name. */
export function bpmFromFileName(name: string): number | null {
  const m = /(\d{2,3}(?:[.,]\d)?)\s*[-_ ]?\s*bpm/i.exec(name) ?? /bpm\s*[-_ ]?\s*(\d{2,3}(?:[.,]\d)?)/i.exec(name);
  if (!m) return null;
  const bpm = Number(m[1].replace(",", "."));
  return bpm >= 40 && bpm <= 300 ? bpm : null;
}

const HOP = 256;
const WINDOW = 1024;

/** How strongly the sound "hits" at each step: the rise in the energy of short windows. */
function hitStrength(samples: Float32Array): Float32Array {
  const n = Math.max(0, Math.floor((samples.length - WINDOW) / HOP) + 1);
  const energy = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    let a = 0;
    const start = f * HOP;
    for (let i = start; i < start + WINDOW; i++) a += samples[i] * samples[i];
    energy[f] = Math.log(1e-6 + a / WINDOW);
  }
  const out = new Float32Array(n);
  for (let f = 1; f < n; f++) out[f] = Math.max(0, energy[f] - energy[f - 1]);
  return out;
}

/** How alike the hit pattern is to itself shifted by `lag` steps (0..1, 1 = identical). Fractional lags are interpolated. */
function selfSimilarity(env: Float32Array, lag: number): number {
  const lo = Math.floor(lag);
  const frac = lag - lo;
  const n = env.length - lo - 1;
  if (n < 8) return 0;
  let dot = 0;
  let a = 0;
  let b = 0;
  for (let i = 0; i < n; i++) {
    const shifted = env[i + lo] * (1 - frac) + env[i + lo + 1] * frac;
    dot += env[i] * shifted;
    a += env[i] * env[i];
    b += shifted * shifted;
  }
  return a > 0 && b > 0 ? dot / Math.sqrt(a * b) : 0;
}

/**
 * The tempo of a loop, from the file name or from the audio. For the audio, every tempo that makes the file an exact whole
 * number of beats (and sits between 60 and 190 BPM) is tried, and the one whose hits repeat best once per beat wins.
 * Returns null when nothing convincing is found (a voice, a pad, silence...), so a recording that is not a loop is left alone.
 */
export function detectLoopBpm(samples: Float32Array, sampleRate: number, fileName = ""): DetectedTempo | null {
  const named = bpmFromFileName(fileName);
  if (named !== null) return { bpm: named, source: "filename" };

  const durationSec = samples.length / sampleRate;
  if (durationSec < 1.5 || durationSec > 120) return null;
  const env = hitStrength(samples);
  if (env.length < 40) return null;
  let energy = 0;
  for (let i = 0; i < env.length; i++) energy += env[i];
  let strongest = 0;
  for (let i = 0; i < env.length; i++) strongest = Math.max(strongest, env[i]);
  // Nothing really hits (silence, a pad, a drone, a steady tone): not a loop with a beat.
  if (energy < 1 || strongest < 0.5) return null;

  const framesPerSec = sampleRate / HOP;
  let best: { bpm: number; score: number } | null = null;
  let second = 0;
  for (const beats of [2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128]) {
    const bpm = (60 * beats) / durationSec;
    if (bpm < 60 || bpm > 190) continue;
    const beatLag = (60 / bpm) * framesPerSec;
    const barLag = beatLag * 4;
    // The hits should repeat each beat, and (more strongly) each bar of four.
    const score = selfSimilarity(env, beatLag) * 0.5 + selfSimilarity(env, barLag) * 0.5;
    // A liking for the tempi most loops have (a bell around 115 BPM): half and double a tempo repeat just as well, and this picks the likelier.
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 115) / 0.5, 2));
    const total = score * prior;
    if (!best || total > best.score) {
      if (best) second = Math.max(second, best.score);
      best = { bpm, score: total };
    } else second = Math.max(second, total);
  }
  if (!best || best.score < 0.25) return null;
  // Not convincing if another tempo explains the hits almost as well.
  if (second > 0 && best.score < second * 1.08) return null;
  return { bpm: Math.round(best.bpm * 10) / 10, source: "audio" };
}
