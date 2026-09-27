// Schedules one audible piece of a take on the audio clock. Used by live
// playback and by the offline mixdown so both sound identical.

/** Every piece fades in/out over this long so a cut never clicks. */
export const SEGMENT_FADE_SEC = 0.002;

export function scheduleSegment(
  ctx: BaseAudioContext,
  destination: AudioNode,
  buffer: AudioBuffer,
  when: number,
  bufferOffset: number,
  duration: number
): AudioBufferSourceNode {
  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const envelope = ctx.createGain();
  const fade = Math.min(SEGMENT_FADE_SEC, duration / 2);
  envelope.gain.setValueAtTime(0, when);
  envelope.gain.linearRampToValueAtTime(1, when + fade);
  envelope.gain.setValueAtTime(1, when + duration - fade);
  envelope.gain.linearRampToValueAtTime(0, when + duration);

  source.connect(envelope);
  envelope.connect(destination);
  source.start(when, bufferOffset, duration);
  return source;
}
