// Central Web Audio engine: decodes track blobs, plays them in sync on a shared
// timeline, and records a new take against the current mix.

import { buildAudioConstraints } from "./inputDevices";
import { encodeWavFloat32 } from "./wav";
import { computeTakePlacement, measureClickLatencies, summarizeLatencies } from "./latency";
import { audibleSegments, clipsEnd, type ClipData } from "./clips";
import { scheduleSegment } from "./segmentPlayback";
import { loopApplies, positionWithLoop, nextLoopPass, MIN_LOOP_SEC, type LoopRegion, type LoopPass } from "./loop";
import { createReverbImpulse, clampFx, DEFAULT_CHANNEL_FX } from "./channelFx";
import { createFxChain, type FxChain } from "./fxChain";
import type { ChannelFx, MasterMix } from "../types/project";
import { createMasterChain, type MasterChain } from "./masterChain";
import { DEFAULT_MASTER } from "./master";
import { resolveMix } from "./groups";
import pcmRecorderWorkletUrl from "../worklets/pcm-recorder-processor.js?url&no-inline";

type PlaybackListener = (state: { isPlaying: boolean; positionSec: number }) => void;
type LevelListener = (rms: number, peak: number) => void;

/** Samples per min/max pair of the live waveform (about 10 ms). */
const LIVE_BIN = 512;

export interface RecordingResult {
  blob: Blob;
  /** Where this take belongs on the song timeline, latency-compensated. */
  timelineOffsetSec: number;
  latencySec: number;
  durationSec: number;
}

/** A recording in progress, reduced to peaks for drawing a waveform while it is being made. */
export interface LiveRecording {
  /** Where on the song timeline the take will land (same maths as the final placement). */
  startSec: number;
  /** Seconds of audio each pair of peak values stands for. */
  binSec: number;
  /** [min0, max0, min1, max1, ...] — a view into a buffer that keeps growing, so copy it to keep it. */
  peaks: Float32Array;
  /** Seconds covered by `peaks`. */
  dataSec: number;
  /** `dataSec` plus the moment since the last chunk arrived, so the right edge grows continuously. */
  tipSec: number;
}

export interface CalibrationResult {
  latencySec: number | null;
  reason: string | null;
}

interface LoadedTrack {
  trackId: string;
  clips: ClipData[];
  /** Fader (volume/mute). Feeds the FX chain below (EQ -> Compressor -> Delay -> Reverb, each only when it is on). */
  gainNode: GainNode;
  /** The channel's effects; they sit between the fader and the pan. */
  fx: FxChain;
  /** The settings the effects are set to now. */
  fxSettings: ChannelFx;
  /** Places the channel between left and right, after all effects. */
  panner: StereoPannerNode;
  /** Tapped off the channel's fully-processed output — a real per-channel level meter. */
  analyser: AnalyserNode;
  volume: number;
  muted: boolean;
  solo: boolean;
  /** The group this channel plays through (null = straight to the master). */
  groupId: string | null;
}

/** A group channel (bus): channels play into its fader, then its effects and pan, then the master. */
interface LoadedGroup {
  groupId: string;
  /** Fader (volume/mute). Feeds the effects. */
  gainNode: GainNode;
  fx: FxChain;
  fxSettings: ChannelFx;
  panner: StereoPannerNode;
  analyser: AnalyserNode;
  volume: number;
  muted: boolean;
  solo: boolean;
}

/** The keys under which the master's left and right levels arrive next to the channels' (see onTrackLevels). */
export const MASTER_LEFT = "__master_left";
export const MASTER_RIGHT = "__master_right";

/** The key under which a group's level arrives next to the channels' (see onTrackLevels). */
export const groupLevelKey = (groupId: string) => `group:${groupId}`;

export type TrackLevels = Record<string, number>;
type TrackLevelsListener = (levels: TrackLevels, peaks: TrackLevels) => void;

export class AudioEngine {
  private ctx: AudioContext;
  /** Fades the whole song while a microphone opens (withQuietOutput). Not the master fader: the user never touches it. */
  private masterGain: GainNode;
  /** The master channel: fader, EQ, compressor and limiter, after every channel. */
  private master: MasterChain;
  private masterSettings: MasterMix = DEFAULT_MASTER;
  private masterDry = false;
  /** The listener's own master mute (never saved). */
  private masterMute = false;
  private masterAnalysers: { left: AnalyserNode; right: AnalyserNode };
  /** One noise-based impulse response, shared by every channel's reverb (cheap; no sample to ship). */
  private reverbImpulse: AudioBuffer | null = null;
  /** Channels currently heard without their effects (the Compare button). */
  private fxCompare = new Set<string>();
  private tracks = new Map<string, LoadedTrack>();
  private groups = new Map<string, LoadedGroup>();
  /** Groups currently heard without their effects (the Compare button). */
  private groupFxCompare = new Set<string>();
  // Decoded audio of every take, by take id. Clips only point at these.
  private takeBuffers = new Map<string, AudioBuffer>();
  private sources: AudioBufferSourceNode[] = [];
  private trackLevelListeners = new Set<TrackLevelsListener>();
  private trackLevelTimerId: number | null = null;
  /** The loop region chosen by the user, and the one in force for the current play (null when this play doesn't loop). */
  private loopRegion: LoopRegion | null = null;
  private activeLoop: LoopRegion | null = null;
  private loopNextPass: LoopPass | null = null;
  private loopTimerId: number | null = null;
  private startedAtCtxTime = 0;
  private startedAtPositionSec = 0;
  private playing = false;
  private rafId: number | null = null;
  private listeners = new Set<PlaybackListener>();

  // The raw hardware stream (must be stopped to release the mic/interface).
  private rawInputStream: MediaStream | null = null;
  // When isolating a single channel, these nodes route rawInputStream -> a
  // single mono node feeding the recorder worklet.
  private channelGraph: {
    source: MediaStreamAudioSourceNode;
    splitter: ChannelSplitterNode;
    merger: ChannelMergerNode;
  } | null = null;
  // Lossless capture: raw Float32 samples straight off the input, no codec.
  private recorderWorkletReady: Promise<void> | null = null;
  private recorderNode: AudioWorkletNode | null = null;
  private recorderSilentGain: GainNode | null = null;
  private recorderMonoGain: GainNode | null = null;
  private recorderSource: MediaStreamAudioSourceNode | null = null;
  private recorderChunks: Float32Array[] = [];
  // Peaks of the take so far, for the live waveform: one min/max pair per LIVE_BIN samples.
  private livePeaks = new Float32Array(8192);
  private livePeakCount = 0; // number of floats used in livePeaks
  private liveBinFill = 0;
  private liveBinMin = 0;
  private liveBinMax = 0;
  private liveLastChunkAt = 0;
  private liveBinSumSq = 0;
  private liveLastRms = 0;
  // While recording, the input meter is fed from the recording itself (see startRecordingMeter).
  private recMeterRaf: number | null = null;
  private recMeterLevel = 0;
  private recPeakSinceFrame = 0;
  private recorderSampleRate = 0;

