// Per-channel insert effects: EQ, Compressor, Delay, Reverb. The node graph
// itself lives in fxChain.ts (it needs an audio context); this file holds the
// parts that are plain data and math, so they're testable without one.

import type { ChannelFx } from "../types/project";

/** Everything off and neutral. The power switch is off too: a new channel is heard dry. */
export const DEFAULT_CHANNEL_FX: ChannelFx = {
  fxOn: false,
  eqOn: true,
  compOn: true,
  delayOn: true,
  reverbOn: true,
  eqLow: 0,
  eqMid: 0,
  eqHigh: 0,
  eqLowCutHz: 20,
  eqLowHz: 200,
  eqMidHz: 1000,
  eqHighHz: 5000,
  compThresholdDb: 0,
  compRatio: 1,
  compAttackMs: 10,
  compReleaseMs: 150,
  compMakeupDb: 0,
  delayTimeMs: 300,
  delayMix: 0,
  reverbMix: 0,
};

/** The EQ: one shelf, one peak, one shelf. Each has its own frequency knob; these are the starting points. */
export const EQ_LOW_HZ = 200;
export const EQ_MID_HZ = 1000;
export const EQ_MID_Q = 1;
/** The low cut's resonance in dB (-3.01 dB is the flat, Butterworth shape). */
export const EQ_CUT_Q_DB = -3.0103;
export const EQ_HIGH_HZ = 5000;

/** How far each band's frequency knob can go. */
export const EQ_FREQ_RANGE = {
  /** The low cut (a high-pass filter): at the bottom of its knob it is off. */
  cut: [20, 400],
  low: [40, 800],
  mid: [200, 8000],
  high: [1500, 16000],
} as const;

/** A frequency as a position on its knob (0..100), evenly spaced the way hearing works (logarithmic). */
export function hzToPos(hz: number, min: number, max: number): number {
  const clamped = Math.min(max, Math.max(min, hz));
  return (Math.log(clamped / min) / Math.log(max / min)) * 100;
}

/** The knob position back to a tidy frequency (rounded so saved values read as 250 Hz, not 247.318). */
export function posToHz(pos: number, min: number, max: number): number {
  const hz = min * Math.pow(max / min, Math.min(100, Math.max(0, pos)) / 100);
  const step = hz < 100 ? 1 : hz < 1000 ? 5 : hz < 10000 ? 50 : 500;
  return Math.min(max, Math.max(min, Math.round(hz / step) * step));
}

/** "250" Hz, "1.2k", "12k". */
export function formatHz(hz: number): string {
  if (hz < 1000) return `${Math.round(hz)}`;
  const k = hz / 1000;
  return `${k >= 10 ? Math.round(k) : Math.round(k * 10) / 10}k`;
}

/** How long the feedback delay's own repeats decay by themselves. */
export const DELAY_FEEDBACK = 0.35;

/** The low cut is on once its knob is turned up from the bottom. */
export function lowCutOn(hz: number): boolean {
  return hz > EQ_FREQ_RANGE.cut[0] + 1;
}

export type FxStage = "eq" | "comp" | "delay" | "reverb";
export const FX_STAGES: FxStage[] = ["eq", "comp", "delay", "reverb"];

/**
 * Which effects actually need to run. Anything switched off, or sitting at a setting that changes
 * nothing, is left out of the signal path entirely — no wasted processing, and no colouring of the sound.
 */
export function activeStages(fx: ChannelFx, bypassAll = false): FxStage[] {
  if (!fx.fxOn || bypassAll) return [];
  const out: FxStage[] = [];
  if (fx.eqOn && (Math.abs(fx.eqLow) + Math.abs(fx.eqMid) + Math.abs(fx.eqHigh) > 0.05 || lowCutOn(fx.eqLowCutHz))) out.push("eq");
  if (fx.compOn && (fx.compRatio > 1.02 || fx.compMakeupDb > 0.05)) out.push("comp");
  if (fx.delayOn && fx.delayMix > 0.001) out.push("delay");
  if (fx.reverbOn && fx.reverbMix > 0.001) out.push("reverb");
  return out;
}

/** True when every effect is at its neutral setting (the power switch aside). */
export function isNeutralFx(fx: ChannelFx): boolean {
  return activeStages({ ...fx, fxOn: true }).length === 0;
}

/** How long (seconds) the effects keep ringing after the last note — so an export doesn't cut a tail short. */
export function fxTailSec(fx: ChannelFx): number {
  const stages = activeStages(fx);
  let tail = 0;
  if (stages.includes("delay")) tail = Math.max(tail, (fx.delayTimeMs / 1000) * 8);
  if (stages.includes("reverb")) tail = Math.max(tail, 2.5);
  return tail;
}

/**
 * A synthetic reverb impulse response (exponentially-decaying noise) — a
 * standard, cheap way to get a real-sounding ConvolverNode reverb without
 * shipping an audio sample. One buffer is generated per AudioContext and
 * shared across every channel's ConvolverNode.
 */
