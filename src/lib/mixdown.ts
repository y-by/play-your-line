import type { Project } from "../types/project";
import { audibleSegments } from "./clips";
import { scheduleSegment } from "./segmentPlayback";
import { encodeWavFloat32 } from "./wav";

/**
 * Renders the FINAL mix — the one the initiator saved: each channel's saved
 * volume, mute and pan, clips placed and overlapped exactly as in live playback.
 * Solo is a listening aid and is never part of the final mix.
 *
 * Takes must already have their audio downloaded (see hydrateTakeBlobs).
 */
export async function mixdownProject(project: Project): Promise<Blob> {
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

  const sampleRate = 48000;
  const offlineCtx = new OfflineAudioContext(2, Math.ceil(totalDuration * sampleRate), sampleRate);

  for (const { track, segments } of segmentsByTrack) {
    const gain = offlineCtx.createGain();
    gain.gain.value = track.volume;
    const panner = offlineCtx.createStereoPanner();
    panner.pan.value = track.pan;
    gain.connect(panner);
    panner.connect(offlineCtx.destination);
    for (const seg of segments) {
      const buffer = buffers.get(seg.takeId);
      if (!buffer) continue;
      scheduleSegment(offlineCtx, gain, buffer, seg.startSec, seg.sourceStartSec, seg.endSec - seg.startSec);
    }
  }

  const rendered = await offlineCtx.startRendering();
  return encodeWavFloat32(rendered);
}