  // Independent, silent (not routed to speakers) input monitor so the user
  // can see the selected channel is receiving signal before/while recording.
  private monitorStream: MediaStream | null = null;
  private monitorSource: MediaStreamAudioSourceNode | null = null;
  private monitorSplitter: ChannelSplitterNode | null = null;
  private monitorAnalyser: AnalyserNode | null = null;
  private monitorRafId: number | null = null;
  private levelListeners = new Set<LevelListener>();
  private monitorGeneration = 0;

  // Click track. Scheduled against the same audio clock as the channels, so
  // beats land on the exact same instants no matter when you seek/play/pause.
  //
  // By default the click goes straight to ctx.destination, i.e. the very same
  // path as the channels — same output device, same latency, so click and
  // channels stay sample-tight. Only when the user picks a *different* output
  // device for the click (e.g. click in headphones, mix on monitors) is it
  // diverted through a separate hidden <audio> sink; that path adds extra
  // latency the browser can't measure, which is the price of routing it
  // somewhere else.
  private clickGain: GainNode;
  private clickOutputDest: MediaStreamAudioDestinationNode | null = null;
  private clickAudioEl: HTMLAudioElement | null = null;
  private metronomeVolume = 0.35;

  // Round-trip latency compensation (see lib/latency.ts). null = estimate
  // automatically from what the browser reports.
  private latencyCompSec: number | null = null;
  private recorderInputLatencySec = 0;
  private recorderStartFrame: number | null = null;
  private recordingAnchor: { ctxTime: number; position: number } | null = null;
  private flushResolver: (() => void) | null = null;
  // Play starts this far in the future so every source and the click are
  // scheduled against one identical, deterministic start time.
  private readonly startLeadSec = 0.06;
  // Clicks already handed to the audio clock but not yet sounded. Tracked so
  // stopping / switching the click off / changing tempo cancels them instead of
  // letting up to 0.2 s of queued clicks play on.
  private pendingGridClicks = new Set<OscillatorNode>();
  private pendingCountInClicks = new Set<OscillatorNode>();
  private bpm = 120;
  /** Beats in a bar, for the click's accent on the first beat (4 for 4/4, 3 for 3/4). */
  private beatsPerBar = 4;
  private metronomeEnabled = false;
  private metronomeTimerId: number | null = null;
  private nextClickBeatIndex = 0;
  private readonly scheduleAheadSec = 0.2;
  private readonly schedulerIntervalMs = 25;

  constructor() {
    // "interactive" asks the browser for the smallest safe output buffer —
    // less delay between a scheduled sound and it reaching the speakers.
    this.ctx = new AudioContext({ latencyHint: "interactive" });
    this.masterGain = this.ctx.createGain();
    this.master = createMasterChain(this.ctx);
    this.masterGain.connect(this.master.input);
    this.master.output.connect(this.ctx.destination);
    // The master's own level meter: left and right, read after the limiter.
    const splitter = this.ctx.createChannelSplitter(2);
    this.master.output.connect(splitter);
    const left = this.ctx.createAnalyser();
    const right = this.ctx.createAnalyser();
    left.fftSize = 512;
    right.fftSize = 512;
    splitter.connect(left, 0);
    splitter.connect(right, 1);
    this.masterAnalysers = { left, right };
    this.master.apply(this.masterSettings);

    this.clickGain = this.ctx.createGain();
    this.clickGain.gain.value = this.metronomeVolume;
    this.clickGain.connect(this.ctx.destination);
  }

  /** Whether choosing an output device for the main mix is supported here (Chrome/Edge only). */
  isMasterOutputRoutingSupported(): boolean {
    return typeof this.ctx.setSinkId === "function";
  }

  /** Whether sending the metronome click to its own output device is supported here (Chrome/Edge only). */
  isMetronomeOutputRoutingSupported(): boolean {
    return typeof HTMLMediaElement.prototype.setSinkId === "function";
  }

  /** Routes the main mix (all tracks) to a specific output device. No-op where unsupported. */
  async setOutputDevice(deviceId: string | null): Promise<boolean> {
    if (!this.ctx.setSinkId) return false;
    try {
      await this.ctx.setSinkId(deviceId && deviceId !== "default" ? deviceId : "");
      return true;
    } catch (err) {
      console.error("Failed to set output device:", err);
      return false;
    }
  }

  /**
   * Sends only the metronome click to its own output device.
   * `null` means "same as the main output": the click goes straight to the
   * same destination as the channels (tightest possible sync).
   */
  async setMetronomeOutputDevice(deviceId: string | null): Promise<boolean> {
    this.clickGain.disconnect();

    if (deviceId === null) {
      this.clickGain.connect(this.ctx.destination);
      if (this.clickAudioEl) {
        this.clickAudioEl.pause();
        this.clickAudioEl.srcObject = null;
      }
      this.clickOutputDest = null;
      this.clickAudioEl = null;
      return true;
    }

    if (!this.isMetronomeOutputRoutingSupported()) {
      this.clickGain.connect(this.ctx.destination);
      return false;
    }

    try {
      if (!this.clickOutputDest || !this.clickAudioEl) {
        this.clickOutputDest = this.ctx.createMediaStreamDestination();
        const el = new Audio();
        el.srcObject = this.clickOutputDest.stream;
        el.autoplay = true;
        this.clickAudioEl = el;
      }
      this.clickGain.connect(this.clickOutputDest);
      await this.clickAudioEl.setSinkId?.(deviceId !== "default" ? deviceId : "");
      await this.clickAudioEl.play().catch(() => {});
      return true;
    } catch (err) {
      console.error("Failed to set metronome output device:", err);
      this.clickGain.disconnect();
      this.clickGain.connect(this.ctx.destination);
      return false;
    }
  }

  /** Manual/calibrated round-trip latency in seconds, or null to estimate automatically. */
  setLatencyCompensationSec(sec: number | null) {
    this.latencyCompSec = sec === null ? null : Math.max(0, sec);
  }

  /**
   * Best guess of round-trip latency from what the browser reports: output
   * buffering + the input device's own latency. Browsers can't see the
   * physical (DAC/ADC, speaker-to-ear-to-mic) part, so calibration is more
   * accurate — this is just the automatic default.
   */
  estimateLatencySec(): number {
    const out = (this.ctx.baseLatency ?? 0) + (this.ctx.outputLatency ?? 0);
    return out + this.recorderInputLatencySec;
  }

  /** The latency actually applied to takes: manual/calibrated if set, else the automatic estimate. */
  effectiveLatencySec(): number {
    return this.latencyCompSec ?? this.estimateLatencySec();
  }

  onUpdate(listener: PlaybackListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    const state = { isPlaying: this.playing, positionSec: this.getPositionSec() };
    this.listeners.forEach((l) => l(state));
  }

  async resume() {
    if (this.ctx.state === "suspended") await this.ctx.resume();
    if (this.clickAudioEl?.paused) this.clickAudioEl.play().catch(() => {});
  }

