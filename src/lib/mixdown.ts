import type { Project } from "../types/project";
import { audibleSegments } from "./clips";
import { scheduleSegment } from "./segmentPlayback";
import { encodeWavFloat32 } from "./wav";
import { createFxChain } from "./fxChain";
import { createReverbImpulse, fxTailSec } from "./channelFx";

/**
 * Renders the FINAL mix — the one the initiator saved: each channel's saved
 * volume, mute, pan and effects, clips placed and overlapped exactly as in live playback.
 * Solo is a listening aid and is never part of the final mix.
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

  const audibleTracks = project.tracks.filter((t) => !t.muted && t.clips.length > 0);
  const segmentsByTrack = audibleTracks.map((t) => ({ track: t, segments: audibleSegments(t.clips) }));

  let totalDuration = 0.01;
  for (const { segments } of segmentsByTrack) {
    for (const seg of segments) totalDuration = Math.max(totalDuration, seg.endSec);
  }
  // Let echoes and reverb ring out after the last note instead of cutting them off.
  const tail = audibleTracks.reduce((max, t) => Math.max(max, fxTailSec(t.fx)), 0);
  totalDuration += tail;

  const sampleRate = 48000;
  const offlineCtx = new OfflineAudioContext(2, Math.ceil(totalDuration * sampleRate), sampleRate);

  const impulse = createReverbImpulse(offlineCtx);
  for (const { track, segments } of segmentsByTrack) {
    const gain = offlineCtx.createGain();
    gain.gain.value = track.volume;
    const panner = offlineCtx.createStereoPanner();
    panner.pan.value = track.pan;
    const fx = createFxChain(offlineCtx, impulse);
    fx.apply(track.fx);
    gain.connect(fx.input);
    fx.output.connect(panner);
    panner.connect(offlineCtx.destination);
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