export function createReverbImpulse(ctx: BaseAudioContext, durationSec = 2.2, decay = 2.5): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(rate * durationSec));
  const impulse = ctx.createBuffer(2, length, rate);
  for (let channel = 0; channel < impulse.numberOfChannels; channel++) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return impulse;
}

const RANGES = {
  eqLow: [-12, 12],
  eqMid: [-12, 12],
  eqHigh: [-12, 12],
  eqLowCutHz: EQ_FREQ_RANGE.cut,
  eqLowHz: EQ_FREQ_RANGE.low,
  eqMidHz: EQ_FREQ_RANGE.mid,
  eqHighHz: EQ_FREQ_RANGE.high,
  compThresholdDb: [-60, 0],
  compRatio: [1, 20],
  compAttackMs: [0, 200],
  compReleaseMs: [10, 1500],
  compMakeupDb: [0, 24],
  delayTimeMs: [0, 1000],
  delayMix: [0, 1],
  reverbMix: [0, 1],
} as const;

const SWITCHES = ["fxOn", "eqOn", "compOn", "delayOn", "reverbOn"] as const;

export function clampFx(fx: Partial<ChannelFx>): Partial<ChannelFx> {
  const out: Partial<ChannelFx> = {};
  for (const key of Object.keys(RANGES) as (keyof typeof RANGES)[]) {
    const v = fx[key];
    if (typeof v === "number" && Number.isFinite(v)) out[key] = Math.min(RANGES[key][1], Math.max(RANGES[key][0], v));
  }
  for (const key of SWITCHES) if (typeof fx[key] === "boolean") out[key] = fx[key];
  return out;
}

// ---- Database columns <-> fields, in one place --------------------------------------------------

const COLUMNS: Record<keyof ChannelFx, string> = {
  fxOn: "fx_on",
  eqOn: "eq_on",
  compOn: "comp_on",
  delayOn: "delay_on",
  reverbOn: "reverb_on",
  eqLow: "eq_low",
  eqMid: "eq_mid",
  eqHigh: "eq_high",
  eqLowCutHz: "eq_lowcut_hz",
  eqLowHz: "eq_low_hz",
  eqMidHz: "eq_mid_hz",
  eqHighHz: "eq_high_hz",
  compThresholdDb: "comp_threshold_db",
  compRatio: "comp_ratio",
  compAttackMs: "comp_attack_ms",
  compReleaseMs: "comp_release_ms",
  compMakeupDb: "comp_makeup_db",
  delayTimeMs: "delay_time_ms",
  delayMix: "delay_mix",
  reverbMix: "reverb_mix",
};

/** A tracks row (or a live update of one) as FX fields; anything missing keeps `fallback`'s value. */
export function fxFromRow(row: Record<string, unknown>, fallback: ChannelFx = DEFAULT_CHANNEL_FX): ChannelFx {
  const out = { ...fallback } as Record<string, unknown>;
  for (const key of Object.keys(COLUMNS) as (keyof ChannelFx)[]) {
    const v = row[COLUMNS[key]];
    if (typeof v === (typeof fallback[key] === "boolean" ? "boolean" : "number")) out[key] = v;
  }
  return out as unknown as ChannelFx;
}

/** FX fields as the columns to save. */
export function fxToRow(patch: Partial<ChannelFx>): Record<string, number | boolean> {
  const row: Record<string, number | boolean> = {};
  for (const key of Object.keys(patch) as (keyof ChannelFx)[]) {
    const v = patch[key];
    if (v !== undefined && COLUMNS[key]) row[COLUMNS[key]] = v;
  }
  return row;
}

// ---- Presets ------------------------------------------------------------------------------------

export interface FxPreset {
  id: string;
  name: string;
  fx: Partial<ChannelFx>;
}

/** Starting points. Choosing one sets the effects (and switches FX on); the player can then tweak. */
export const FX_PRESETS: FxPreset[] = [
  { id: "flat", name: "Flat (everything neutral)", fx: {} },
  {
    id: "vocal",
    name: "Vocal",
    fx: { eqLow: -3, eqMid: 2, eqHigh: 3, compThresholdDb: -18, compRatio: 3, compAttackMs: 10, compReleaseMs: 120, compMakeupDb: 3, reverbMix: 0.15 },
  },
  {
    id: "guitar",
    name: "Guitar",
    fx: { eqLow: -2, eqMid: 1, eqHigh: 2, compThresholdDb: -14, compRatio: 2.5, compAttackMs: 20, compReleaseMs: 200, compMakeupDb: 2, delayTimeMs: 380, delayMix: 0.1, reverbMix: 0.2 },
  },
  {
    id: "bass",
    name: "Bass",
    fx: { eqLow: 3, eqMid: -1, eqHigh: -2, compThresholdDb: -20, compRatio: 4, compAttackMs: 15, compReleaseMs: 150, compMakeupDb: 4 },
  },
  {
    id: "drums",
    name: "Drums",
    fx: { eqLow: 2, eqMid: -1, eqHigh: 3, compThresholdDb: -12, compRatio: 3, compAttackMs: 5, compReleaseMs: 80, compMakeupDb: 2, reverbMix: 0.1 },
  },
  { id: "room", name: "Room", fx: { reverbMix: 0.3 } },
  { id: "echo", name: "Echo", fx: { delayTimeMs: 420, delayMix: 0.3, reverbMix: 0.12 } },
];

