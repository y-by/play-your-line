// The master channel's settings (the master's mute is not saved: it is personal, like solo; see the store): plain data and math, so they are testable without an audio context.
// The node graph is in masterChain.ts.

import type { ChannelFx, MasterMix } from "../types/project";
import { clampFx, DEFAULT_CHANNEL_FX } from "./channelFx.ts";

/** Neutral: the song passes through unchanged. The power switch is off, as for a new channel. */
export const DEFAULT_MASTER: MasterMix = {
  volume: 1,
  fx: { ...DEFAULT_CHANNEL_FX, delayOn: false, reverbOn: false },
  limiterOn: true,
};

/** The safety limiter's ceiling: peaks are squeezed towards this level. */
export const LIMITER_CEILING_DB = -1;

export function clampMasterVolume(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
}

/** The effects the master uses: the delay and reverb of a channel never run on it. */
export function masterFxOnly(fx: ChannelFx): ChannelFx {
  return { ...fx, delayOn: false, reverbOn: false, delayMix: 0, reverbMix: 0 };
}

/** Reads the saved json (anything missing keeps its neutral value; every number is clamped). */
export function parseMasterFx(json: unknown): { fx: ChannelFx; limiterOn: boolean } {
  const obj = json && typeof json === "object" && !Array.isArray(json) ? (json as Record<string, unknown>) : {};
  const fx = masterFxOnly({ ...DEFAULT_MASTER.fx, ...clampFx(obj as Partial<ChannelFx>) });
  const limiterOn = typeof obj.limiterOn === "boolean" ? obj.limiterOn : DEFAULT_MASTER.limiterOn;
  return { fx, limiterOn };
}

/** A projects row (or a live update of one) as the master. */
export function masterFromRow(row: Record<string, unknown>, fallback: MasterMix = DEFAULT_MASTER): MasterMix {
  const { fx, limiterOn } = "master_fx" in row ? parseMasterFx(row.master_fx) : { fx: fallback.fx, limiterOn: fallback.limiterOn };
  return {
    volume: typeof row.master_volume === "number" ? clampMasterVolume(row.master_volume) : fallback.volume,
    fx,
    limiterOn,
  };
}

/** The effects part as the json to save. */
export function masterFxToJson(m: Pick<MasterMix, "fx" | "limiterOn">): Record<string, number | boolean> {
  const out: Record<string, number | boolean> = { limiterOn: m.limiterOn };
  const fx = masterFxOnly(m.fx) as unknown as Record<string, number | boolean>;
  for (const key of Object.keys(fx)) out[key] = fx[key];
  return out;
}

/** True when the master changes nothing about the sound (volume 1, effects out of the path or neutral). */
export function isNeutralMaster(m: MasterMix): boolean {
  if (m.volume < 0.999) return false;
  if (!m.fx.fxOn) return true;
  const noEq = Math.abs(m.fx.eqLow) + Math.abs(m.fx.eqMid) + Math.abs(m.fx.eqHigh) <= 0.05 && m.fx.eqLowCutHz <= 21;
  const noComp = m.fx.compRatio <= 1.02 && m.fx.compMakeupDb <= 0.05;
  return !m.limiterOn && (noEq || !m.fx.eqOn) && (noComp || !m.fx.compOn);
}
