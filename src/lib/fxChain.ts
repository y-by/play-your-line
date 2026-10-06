// The audio graph for one channel's effects: EQ -> Compressor -> Delay -> Reverb. The live engine and the
// Export Mix render both build it with this one function, so an exported mix sounds like the editor.
// Effects that are off (or set to change nothing) are taken out of the signal path altogether.

import type { ChannelFx } from "../types/project";
import { activeStages, clampFx, DEFAULT_CHANNEL_FX, DELAY_FEEDBACK, EQ_HIGH_HZ, EQ_LOW_HZ, EQ_MID_HZ, EQ_MID_Q, type FxStage } from "./channelFx";

export interface FxChain {
  /** Feed the channel's (fader) signal in here. */
  input: GainNode;
  /** The processed signal comes out here. */
  output: GainNode;
  eqLow: BiquadFilterNode;
  eqMid: BiquadFilterNode;
  eqHigh: BiquadFilterNode;
  compressor: DynamicsCompressorNode;
  /**
   * Sets the chain to `fx`. `smooth` glides the knobs (live use); without it values are set outright
   * (a freshly built chain, or an offline render). `bypassAll` hears the channel dry without touching the settings.
   */
  apply: (fx: ChannelFx, opts?: { smooth?: boolean; bypassAll?: boolean }) => void;
}

interface Stage {
  input: AudioNode;
  output: AudioNode;
}

export function createFxChain(ctx: BaseAudioContext, impulse: AudioBuffer): FxChain {
  const input = ctx.createGain();
  const output = ctx.createGain();

  // EQ: fixed low-shelf / mid-peak / high-shelf, in series.
  const eqLow = ctx.createBiquadFilter();
  eqLow.type = "lowshelf";
  eqLow.frequency.value = EQ_LOW_HZ;
  const eqMid = ctx.createBiquadFilter();
  eqMid.type = "peaking";
  eqMid.frequency.value = EQ_MID_HZ;
  eqMid.Q.value = EQ_MID_Q;
  const eqHigh = ctx.createBiquadFilter();
  eqHigh.type = "highshelf";
  eqHigh.frequency.value = EQ_HIGH_HZ;
  eqLow.connect(eqMid);
  eqMid.connect(eqHigh);

  // Compressor, then make-up gain.
  const compressor = ctx.createDynamicsCompressor();
  compressor.knee.value = 6;
  const makeup = ctx.createGain();
  compressor.connect(makeup);

  // Delay: a feedback loop mixed with the dry signal.
  const delayIn = ctx.createGain();
  const delayNode = ctx.createDelay(1);
  const delayFeedback = ctx.createGain();
  delayFeedback.gain.value = DELAY_FEEDBACK;
  const delayDry = ctx.createGain();
  const delayWet = ctx.createGain();
  const delayOut = ctx.createGain();
  delayIn.connect(delayDry);
  delayIn.connect(delayNode);
  delayNode.connect(delayFeedback);
  delayFeedback.connect(delayNode);
  delayNode.connect(delayWet);
  delayDry.connect(delayOut);
  delayWet.connect(delayOut);

  // Reverb: a shared noise-decay impulse through a ConvolverNode, mixed with the dry signal.
  const reverbIn = ctx.createGain();
  const convolver = ctx.createConvolver();
  convolver.normalize = true;
  convolver.buffer = impulse;
  const reverbDry = ctx.createGain();
  const reverbWet = ctx.createGain();
  const reverbOut = ctx.createGain();
  reverbIn.connect(reverbDry);
  reverbIn.connect(convolver);
  convolver.connect(reverbWet);
  reverbDry.connect(reverbOut);
  reverbWet.connect(reverbOut);

  const stages: Record<FxStage, Stage> = {
    eq: { input: eqLow, output: eqHigh },
    comp: { input: compressor, output: makeup },
    delay: { input: delayIn, output: delayOut },
    reverb: { input: reverbIn, output: reverbOut },
  };

  let routed: string | null = null; // nothing wired yet, so the first route() always connects
  let routedStages: FxStage[] = [];
  const route = (active: FxStage[]) => {
    const key = active.join();
    if (key === routed) return;
    routed = key;
    routedStages = active;
    input.disconnect();
    for (const s of Object.values(stages)) s.output.disconnect();
    let from: AudioNode = input;
    for (const name of active) {
      from.connect(stages[name].input);
      from = stages[name].output;
    }
    from.connect(output);
  };
  route([]);

  const apply: FxChain["apply"] = (fxIn, opts = {}) => {
    const fx = { ...DEFAULT_CHANNEL_FX, ...fxIn, ...clampFx(fxIn) };
    const now = ctx.currentTime;
    const nowActive = activeStages(fx, opts.bypassAll);
    // A knob glides only while its effect is in the signal path. An effect that is out of the path is not
    // processed, so its glide would stall; it is set outright and is right the moment it is switched back in.
    const set = (stage: FxStage, param: AudioParam, value: number, tc = 0.02) => {
      if (opts.smooth && routedStages.includes(stage) && nowActive.includes(stage)) {
        param.setTargetAtTime(value, now, tc);
      } else {
        param.cancelScheduledValues(now);
        param.value = value;
      }
    };
    set("eq", eqLow.gain, fx.eqLow);
    set("eq", eqMid.gain, fx.eqMid);
    set("eq", eqHigh.gain, fx.eqHigh);
    set("eq", eqLow.frequency, fx.eqLowHz);
    set("eq", eqMid.frequency, fx.eqMidHz);
    set("eq", eqHigh.frequency, fx.eqHighHz);
    set("comp", compressor.threshold, fx.compThresholdDb);
    set("comp", compressor.ratio, fx.compRatio);
    set("comp", compressor.attack, fx.compAttackMs / 1000);
    set("comp", compressor.release, fx.compReleaseMs / 1000);
    set("comp", makeup.gain, Math.pow(10, fx.compMakeupDb / 20));
    set("delay", delayNode.delayTime, fx.delayTimeMs / 1000, 0.06); // slower glide: a fast one makes the repeats swoop in pitch
    set("delay", delayWet.gain, fx.delayMix);
    set("delay", delayDry.gain, 1 - fx.delayMix);
    set("reverb", reverbWet.gain, fx.reverbMix);
    set("reverb", reverbDry.gain, 1 - fx.reverbMix);
    route(nowActive);
  };

  return { input, output, eqLow, eqMid, eqHigh, compressor, apply };
}
