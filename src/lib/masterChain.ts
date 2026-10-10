// The audio graph of the master channel: fader -> EQ -> compressor -> safety limiter. The live engine and the
// Export Mix / listening copy render both build it with this one function, so what you hear is what you export.
// The effects use the same chain as a channel (fxChain.ts), with delay and reverb never switched on.

import type { MasterMix } from "../types/project";
import { createFxChain, type FxChain } from "./fxChain";
import { LIMITER_CEILING_DB, masterFxOnly } from "./master";

export interface MasterChain {
  /** Feed the mixed song in here. */
  input: GainNode;
  /** The finished sound comes out here. */
  output: GainNode;
  fx: FxChain;
  limiter: DynamicsCompressorNode;
  /**
   * Sets the chain to `master`. `smooth` glides the fader (live use). `dry` hears the song without the master's
   * effects (never saved). `mute` silences the song for the person listening (personal, never saved; an export never uses it).
   */
  apply: (master: MasterMix, opts?: { smooth?: boolean; dry?: boolean; mute?: boolean }) => void;
}

export function createMasterChain(ctx: BaseAudioContext): MasterChain {
  const input = ctx.createGain();
  const fader = ctx.createGain();
  const output = ctx.createGain();
  // The effects chain asks for a reverb impulse; the master never uses reverb, so a single silent sample will do.
  const fx = createFxChain(ctx, ctx.createBuffer(2, 1, ctx.sampleRate));
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = LIMITER_CEILING_DB;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.1;

  input.connect(fader);
  fader.connect(fx.input);

  // The limiter is in the path only when it is on: a compressor node adds a few milliseconds of delay even when it does nothing.
  let limited: boolean | null = null;
  const route = (useLimiter: boolean) => {
    if (useLimiter === limited) return;
    limited = useLimiter;
    fx.output.disconnect();
    limiter.disconnect();
    if (useLimiter) {
      fx.output.connect(limiter);
      limiter.connect(output);
    } else {
      fx.output.connect(output);
    }
  };
  route(false);

  const apply: MasterChain["apply"] = (master, opts = {}) => {
    const now = ctx.currentTime;
    const level = opts.mute ? 0 : master.volume;
    if (opts.smooth) {
      fader.gain.cancelScheduledValues(now);
      fader.gain.setTargetAtTime(level, now, 0.015);
    } else {
      fader.gain.cancelScheduledValues(now);
      fader.gain.value = level;
    }
    fx.apply(masterFxOnly(master.fx), { smooth: opts.smooth, bypassAll: opts.dry });
    route(master.fx.fxOn && master.limiterOn && !opts.dry);
  };

  return { input, output, fx, limiter, apply };
}