  /**
   * Runs `task` (opening a microphone, say) while the song is briefly turned down. The computer re-configures
   * its audio hardware at that moment, which can click or crackle whatever is playing; with the output faded
   * to silence just before and brought back just after, the glitch is not heard. Nothing is paused or lost.
   */
  async withQuietOutput<T>(task: () => Promise<T>, settleMs = 450): Promise<T> {
    if (!this.playing) return task();
    const gain = this.masterGain.gain;
    const down = this.ctx.currentTime;
    gain.cancelScheduledValues(down);
    gain.setValueAtTime(gain.value, down);
    gain.linearRampToValueAtTime(0, down + 0.04);
    await new Promise((r) => setTimeout(r, 60));
    try {
      return await task();
    } finally {
      await new Promise((r) => setTimeout(r, settleMs));
      const up = this.ctx.currentTime;
      gain.cancelScheduledValues(up);
      gain.setValueAtTime(0, up);
      gain.linearRampToValueAtTime(1, up + 0.12);
    }
  }

  /**
   * Listens to a microphone stream for the tuner, on the SAME audio context the song plays on. A second context
   * would open a second audio output with the system, which can make whatever is playing crackle.
   * Returns the analyser to read from, and a function that disconnects it again.
   */
  async openInputAnalyser(stream: MediaStream, channelIndex: number | null, fftSize: number): Promise<{ analyser: AnalyserNode; sampleRate: number; close: () => void }> {
    if (this.ctx.state === "suspended") await this.ctx.resume();
    const source = this.ctx.createMediaStreamSource(stream);
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = fftSize;
    const channels = Math.max(1, source.channelCount);
    const wanted = channelIndex != null && channelIndex < channels ? channelIndex : 0;
    let splitter: ChannelSplitterNode | null = null;
    if (channels > 1) {
      splitter = this.ctx.createChannelSplitter(channels);
      source.connect(splitter);
      splitter.connect(analyser, wanted);
    } else {
      source.connect(analyser);
    }
    return {
      analyser,
      sampleRate: this.ctx.sampleRate,
      close: () => {
        source.disconnect();
        splitter?.disconnect();
        analyser.disconnect();
      },
    };
  }

  /** Decodes a take's audio once and keeps it; clips reference it by id. */
  async loadTake(takeId: string, blob: Blob): Promise<AudioBuffer> {
    const cached = this.takeBuffers.get(takeId);
    if (cached) return cached;
    const buffer = await this.ctx.decodeAudioData(await blob.arrayBuffer());
    this.takeBuffers.set(takeId, buffer);
    return buffer;
  }

  getTakeBuffer(takeId: string): AudioBuffer | undefined {
    return this.takeBuffers.get(takeId);
  }

  private ensureTrack(trackId: string): LoadedTrack {
    let track = this.tracks.get(trackId);
    if (!track) {
      if (!this.reverbImpulse) this.reverbImpulse = createReverbImpulse(this.ctx);

      const gainNode = this.ctx.createGain();

      const fx = createFxChain(this.ctx, this.reverbImpulse);

      const panner = this.ctx.createStereoPanner();

      const analyser = this.ctx.createAnalyser();
      analyser.fftSize = 512;

      // Wiring: fader -> effects -> analyser & pan -> master.
      gainNode.connect(fx.input);
      fx.output.connect(analyser);
      fx.output.connect(panner);
      panner.connect(this.masterGain);

      track = {
        trackId,
        clips: [],
        gainNode,
        fx,
        fxSettings: { ...DEFAULT_CHANNEL_FX },
        panner,
        analyser,
        volume: 1,
        muted: false,
        solo: false,
        groupId: null,
      };
      this.tracks.set(trackId, track);
      fx.apply(track.fxSettings);
      this.ensureTrackLevelLoop();
    }
    return track;
  }

  // ---- Group channels (busses) ----------------------------------------------------------------------------------

  private ensureGroup(groupId: string): LoadedGroup {
    let g = this.groups.get(groupId);
    if (!g) {
      if (!this.reverbImpulse) this.reverbImpulse = createReverbImpulse(this.ctx);
      const gainNode = this.ctx.createGain();
      const fx = createFxChain(this.ctx, this.reverbImpulse);
      const panner = this.ctx.createStereoPanner();
      const analyser = this.ctx.createAnalyser();
      analyser.fftSize = 512;
      // Wiring: fader -> effects -> analyser & pan -> master, like a channel.
      gainNode.connect(fx.input);
      fx.output.connect(analyser);
      fx.output.connect(panner);
      panner.connect(this.masterGain);
      g = { groupId, gainNode, fx, fxSettings: { ...DEFAULT_CHANNEL_FX }, panner, analyser, volume: 1, muted: false, solo: false };
      this.groups.set(groupId, g);
      fx.apply(g.fxSettings);
      this.ensureTrackLevelLoop();
    }
    return g;
  }

  /** Where a channel's sound goes: into its group's fader, or straight to the master. */
  private routeTrack(t: LoadedTrack) {
    t.panner.disconnect();
    const g = t.groupId ? this.groups.get(t.groupId) : undefined;
    t.panner.connect(g ? g.gainNode : this.masterGain);
  }

  /** Puts a channel in a group (null = takes it out: it plays straight to the master). */
  setTrackGroup(trackId: string, groupId: string | null) {
    const t = this.ensureTrack(trackId);
    if (t.groupId === groupId) return; // nothing to rewire (rewiring while playing can click)
    if (groupId) this.ensureGroup(groupId);
    t.groupId = groupId;
    this.routeTrack(t);
    this.applyMixLevels();
  }

  updateGroupMix(groupId: string, volume: number, muted: boolean, solo: boolean) {
    const g = this.ensureGroup(groupId);
    g.volume = volume;
    g.muted = muted;
    g.solo = solo;
    this.applyMixLevels();
  }

