import type { Project } from "../types/project";
import { audibleSegments } from "./clips";
import { scheduleSegment } from "./segmentPlayback";
import { encodeWavFloat32 } from "./wav";
import { createFxChain } from "./fxChain";
import { createReverbImpulse, fxTailSec } from "./channelFx";
import { createMasterChain } from "./masterChain";

/**
 * Renders the FINAL mix — the one the initiator saved: each channel's saved
 * volume, mute, pan and effects, clips placed and overlapped exactly as in live playback.
 * Solo is a listening aid and is never part of the final mix. The master channel (fader, EQ,
 * compressor, limiter) is part of it; the master's mute is personal and never saved, so an export is never silent.
 *
 * Takes must already have their audio downloaded (see hydrateTakeBlobs).
 */
export async function renderMix(project: Project): Promise<AudioBuffer> {
  return renderMixFromBuffers(project, await decodeTakes(project), 48000);
}

/** Decodes every downloaded recording of the project (see hydrateTakeBlobs), by take id. */
export async function decodeTakes(project: Project): Promise<Map<string, AudioBuffer>> {
  const decodeCtx = new AudioContext();
  const buffers = new Map<string, AudioBuffer>();
  for (const take of Object.values(project.takes)) {
    if (!take.blob) continue;
    buffers.set(take.id, await decodeCtx.decodeAudioData(await take.blob.arrayBuffer()));
  }
  await decodeCtx.close();
  return buffers;
}

/** Extra choices for a render. All optional; none changes what the saved final mix sounds like. */
export interface RenderOptions {
  /** Render only this channel as it leaves its own fader, effects and pan (a "stem"): not through its group, not through the master, muted or not. */
  onlyTrackId?: string;
  /** Volume and mute per channel to use instead of the saved ones (a player's own monitor mix). */
  trackMix?: Record<string, { volume: number; muted: boolean }>;
  /** Make the file at least this long, so every file of one download has the same length and lines up from the start. */
  minDurationSec?: number;
}

/** How long a file must be to hold every channel with recordings, muted or not, plus the echoes and reverb after the last note. */
export function projectLengthSec(project: Project): number {
  let end = 0.01;
  for (const t of project.tracks) for (const seg of audibleSegments(t.clips)) end = Math.max(end, seg.endSec);
  const withClips = project.tracks.filter((t) => t.clips.length > 0);
  const tail = Math.max(
    withClips.reduce((max, t) => Math.max(max, fxTailSec(t.fx)), 0),
    project.groups.reduce((max, g) => Math.max(max, fxTailSec(g.fx)), 0)
  );
  return end + tail + 0.1;
}

/**
 * The same render from recordings that are already decoded, at any sample rate. The master channel's waveform uses
 * it at a low rate (cheap, enough to draw); the export uses it at 48 kHz.
 */
export async function renderMixFromBuffers(
  project: Project,
  buffers: Map<string, AudioBuffer>,
  sampleRate: number,
  /** Only this group's channels, heard as they leave the group (fader, effects, pan) and not through the master: the group channel's own waveform. */
  onlyGroupId?: string,
  opts: RenderOptions = {}
): Promise<AudioBuffer> {
  const groupOf = (trackGroupId: string | null) => (trackGroupId ? project.groups.find((g) => g.id === trackGroupId) : undefined);
  // A muted channel, or a channel in a muted group, is left out (solo is never part of the final mix).
  const mixOf = (t: { id: string; volume: number; muted: boolean }) => opts.trackMix?.[t.id] ?? { volume: t.volume, muted: t.muted };
  const audibleTracks = project.tracks.filter((t) => {
    if (t.clips.length === 0) return false;
    if (opts.onlyTrackId) return t.id === opts.onlyTrackId;
    return !mixOf(t).muted && !groupOf(t.groupId)?.muted && (!onlyGroupId || t.groupId === onlyGroupId);
  });
  const segmentsByTrack = audibleTracks.map((t) => ({ track: t, segments: audibleSegments(t.clips) }));

  let totalDuration = 0.01;
  for (const { segments } of segmentsByTrack) {
    for (const seg of segments) totalDuration = Math.max(totalDuration, seg.endSec);
  }
  // Let echoes and reverb ring out after the last note instead of cutting them off.
  const usedGroups = opts.onlyTrackId ? [] : project.groups.filter((g) => audibleTracks.some((t) => t.groupId === g.id));
  const tail = Math.max(
    audibleTracks.reduce((max, t) => Math.max(max, fxTailSec(t.fx)), 0),
    usedGroups.reduce((max, g) => Math.max(max, fxTailSec(g.fx)), 0)
  );
  totalDuration += tail + 0.1; // a little room for the limiter's release
  totalDuration = Math.max(totalDuration, opts.minDurationSec ?? 0);

  const offlineCtx = new OfflineAudioContext(2, Math.ceil(totalDuration * sampleRate), sampleRate);

  const impulse = createReverbImpulse(offlineCtx);
  // Every channel goes through the master, as in live playback. (The master's mute is personal, so an export is never silent.)
  const bypassMaster = !!onlyGroupId || !!opts.onlyTrackId;
  const master = bypassMaster ? passThrough(offlineCtx) : createMasterChain(offlineCtx);
  if (!bypassMaster) (master as ReturnType<typeof createMasterChain>).apply(project.master);
  master.output.connect(offlineCtx.destination);
  // Each used group: its fader -> effects -> pan -> master, like a channel.
  const groupInput = new Map<string, GainNode>();
  for (const g of usedGroups) {
    const gain = offlineCtx.createGain();
    gain.gain.value = g.volume;
    const fx = createFxChain(offlineCtx, impulse);
    fx.apply(g.fx);
    const panner = offlineCtx.createStereoPanner();
    panner.pan.value = g.pan;
    gain.connect(fx.input);
    fx.output.connect(panner);
    panner.connect(master.input);
    groupInput.set(g.id, gain);
  }
  for (const { track, segments } of segmentsByTrack) {
    const gain = offlineCtx.createGain();
    gain.gain.value = mixOf(track).volume;
    const panner = offlineCtx.createStereoPanner();
    panner.pan.value = track.pan;
    const fx = createFxChain(offlineCtx, impulse);
    fx.apply(track.fx);
    gain.connect(fx.input);
    fx.output.connect(panner);
    panner.connect((track.groupId && !opts.onlyTrackId ? groupInput.get(track.groupId) : undefined) ?? master.input);
    for (const seg of segments) {
      const buffer = buffers.get(seg.takeId);
      if (!buffer) continue;
      scheduleSegment(offlineCtx, gain, buffer, seg.startSec, seg.sourceStartSec, seg.endSec - seg.startSec, { seg, fromSec: seg.startSec });
    }
  }

  return offlineCtx.startRendering();
}

/** Stands in for the master when a group's own sound is rendered: the signal goes straight out. */
function passThrough(ctx: BaseAudioContext): { input: AudioNode; output: AudioNode } {
  const gain = ctx.createGain();
  return { input: gain, output: gain };
}

/** The final mix as a lossless WAV file. */
export async function mixdownProject(project: Project): Promise<Blob> {
  return encodeWavFloat32(await renderMix(project));
}
