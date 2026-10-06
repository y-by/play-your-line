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
  compThresholdDb: 0,
  compRatio: 1,
  compAttackMs: 10,
  compReleaseMs: 150,
  compMakeupDb: 0,
  delayTimeMs: 300,
  delayMix: 0,
  reverbMix: 0,
};

/** Fixed EQ band centres — kept simple: one shelf, one peak, one shelf. */
export const EQ_LOW_HZ = 200;
export const EQ_MID_HZ = 1000;
export const EQ_MID_Q = 1;
export const EQ_HIGH_HZ = 5000;

/** How long the feedback delay's own repeats decay by themselves. */
export const DELAY_FEEDBACK = 0.35;

export type FxStage = "eq" | "comp" | "delay" | "reverb";
export const FX_STAGES: FxStage[] = ["eq", "comp", "delay", "reverb"];

/**
 * Which effects actually need to run. Anything switched off, or sitting at a setting that changes
 * nothing, is left out of the signal path entirely — no wasted processing, and no colouring of the sound.
 */
export function activeStages(fx: ChannelFx, bypassAll = false): FxStage[] {
  if (!fx.fxOn || bypassAll) return [];
  const out: FxStage[] = [];
  if (fx.eqOn && Math.abs(fx.eqLow) + Math.abs(fx.eqMid) + Math.abs(fx.eqHigh) > 0.05) out.push("eq");
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
