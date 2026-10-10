// Rendering the selected clips into one recording (needs an audio context, so it is kept apart from the joining rules
// in joinClips.ts, which are tested without one).

import { audibleSegments, type ClipData } from "./clips";
import { scheduleSegment } from "./segmentPlayback";

/**
 * Renders what is heard of `clips` between `range.startSec` and `range.endSec` into one recording: the recordings' own
 * sample rate (the highest of them) and channel count (stereo if any is stereo). Gaps are silence.
 */
export async function renderClipsToBuffer(clips: ClipData[], buffers: Map<string, AudioBuffer>, range: { startSec: number; endSec: number }): Promise<AudioBuffer> {
  const used = [...new Set(clips.map((c) => c.takeId))].map((id) => buffers.get(id)).filter((b): b is AudioBuffer => !!b);
  const sampleRate = Math.max(...used.map((b) => b.sampleRate));
  const channels = Math.min(2, Math.max(...used.map((b) => b.numberOfChannels)));
  const length = Math.max(1, Math.ceil((range.endSec - range.startSec) * sampleRate));
  const ctx = new OfflineAudioContext(channels, length, sampleRate);
  for (const seg of audibleSegments(clips)) {
    const buffer = buffers.get(seg.takeId);
    if (!buffer) continue;
    scheduleSegment(ctx, ctx.destination, buffer, seg.startSec - range.startSec, seg.sourceStartSec, seg.endSec - seg.startSec, { seg, fromSec: seg.startSec });
  }
  return ctx.startRendering();
}