  setGroupPan(groupId: string, pan: number) {
    const g = this.ensureGroup(groupId);
    g.panner.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), this.ctx.currentTime, 0.015);
  }

  updateGroupFx(groupId: string, fx: Partial<ChannelFx>) {
    const g = this.ensureGroup(groupId);
    g.fxSettings = { ...g.fxSettings, ...clampFx(fx) };
    g.fx.apply(g.fxSettings, { smooth: true, bypassAll: this.groupFxCompare.has(groupId) });
  }

  setGroupFxCompare(groupId: string, dry: boolean) {
    if (dry) this.groupFxCompare.add(groupId);
    else this.groupFxCompare.delete(groupId);
    const g = this.groups.get(groupId);
    if (g) g.fx.apply(g.fxSettings, { smooth: true, bypassAll: dry });
  }

  getGroupCompressorReduction(groupId: string): number {
    return this.groups.get(groupId)?.fx.compressor.reduction ?? 0;
  }

  /** A group is gone: its channels go straight to the master. */
  removeGroup(groupId: string) {
    const g = this.groups.get(groupId);
    if (!g) return;
    for (const t of this.tracks.values()) {
      if (t.groupId === groupId) {
        t.groupId = null;
        this.routeTrack(t);
      }
    }
    for (const node of [g.gainNode, g.fx.input, g.fx.output, g.fx.eqCut, g.fx.eqLow, g.fx.eqMid, g.fx.eqHigh, g.fx.compressor, g.panner, g.analyser]) node.disconnect();
    this.groups.delete(groupId);
    this.groupFxCompare.delete(groupId);
    this.applyMixLevels();
  }

  /** Applies (a partial update to) a channel's effects. Values outside range are clamped. */
  updateTrackFx(trackId: string, fx: Partial<ChannelFx>) {
    const t = this.ensureTrack(trackId);
    t.fxSettings = { ...t.fxSettings, ...clampFx(fx) };
    t.fx.apply(t.fxSettings, { smooth: true, bypassAll: this.fxCompare.has(trackId) });
  }

  /** Hear a channel without its effects (a quick before/after) — nothing is changed or saved. */
  setFxCompare(trackId: string, dry: boolean) {
    if (dry) this.fxCompare.add(trackId);
    else this.fxCompare.delete(trackId);
    const t = this.tracks.get(trackId);
    if (t) t.fx.apply(t.fxSettings, { smooth: true, bypassAll: dry });
  }

  /** Sets the master channel (fader, mute, effects). The same settings everyone hears, as saved on the project. */
  setMasterMix(master: MasterMix, mute = false) {
    this.masterSettings = master;
    this.masterMute = mute;
    this.master.apply(master, { smooth: true, dry: this.masterDry, mute });
  }

  /** Hear the song without the master's effects (a quick before/after) — nothing is changed or saved. */
  setMasterCompare(dry: boolean) {
    this.masterDry = dry;
    this.master.apply(this.masterSettings, { smooth: true, dry, mute: this.masterMute });
  }

  /** How many dB the master compressor is pulling the level down right now (0 or negative). */
  getMasterReduction(): number {
    return this.master.fx.compressor.reduction ?? 0;
  }

  /** How many dB the limiter is pulling the level down right now (0 or negative). */
  getLimiterReduction(): number {
    return this.master.limiter.reduction ?? 0;
  }

  /** How many dB the channel's compressor is pulling the level down right now (0 or negative). */
  getCompressorReduction(trackId: string): number {
    return this.tracks.get(trackId)?.fx.compressor.reduction ?? 0;
  }

  /**
   * Replaces the list of clips that plays on a channel. If the song is
   * playing (and we're not mid-recording) it re-schedules from the current
   * position so an edit is heard straight away.
   */
  setTrackClips(trackId: string, clips: ClipData[], opts: { reschedule?: boolean } = {}) {
    this.ensureTrack(trackId).clips = clips;
    if (opts.reschedule !== false && this.playing && !this.recorderNode) this.play(this.getPositionSec());
  }

  private disconnectTrack(t: LoadedTrack) {
    for (const node of [
      t.gainNode,
      t.fx.input,
      t.fx.output,
      t.fx.eqCut,
      t.fx.eqLow,
      t.fx.eqMid,
      t.fx.eqHigh,
      t.fx.compressor,
      t.panner,
      t.analyser,
    ]) {
      node.disconnect();
    }
  }

  removeTrack(trackId: string) {
    const t = this.tracks.get(trackId);
    if (t) this.disconnectTrack(t);
    this.tracks.delete(trackId);
  }

  /** Live level of each channel's own audio — post-fader, so it reflects whatever is actually
   *  audible on that channel right now (a clip playing back, or being monitored while recording
   *  it), not the raw microphone. */
  onTrackLevels(listener: TrackLevelsListener) {
    this.trackLevelListeners.add(listener);
    this.ensureTrackLevelLoop();
    return () => {
      this.trackLevelListeners.delete(listener);
      if (this.trackLevelListeners.size === 0) this.stopTrackLevelLoop();
    };
  }

  private ensureTrackLevelLoop() {
    if (this.trackLevelTimerId != null || this.trackLevelListeners.size === 0) return;
    const data = new Float32Array(512);
    this.trackLevelTimerId = window.setInterval(() => {
      const levels: TrackLevels = {};
      const peaks: TrackLevels = {};
      for (const t of this.tracks.values()) {
        t.analyser.getFloatTimeDomainData(data);
        let sumSquares = 0;
        let peak = 0;
        for (let i = 0; i < data.length; i++) {
          const v = data[i];
          sumSquares += v * v;
          if (Math.abs(v) > peak) peak = Math.abs(v);
        }
        levels[t.trackId] = Math.sqrt(sumSquares / data.length);
        peaks[t.trackId] = peak;
      }
      for (const g of this.groups.values()) {
        g.analyser.getFloatTimeDomainData(data);
        let sumSquares = 0;
        let peak = 0;
        for (let i = 0; i < data.length; i++) {
          sumSquares += data[i] * data[i];
          if (Math.abs(data[i]) > peak) peak = Math.abs(data[i]);
        }
        levels[groupLevelKey(g.groupId)] = Math.sqrt(sumSquares / data.length);
        peaks[groupLevelKey(g.groupId)] = peak;
      }
      for (const [key, analyser] of [[MASTER_LEFT, this.masterAnalysers.left], [MASTER_RIGHT, this.masterAnalysers.right]] as const) {
        analyser.getFloatTimeDomainData(data);
        let sumSquares = 0;
        let peak = 0;
        for (let i = 0; i < data.length; i++) {
          sumSquares += data[i] * data[i];
          if (Math.abs(data[i]) > peak) peak = Math.abs(data[i]);
        }
        levels[key] = Math.sqrt(sumSquares / data.length);
        peaks[key] = peak;
      }
      this.trackLevelListeners.forEach((l) => l(levels, peaks));
    }, this.schedulerIntervalMs);
  }

  private stopTrackLevelLoop() {
    if (this.trackLevelTimerId != null) {
      clearInterval(this.trackLevelTimerId);
      this.trackLevelTimerId = null;
    }
  }

  /** Forget everything about the previously opened song (channels and decoded audio). */
  resetProject() {
    this.pause();
    this.stopTrackLevelLoop();
    for (const t of this.tracks.values()) this.disconnectTrack(t);
    this.tracks.clear();
    for (const id of [...this.groups.keys()]) this.removeGroup(id);
    this.groupFxCompare.clear();
    this.takeBuffers.clear();
    this.startedAtPositionSec = 0;
  }

  /** -1 (hard left) … +1 (hard right). */
  setTrackPan(trackId: string, pan: number) {
    const t = this.ensureTrack(trackId);
    t.panner.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), this.ctx.currentTime, 0.015);
  }

  updateTrackMix(trackId: string, volume: number, muted: boolean, solo: boolean) {
    const t = this.ensureTrack(trackId);
    t.volume = volume;
    t.muted = muted;
    t.solo = solo;
    this.applyMixLevels();
  }

  private applyMixLevels() {
    const levels = resolveMix(
      [...this.tracks.values()].map((t) => ({ id: t.trackId, groupId: t.groupId, volume: t.volume, muted: t.muted, solo: t.solo })),
      [...this.groups.values()].map((g) => ({ id: g.groupId, volume: g.volume, muted: g.muted, solo: g.solo }))
    );
    for (const t of this.tracks.values()) t.gainNode.gain.value = levels.tracks[t.trackId] ?? 0;
    for (const g of this.groups.values()) g.gainNode.gain.value = levels.groups[g.groupId] ?? 0;
  }

  /** How long the song is: the end of the last clip on any channel. */
  getProjectDurationSec() {
    let max = 0;
    for (const t of this.tracks.values()) max = Math.max(max, clipsEnd(t.clips));
    return max;
  }

  getPositionSec() {
    if (!this.playing) return this.startedAtPositionSec;
    return positionWithLoop(this.startedAtPositionSec, Math.max(0, this.ctx.currentTime - this.startedAtCtxTime), this.activeLoop);
  }

  /**
   * Starts playback from `fromSec`.
   *
   * With `countInBeats`, that many clicks (at the song tempo) sound first and
   * the song itself begins right after the last one — the standard "1, 2, 3, 4"
   * before recording. Returns how long until the song position starts moving.
   */
  play(fromSec?: number, opts: { countInBeats?: number } = {}): { startsInSec: number; countInSec: number } {
    this.stopSources();
    const start = fromSec ?? this.startedAtPositionSec;
    const beatSec = 60 / this.bpm;
    const countInBeats = Math.max(0, Math.floor(opts.countInBeats ?? 0));
    const countInSec = countInBeats * beatSec;
    // One shared, slightly-future start time: every channel source and every
    // click is scheduled relative to this single audio-clock instant, so they
    // begin on the same sample instead of whenever each call happened to run.
    const t0 = this.ctx.currentTime + this.startLeadSec + countInSec;
    this.startedAtPositionSec = start;
    this.startedAtCtxTime = t0;
    this.playing = true;
    if (this.recorderNode) this.recordingAnchor = { ctxTime: t0, position: start };

    // Count-in: the last click lands exactly one beat before t0, so the song
    // (and the ongoing click, if on) picks up on the very next beat.
    for (let i = 0; i < countInBeats; i++) {
      this.scheduleClick(t0 - (countInBeats - i) * beatSec, i % this.beatsPerBar === 0, "countin");
    }

    // A loop (when one is set and this play starts before its end) is scheduled
    // one pass at a time on the same audio clock; otherwise everything is
    // scheduled once, as before.
    this.activeLoop = !this.recorderNode && loopApplies(this.loopRegion, start) ? this.loopRegion : null;
    if (this.activeLoop) {
      this.loopNextPass = { from: start, to: this.activeLoop.endSec, ctxStart: t0 };
      this.pumpLoop();
      this.loopTimerId = window.setInterval(() => this.pumpLoop(), this.schedulerIntervalMs);
      this.tick();
      return { startsInSec: t0 - this.ctx.currentTime, countInSec };
    }
    this.scheduleRange(start, Infinity, t0);
    this.tick();
    if (this.metronomeEnabled) this.restartMetronomeScheduler();
    return { startsInSec: t0 - this.ctx.currentTime, countInSec };
  }

  /**
   * Schedules everything heard between song positions [from, to) so that
   * `from` lands at audio-clock time `ctxStart`: each channel's audible pieces
   * (clipped to the range) and, if the click is on, the beats inside it.
   */
  private scheduleRange(from: number, to: number, ctxStart: number) {
    for (const t of this.tracks.values()) {
      for (const seg of audibleSegments(t.clips)) {
        const buffer = this.takeBuffers.get(seg.takeId);
        if (!buffer) continue;
        const segFrom = Math.max(seg.startSec, from);
        const segTo = Math.min(seg.endSec, to);
        if (segTo <= segFrom) continue;
        const source = scheduleSegment(this.ctx, t.gainNode, buffer, ctxStart + (segFrom - from), seg.sourceStartSec + (segFrom - seg.startSec), segTo - segFrom, { seg, fromSec: segFrom });
        this.sources.push(source);
        source.onended = () => {
          this.sources = this.sources.filter((s) => s !== source);
        };
      }
    }
    // In a loop the click is scheduled per pass too (the normal scheduler walks a straight timeline).
    if (this.activeLoop && this.metronomeEnabled) {
      const beat = 60 / this.bpm;
      for (let k = Math.ceil(from / beat - 1e-9); k * beat < to - 1e-9; k++) {
        this.scheduleClick(ctxStart + (k * beat - from), k % this.beatsPerBar === 0, "grid");
      }
    }
  }

  /** Keeps the next loop passes scheduled a little ahead of the audio clock. */
  private pumpLoop() {
    const loop = this.activeLoop;
    if (!loop || !this.loopNextPass) return;
    const horizon = this.ctx.currentTime + this.scheduleAheadSec;
    for (let guard = 0; this.loopNextPass.ctxStart < horizon && guard < 64; guard++) {
      const pass = this.loopNextPass;
      this.scheduleRange(pass.from, pass.to, pass.ctxStart);
      this.loopNextPass = nextLoopPass(pass, loop);
    }
  }

  private stopLoopScheduler() {
    if (this.loopTimerId != null) {
      clearInterval(this.loopTimerId);
      this.loopTimerId = null;
    }
    this.loopNextPass = null;
  }

  /** Sets (or clears, with null) the loop region. If the song is playing it picks the change up straight away. */
  setLoop(region: LoopRegion | null) {
    this.loopRegion = region && region.endSec - region.startSec >= MIN_LOOP_SEC ? region : null;
    if (this.playing && !this.recorderNode) this.play(this.getPositionSec());
  }

  pause() {
    this.startedAtPositionSec = this.getPositionSec();
    this.playing = false;
    this.stopSources();
    this.activeLoop = null;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.stopMetronomeScheduler();
    this.emit();
  }

  seek(sec: number) {
    const wasPlaying = this.playing;
    this.stopSources();
    this.startedAtPositionSec = Math.max(0, sec);
    this.startedAtCtxTime = this.ctx.currentTime;
    if (wasPlaying) this.play(this.startedAtPositionSec);
    else this.emit();
  }

  private cancelClicks(which: { grid?: boolean; countIn?: boolean }) {
    const groups = [];
    if (which.grid) groups.push(this.pendingGridClicks);
    if (which.countIn) groups.push(this.pendingCountInClicks);
    for (const group of groups) {
      for (const osc of group) {
        try {
          osc.stop();
        } catch {
          // already finished
        }
      }
      group.clear();
    }
  }

  private stopSources() {
    this.stopLoopScheduler();
    this.cancelClicks({ grid: true, countIn: true });
    for (const src of this.sources) {
      try {
        src.stop();
      } catch {
        // already stopped
      }
    }
    this.sources = [];
  }

  private tick = () => {
    if (!this.playing) return;
    const dur = this.getProjectDurationSec();
    // A recording may run past the last clip; the song only ends by itself when nothing is being recorded.
    if (!this.activeLoop && !this.recorderNode && dur > 0 && this.getPositionSec() >= dur) {
      this.pause();
      this.startedAtPositionSec = 0;
      this.emit();
      return;
    }
    this.emit();
    this.rafId = requestAnimationFrame(this.tick);
  };

  private async ensureRecorderWorklet(): Promise<void> {
    if (!this.recorderWorkletReady) {
      this.recorderWorkletReady = this.ctx.audioWorklet.addModule(pcmRecorderWorkletUrl);
    }
    await this.recorderWorkletReady;
  }

  /**
   * Captures raw, uncompressed Float32 PCM straight off the input — no
   * MediaRecorder, no codec (Opus/AAC), no lossy re-encoding. What you play
   * is exactly what gets written to the take (as 32-bit float WAV on stop).
   *
   * @param deviceId  A specific input device (mic or audio interface) to
   *                  record from, or undefined/"default" for the system default.
   * @param channelIndex  For multi-channel interfaces, isolate one input
   *                      channel (0-based: Ch 1 = 0, Ch 2 = 1, ...). Leave
   *                      undefined to record the device's default mix (any
   *                      stereo signal is downmixed to mono, matching the
   *                      one-line-per-track model).
   */
  /** Set when the microphone's sample rate differs from the audio context's — the browser then converts between them, which can leave clicks. */
  private captureRateMismatch: { inputHz: number; contextHz: number } | null = null;

  getCaptureRateMismatch() {
    return this.captureRateMismatch;
  }

  async startRecording(deviceId?: string | null, channelIndex?: number | null): Promise<void> {
    const audioConstraints = buildAudioConstraints(deviceId, channelIndex);
    const rawStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
    this.rawInputStream = rawStream;
    // Chrome reports the input device's own latency (seconds) when it knows it.
    this.recorderInputLatencySec = rawStream.getAudioTracks()[0]?.getSettings().latency ?? 0;
    const inputHz = rawStream.getAudioTracks()[0]?.getSettings().sampleRate;
    this.captureRateMismatch = inputHz && Math.abs(inputHz - this.ctx.sampleRate) > 1 ? { inputHz, contextHz: this.ctx.sampleRate } : null;

    await this.ensureRecorderWorklet();

    const source = this.ctx.createMediaStreamSource(rawStream);
    this.recorderSource = source;
    let recordSource: AudioNode = source;

    if (channelIndex != null) {
      const availableChannels = rawStream.getAudioTracks()[0]?.getSettings().channelCount ?? 1;
      if (channelIndex < availableChannels) {
        const splitter = this.ctx.createChannelSplitter(Math.max(2, availableChannels));
        const merger = this.ctx.createChannelMerger(1);
        source.connect(splitter);
        splitter.connect(merger, channelIndex, 0);
        this.channelGraph = { source, splitter, merger };
        recordSource = merger;
      }
    }

    // Explicit mono downmix (Web Audio's standard equal-power mix) so a
    // stereo default mic doesn't silently drop one channel — the worklet
    // itself always deals with a single channel.
    const monoGain = this.ctx.createGain();
    monoGain.channelCount = 1;
    monoGain.channelCountMode = "explicit";
    monoGain.channelInterpretation = "speakers";
    recordSource.connect(monoGain);
    this.recorderMonoGain = monoGain;

    const workletNode = new AudioWorkletNode(this.ctx, "pcm-recorder-processor", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
    });
    this.recorderChunks = [];
    this.resetLivePeaks();
    this.recorderSampleRate = this.ctx.sampleRate;
    this.recorderStartFrame = null;
    this.recordingAnchor = null;
    workletNode.port.onmessage = (event: MessageEvent<Float32Array | { type: string; frame?: number }>) => {
      const data = event.data;
      if (data instanceof Float32Array) {
        this.recorderChunks.push(data);
        this.addLivePeaks(data);
      } else if (data?.type === "start") {
        this.recorderStartFrame = data.frame ?? null;
      } else if (data?.type === "flush-done") {
        this.flushResolver?.();
      }
    };
    monoGain.connect(workletNode);

    // AudioWorkletNodes only process while part of an active graph reaching
    // the destination; route through a silent gain so nothing is audible.
    const silentGain = this.ctx.createGain();
    silentGain.gain.value = 0;
    workletNode.connect(silentGain);
    silentGain.connect(this.ctx.destination);

    this.recorderNode = workletNode;
    this.recorderSilentGain = silentGain;
    this.startRecordingMeter();
  }

  /**
   * The input meter while recording is driven by the recording itself (the samples we are keeping),
   * so it always matches what is being captured — a second microphone stream for the meter can fall
   * silent while the recorder holds the device. Rises instantly, falls smoothly.
   */
  private startRecordingMeter() {
    this.stopRecordingMeter();
    const loop = () => {
      this.recMeterLevel = Math.max(this.liveLastRms, this.recMeterLevel * 0.88);
      const peak = this.recPeakSinceFrame; // the loudest sample since the last frame, so a short peak is never missed
      this.recPeakSinceFrame = 0;
      this.levelListeners.forEach((l) => l(this.recMeterLevel, peak));
      this.recMeterRaf = requestAnimationFrame(loop);
    };
    this.recMeterRaf = requestAnimationFrame(loop);
  }

  private stopRecordingMeter() {
    if (this.recMeterRaf === null) return;
    cancelAnimationFrame(this.recMeterRaf);
    this.recMeterRaf = null;
    this.levelListeners.forEach((l) => l(0, 0));
  }

  private resetLivePeaks() {
    this.livePeakCount = 0;
    this.liveBinFill = 0;
    this.liveBinMin = 0;
    this.liveBinMax = 0;
    this.liveBinSumSq = 0;
    this.liveLastRms = 0;
    this.recMeterLevel = 0;
    this.recPeakSinceFrame = 0;
    this.liveLastChunkAt = performance.now();
  }

  private addLivePeaks(chunk: Float32Array) {
    this.liveLastChunkAt = performance.now();
    for (let i = 0; i < chunk.length; i++) {
      const v = chunk[i];
      if (v < this.liveBinMin) this.liveBinMin = v;
      if (v > this.liveBinMax) this.liveBinMax = v;
      this.liveBinSumSq += v * v;
      if (Math.abs(v) > this.recPeakSinceFrame) this.recPeakSinceFrame = Math.abs(v);
      if (++this.liveBinFill >= LIVE_BIN) {
        this.liveLastRms = Math.sqrt(this.liveBinSumSq / LIVE_BIN);
        this.liveBinSumSq = 0;
        if (this.livePeakCount + 2 > this.livePeaks.length) {
          const bigger = new Float32Array(this.livePeaks.length * 2);
          bigger.set(this.livePeaks);
          this.livePeaks = bigger;
        }
        this.livePeaks[this.livePeakCount++] = this.liveBinMin;
        this.livePeaks[this.livePeakCount++] = this.liveBinMax;
        this.liveBinFill = 0;
        this.liveBinMin = 0;
        this.liveBinMax = 0;
      }
    }
  }

  /**
   * The take as it stands right now, for drawing while recording. Null until the first audio has
   * arrived and the song position it belongs to is known. Placement uses exactly the maths the
   * finished take uses, so the drawing sits where the clip will land.
   */
  getLiveRecording(): LiveRecording | null {
    const anchor = this.recordingAnchor;
    if (!this.recorderNode || !anchor || this.recorderStartFrame === null) return null;
    const rate = this.recorderSampleRate || this.ctx.sampleRate;
    const placement = computeTakePlacement({
      anchorPositionSec: anchor.position,
      anchorCtxSec: anchor.ctxTime,
      captureStartCtxSec: this.recorderStartFrame / rate,
      latencySec: this.effectiveLatencySec(),
      sampleRate: rate,
      earliestPositionSec: anchor.position,
    });
    // Anything captured before the song started (the count-in) is dropped from the final take too.
    const skipBins = Math.ceil(placement.dropSamples / LIVE_BIN);
    const startSec = placement.offsetSec + (skipBins * LIVE_BIN - placement.dropSamples) / rate;
    const firstFloat = Math.min(this.livePeakCount, skipBins * 2);
    const dataSec = ((this.livePeakCount - firstFloat) / 2) * (LIVE_BIN / rate);
    const sinceChunk = Math.min(0.03, (performance.now() - this.liveLastChunkAt) / 1000);
    return {
      startSec,
      binSec: LIVE_BIN / rate,
      peaks: this.livePeaks.subarray(firstFloat, this.livePeakCount),
      dataSec,
      tipSec: dataSec + sinceChunk,
    };
  }

  private releaseCaptureGraph() {
    this.stopRecordingMeter();
    this.rawInputStream?.getTracks().forEach((t) => t.stop());
    this.rawInputStream = null;
    this.recorderSource?.disconnect();
    this.recorderSource = null;
    this.recorderMonoGain?.disconnect();
    this.recorderMonoGain = null;
    this.recorderSilentGain?.disconnect();
    this.recorderSilentGain = null;
    if (this.channelGraph) {
      this.channelGraph.source.disconnect();
      this.channelGraph.splitter.disconnect();
      this.channelGraph.merger.disconnect();
      this.channelGraph = null;
    }
    this.recorderNode = null;
  }

  /** Stops the capture and returns the raw samples plus the audio-clock frame of sample 0. */
  private async stopCapture(): Promise<{ samples: Float32Array; sampleRate: number; startFrame: number | null } | null> {
    const node = this.recorderNode;
    if (!node) {
      this.releaseCaptureGraph();
      return null;
    }

    await new Promise<void>((resolve) => {
      this.flushResolver = resolve;
      node.port.postMessage({ type: "flush" });
    });
    this.flushResolver = null;
    node.port.onmessage = null;
    node.disconnect();
    this.releaseCaptureGraph();

    const totalLength = this.recorderChunks.reduce((sum, c) => sum + c.length, 0);
    const samples = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of this.recorderChunks) {
      samples.set(chunk, offset);
      offset += chunk.length;
    }
    this.recorderChunks = [];
    return { samples, sampleRate: this.recorderSampleRate || this.ctx.sampleRate, startFrame: this.recorderStartFrame };
  }

  /**
   * Ends the take. Returns the lossless WAV plus where it belongs on the song
   * timeline: `timelineOffsetSec` already accounts for when capture began
   * relative to playback, where in the song recording started, and the
   * round-trip latency — so the performance lines up with the click and the
   * other channels instead of landing late.
   */
  async stopRecording(): Promise<RecordingResult> {
    const anchor = this.recordingAnchor;
    const capture = await this.stopCapture();
    this.recordingAnchor = null;
    if (!capture || capture.samples.length === 0) {
      return { blob: new Blob(), timelineOffsetSec: 0, latencySec: 0, durationSec: 0 };
    }

    let samples = capture.samples;
    let timelineOffsetSec = 0;
    const latencySec = this.effectiveLatencySec();

    if (anchor && capture.startFrame !== null) {
      const placement = computeTakePlacement({
        anchorPositionSec: anchor.position,
        anchorCtxSec: anchor.ctxTime,
        captureStartCtxSec: capture.startFrame / capture.sampleRate,
        latencySec,
        sampleRate: capture.sampleRate,
        earliestPositionSec: anchor.position,
      });
      timelineOffsetSec = placement.offsetSec;
      if (placement.dropSamples > 0) samples = samples.subarray(Math.min(placement.dropSamples, samples.length));
    }

    // Stopped during the count-in (or immediately after): nothing worth keeping.
    if (samples.length < capture.sampleRate * 0.05) {
      return { blob: new Blob(), timelineOffsetSec: 0, latencySec, durationSec: 0 };
    }

    const buffer = this.ctx.createBuffer(1, Math.max(1, samples.length), capture.sampleRate);
    buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
    return { blob: encodeWavFloat32(buffer), timelineOffsetSec, latencySec, durationSec: buffer.duration };
  }

  /**
   * Measures real round-trip latency: plays a few sharp clicks through the
   * speakers, records them back through the selected input, and times the
   * gap. Needs the mic to actually hear the speakers — with headphones it
   * hears nothing, and this returns `null` rather than guessing.
   */
  async measureRoundTripLatency(deviceId?: string | null, channelIndex?: number | null): Promise<CalibrationResult> {
    await this.resume();
    await this.startRecording(deviceId, channelIndex);

    const lead = 0.6; // quiet lead-in used to learn the room's noise floor
    const spacing = 0.5;
    const count = 6;
    const startedAt = this.ctx.currentTime + 0.3;
    const clickTimes = Array.from({ length: count }, (_, i) => startedAt + lead + i * spacing);

    const out = this.ctx.createGain();
    out.gain.value = 0.9;
    out.connect(this.ctx.destination);
    for (const time of clickTimes) {
      const osc = this.ctx.createOscillator();
      const env = this.ctx.createGain();
      osc.frequency.value = 1500;
      env.gain.setValueAtTime(0.0001, time);
      env.gain.exponentialRampToValueAtTime(1, time + 0.002);
      env.gain.exponentialRampToValueAtTime(0.0001, time + 0.04);
      osc.connect(env);
      env.connect(out);
      osc.start(time);
      osc.stop(time + 0.05);
    }

    const waitMs = (startedAt + lead + count * spacing + 0.6 - this.ctx.currentTime) * 1000;
    await new Promise((r) => setTimeout(r, Math.max(0, waitMs)));

    const capture = await this.stopCapture();
    out.disconnect();
    if (!capture || capture.startFrame === null || capture.samples.length === 0) {
      return { latencySec: null, reason: "No audio was captured — check microphone access." };
    }

    const captureStartCtx = capture.startFrame / capture.sampleRate;
    const expected = clickTimes.map((t) => t - captureStartCtx);
    const summary = summarizeLatencies(measureClickLatencies(capture.samples, capture.sampleRate, expected));
    if (summary.latencySec === null) {
      return {
        latencySec: null,
        reason:
          summary.heardCount < 3
            ? "The microphone didn't hear the clicks. Calibration needs speakers (not headphones) with the mic in the room — or enter the delay by hand."
            : "The clicks arrived at inconsistent times, so the result can't be trusted. Try again in a quieter room.",
      };
    }
    return { latencySec: summary.latencySec, reason: null };
  }

  onLevel(listener: LevelListener) {
    this.levelListeners.add(listener);
    return () => this.levelListeners.delete(listener);
  }

  /** Starts a silent, continuous meter on the given device/channel. Safe to
   *  call again to switch inputs — the previous monitor stream is torn down. */
  async startMonitoring(deviceId?: string | null, channelIndex?: number | null): Promise<void> {
    // stopMonitoring() bumps monitorGeneration itself, so our own id must be
    // read AFTER calling it — reading it first meant every call invalidated
    // itself immediately (the stale-call guard below always tripped), and the
    // stream was thrown away before the analyser was ever created.
    this.stopMonitoring();
    const generation = ++this.monitorGeneration;
    // The audio clock starts "suspended" until something resumes it. Without
    // this, the analyser sees only silence — the mic stream is fine, nothing
    // is just flowing through it yet — until Play or Record is pressed once.
    await this.resume();

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: buildAudioConstraints(deviceId, channelIndex),
    });

    // Another startMonitoring/stopMonitoring call landed while we were
    // awaiting permission — discard this stream instead of leaking it.
    if (generation !== this.monitorGeneration) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    this.monitorStream = stream;
    const source = this.ctx.createMediaStreamSource(stream);
    this.monitorSource = source;
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 512;
    this.monitorAnalyser = analyser;

    if (channelIndex != null) {
      const availableChannels = stream.getAudioTracks()[0]?.getSettings().channelCount ?? 1;
      if (channelIndex < availableChannels) {
        const splitter = this.ctx.createChannelSplitter(Math.max(2, availableChannels));
        this.monitorSplitter = splitter;
        source.connect(splitter);
        splitter.connect(analyser, channelIndex, 0);
      } else {
        source.connect(analyser);
      }
    } else {
      source.connect(analyser);
    }
    // Intentionally not connected to masterGain/destination — this is a
    // silent meter, not live monitoring through speakers (would cause echo).

    const data = new Float32Array(analyser.fftSize);
    const loop = () => {
      if (generation !== this.monitorGeneration) return;
      analyser.getFloatTimeDomainData(data);
      let sumSquares = 0;
      let peak = 0;
      for (let i = 0; i < data.length; i++) {
        const v = data[i];
        sumSquares += v * v;
        if (Math.abs(v) > peak) peak = Math.abs(v);
      }
      const rms = Math.sqrt(sumSquares / data.length);
      if (!this.recorderNode) this.levelListeners.forEach((l) => l(rms, peak)); // while recording, the recording drives the meter
      this.monitorRafId = requestAnimationFrame(loop);
    };
    loop();
  }

  stopMonitoring() {
    this.monitorGeneration++;
    if (this.monitorRafId) cancelAnimationFrame(this.monitorRafId);
    this.monitorRafId = null;
    this.monitorSource?.disconnect();
    this.monitorSplitter?.disconnect();
    this.monitorAnalyser?.disconnect();
    this.monitorStream?.getTracks().forEach((t) => t.stop());
    this.monitorStream = null;
    this.monitorSource = null;
    this.monitorSplitter = null;
    this.monitorAnalyser = null;
    this.levelListeners.forEach((l) => l(0, 0));
  }

  setBeatsPerBar(beatsPerBar: number) {
    this.beatsPerBar = Math.max(1, Math.round(beatsPerBar));
    if (this.activeLoop && this.playing) this.play(this.getPositionSec());
    else if (this.metronomeEnabled && this.playing) this.restartMetronomeScheduler();
  }

  setBpm(bpm: number) {
    this.bpm = bpm;
    if (this.activeLoop && this.playing) this.play(this.getPositionSec());
    else if (this.metronomeEnabled && this.playing) this.restartMetronomeScheduler();
  }

  setMetronomeEnabled(enabled: boolean) {
    this.metronomeEnabled = enabled;
    // In a loop the click is scheduled with each pass, so it just takes effect from the next pass.
    if (this.activeLoop) return;
    if (enabled && this.playing) this.restartMetronomeScheduler();
    else this.stopMetronomeScheduler();
  }

  /** 0..1. Output-only — never affects what gets recorded. */
  setMetronomeVolume(volume: number) {
    this.metronomeVolume = Math.min(1, Math.max(0, volume));
    this.clickGain.gain.value = this.metronomeVolume;
  }

  /** One click at the current click volume, for the Settings "Test" button. Works while stopped. */
  async playTestClick() {
    await this.resume();
    this.scheduleClick(this.ctx.currentTime + 0.02, true, "grid");
  }

  private restartMetronomeScheduler() {
    this.stopMetronomeScheduler();
    const beatDurationSec = 60 / this.bpm;
    this.nextClickBeatIndex = Math.ceil(this.getPositionSec() / beatDurationSec);
    this.metronomeTimerId = window.setInterval(() => this.metronomeSchedulerTick(), this.schedulerIntervalMs);
  }

  private stopMetronomeScheduler() {
    if (this.metronomeTimerId != null) {
      clearInterval(this.metronomeTimerId);
      this.metronomeTimerId = null;
    }
    this.cancelClicks({ grid: true });
  }

  private contextTimeForPosition(posSec: number) {
    return this.startedAtCtxTime + (posSec - this.startedAtPositionSec);
  }

  private metronomeSchedulerTick() {
    const beatDurationSec = 60 / this.bpm;
    while (this.contextTimeForPosition(this.nextClickBeatIndex * beatDurationSec) < this.ctx.currentTime + this.scheduleAheadSec) {
      const beatTimeCtx = this.contextTimeForPosition(this.nextClickBeatIndex * beatDurationSec);
      const accent = this.nextClickBeatIndex % this.beatsPerBar === 0;
      this.scheduleClick(beatTimeCtx, accent, "grid");
      this.nextClickBeatIndex++;
    }
  }

  private scheduleClick(time: number, accent: boolean, kind: "grid" | "countin") {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.frequency.value = accent ? 1600 : 900;
    gain.gain.setValueAtTime(0.0001, time);
    // The first beat of a bar is higher and louder, so a count-in (and the click) has its "ONE, two, three, four" feel.
    gain.gain.exponentialRampToValueAtTime(accent ? 1 : 0.5, time + 0.001);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
    osc.connect(gain);
    gain.connect(this.clickGain);
    const pending = kind === "grid" ? this.pendingGridClicks : this.pendingCountInClicks;
    pending.add(osc);
    osc.onended = () => pending.delete(osc);
    osc.start(time);
    osc.stop(time + 0.06);
  }

  destroy() {
    this.stopSources();
    this.stopMonitoring();
    this.stopMetronomeScheduler();
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.listeners.clear();
    this.levelListeners.clear();
    this.clickAudioEl?.pause();
    if (this.clickAudioEl) this.clickAudioEl.srcObject = null;
    this.ctx.close();
  }
}