/** A preset as a complete patch: every effect setting is replaced, FX is switched on, the power state of each effect kept on. */
export function presetPatch(id: string): Partial<ChannelFx> | null {
  const preset = FX_PRESETS.find((p) => p.id === id);
  if (!preset) return null;
  return { ...DEFAULT_CHANNEL_FX, ...preset.fx, fxOn: true };
}

/** Every effect setting back to neutral, leaving the power switch and each bypass as they are. */
export function resetPatch(current: ChannelFx): Partial<ChannelFx> {
  return { ...DEFAULT_CHANNEL_FX, fxOn: current.fxOn, eqOn: current.eqOn, compOn: current.compOn, delayOn: current.delayOn, reverbOn: current.reverbOn };
}

// ---- The EQ curve, worked out from the settings ----------------------------------------------------
// The drawn curve is calculated from the knob values (the standard biquad formulas the browser's own
// filters use), not read back from the audio nodes, so it is right even while the EQ is bypassed.

interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a0: number;
  a1: number;
  a2: number;
}

function biquad(kind: "highpass" | "lowshelf" | "peaking" | "highshelf", freq: number, gainDb: number, sampleRate: number): Biquad {
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * Math.min(freq, sampleRate * 0.49)) / sampleRate;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  if (kind === "highpass") {
    // Q is given in dB, as the browser's filter takes it; the cut is a plain 12 dB per octave (Butterworth) one.
    const alpha = sin / (2 * Math.pow(10, EQ_CUT_Q_DB / 20));
    return { b0: (1 + cos) / 2, b1: -(1 + cos), b2: (1 + cos) / 2, a0: 1 + alpha, a1: -2 * cos, a2: 1 - alpha };
  }
  if (kind === "peaking") {
    const alpha = sin / (2 * EQ_MID_Q);
    return { b0: 1 + alpha * A, b1: -2 * cos, b2: 1 - alpha * A, a0: 1 + alpha / A, a1: -2 * cos, a2: 1 - alpha / A };
  }
  const alpha = (sin / 2) * Math.SQRT2; // shelf slope 1
  const k = 2 * Math.sqrt(A) * alpha;
  if (kind === "lowshelf") {
    return {
      b0: A * (A + 1 - (A - 1) * cos + k),
      b1: 2 * A * (A - 1 - (A + 1) * cos),
      b2: A * (A + 1 - (A - 1) * cos - k),
      a0: A + 1 + (A - 1) * cos + k,
      a1: -2 * (A - 1 + (A + 1) * cos),
      a2: A + 1 + (A - 1) * cos - k,
    };
  }
  return {
    b0: A * (A + 1 + (A - 1) * cos + k),
    b1: -2 * A * (A - 1 + (A + 1) * cos),
    b2: A * (A + 1 + (A - 1) * cos - k),
    a0: A + 1 - (A - 1) * cos + k,
    a1: 2 * (A - 1 - (A + 1) * cos),
    a2: A + 1 - (A - 1) * cos - k,
  };
}

function magnitudeDb(f: Biquad, hz: number, sampleRate: number): number {
  const w = (2 * Math.PI * hz) / sampleRate;
  const c1 = Math.cos(w);
  const s1 = Math.sin(w);
  const c2 = Math.cos(2 * w);
  const s2 = Math.sin(2 * w);
  const nr = f.b0 + f.b1 * c1 + f.b2 * c2;
  const ni = -(f.b1 * s1 + f.b2 * s2);
  const dr = f.a0 + f.a1 * c1 + f.a2 * c2;
  const di = -(f.a1 * s1 + f.a2 * s2);
  return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
}

/** The EQ's combined response, in dB, at each frequency in `freqs`, for the current settings. */
export function eqResponseDb(
  fx: Pick<ChannelFx, "eqLowCutHz" | "eqLow" | "eqMid" | "eqHigh" | "eqLowHz" | "eqMidHz" | "eqHighHz">,
  freqs: ArrayLike<number>,
  sampleRate = 48000
): number[] {
  const bands = [
    ...(lowCutOn(fx.eqLowCutHz) ? [biquad("highpass", fx.eqLowCutHz, 0, sampleRate)] : []),
    biquad("lowshelf", fx.eqLowHz, fx.eqLow, sampleRate),
    biquad("peaking", fx.eqMidHz, fx.eqMid, sampleRate),
    biquad("highshelf", fx.eqHighHz, fx.eqHigh, sampleRate),
  ];
  return Array.from({ length: freqs.length }, (_, i) => bands.reduce((sum, b) => sum + magnitudeDb(b, freqs[i], sampleRate), 0));
}
