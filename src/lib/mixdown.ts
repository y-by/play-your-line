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
  const decodeCtx = new AudioContext();
  const buffers = new Map<string, AudioBuffer>();
  for (const take of Object.values(project.takes)) {
    if (!take.blob) continue;
    buffers.set(take.id, await decodeCtx.decodeAudioData(await take.blob.arrayBuffer()));
  }
  await decodeCtx.close();
  return renderMixFromBuffers(project, buffers, 48000);
}

/**
 * The same render from recordings that are already decoded, at any sample rate. The master channel's waveform uses
 * it at a low rate (cheap, enough to draw); the export uses it at 48 kHz.
 */
export async function renderMixFromBuffers(project: Project, buffers: Map<string, AudioBuffer>, sampleRate: number): Promise<AudioBuffer> {
  const audibleTracks = project.tracks.filter((t) => !t.muted && t.clips.length > 0);
  const segmentsByTrack = audibleTracks.map((t) => ({ track: t, segments: audibleSegments(t.clips) }));

  let totalDuration = 0.01;
  for (const { segments } of segmentsByTrack) {
    for (const seg of segments) totalDuration = Math.max(totalDuration, seg.endSec);
  }
  // Let echoes and reverb ring out after the last note instead of cutting them off.
  const tail = audibleTracks.reduce((max, t) => Math.max(max, fxTailSec(t.fx)), 0);
  totalDuration += tail + 0.1; // a little room for the limiter's release

  const offlineCtx = new OfflineAudioContext(2, Math.ceil(totalDuration * sampleRate), sampleRate);

  const impulse = createReverbImpulse(offlineCtx);
  // Every channel goes through the master, as in live playback. (The master's mute is personal, so an export is never silent.)
  const master = createMasterChain(offlineCtx);
  master.apply(project.master);
  master.output.connect(offlineCtx.destination);
  for (const { track, segments } of segmentsByTrack) {
    const gain = offlineCtx.createGain();
    gain.gain.value = track.volume;
    const panner = offlineCtx.createStereoPanner();
    panner.pan.value = track.pan;
    const fx = createFxChain(offlineCtx, impulse);
    fx.apply(track.fx);
    gain.connect(fx.input);
    fx.output.connect(panner);
    panner.connect(master.input);
    for (const seg of segments) {
      const buffer = buffers.get(seg.takeId);
      if (!buffer) continue;
      scheduleSegment(offlineCtx, gain, buffer, seg.startSec, seg.sourceStartSec, seg.endSec - seg.startSec, { seg, fromSec: seg.startSec });
    }
  }

  return offlineCtx.startRendering();
}

/** The final mix as a lossless WAV file. */
export async function mixdownProject(project: Project): Promise<Blob> {
  return encodeWavFloat32(await renderMix(project));
}
