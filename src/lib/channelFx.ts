// Per-channel insert effects: EQ, Compressor, Delay, Reverb. The node graph
// itself lives in audioEngine.ts (it needs a live AudioContext); this file
// holds the parts that are plain math, so they're testable without one.

import type { ChannelFx } from "../types/project";

/** 0..1 "amount" knob -> a DynamicsCompressorNode's threshold (dB) and ratio. */
export function compressorParamsFromAmount(amount: number): { thresholdDb: number; ratio: number } {
  const a = Math.max(0, Math.min(1, amount));
  return { thresholdDb: -a * 30, ratio: 1 + a * 11 };
}

/** Fixed EQ band centres — kept simple: one shelf, one peak, one shelf. */
export const EQ_LOW_HZ = 200;
export const EQ_MID_HZ = 1000;
export const EQ_MID_Q = 1;
export const EQ_HIGH_HZ = 5000;

/** How long the feedback delay's own repeats decay by themselves. */
export const DELAY_FEEDBACK = 0.35;

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

export function clampFx(fx: Partial<ChannelFx>): Partial<ChannelFx> {
  const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
  const out: Partial<ChannelFx> = {};
  if (fx.eqLow !== undefined) out.eqLow = clamp(fx.eqLow, -12, 12);
  if (fx.eqMid !== undefined) out.eqMid = clamp(fx.eqMid, -12, 12);
  if (fx.eqHigh !== undefined) out.eqHigh = clamp(fx.eqHigh, -12, 12);
  if (fx.compAmount !== undefined) out.compAmount = clamp(fx.compAmount, 0, 1);
  if (fx.delayTimeMs !== undefined) out.delayTimeMs = clamp(fx.delayTimeMs, 0, 1000);
  if (fx.delayMix !== undefined) out.delayMix = clamp(fx.delayMix, 0, 1);
  if (fx.reverbMix !== undefined) out.reverbMix = clamp(fx.reverbMix, 0, 1);
  return out;
}
