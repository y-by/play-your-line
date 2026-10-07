/** Encodes a rendered mix as a stereo MP3 (the lighter "listening copy"). The encoder is loaded only when needed. */
export async function encodeMp3(buffer: AudioBuffer, kbps = 128): Promise<Blob> {
  const { Mp3Encoder } = await import("@breezystack/lamejs");
  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
  const encoder = new Mp3Encoder(2, buffer.sampleRate, kbps);
  const toInt16 = (src: Float32Array, from: number, to: number) => {
    const out = new Int16Array(to - from);
    for (let i = from; i < to; i++) {
      const s = Math.max(-1, Math.min(1, src[i]));
      out[i - from] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  };
  const parts: Uint8Array<ArrayBuffer>[] = [];
  const block = 1152 * 20;
  for (let i = 0; i < buffer.length; i += block) {
    const end = Math.min(buffer.length, i + block);
    const chunk = encoder.encodeBuffer(toInt16(left, i, end), toInt16(right, i, end));
    if (chunk.length) parts.push(new Uint8Array(chunk));
    // Give the page a breath so a long mix does not freeze it.
    if ((i / block) % 25 === 24) await new Promise((r) => setTimeout(r, 0));
  }
  const tail = encoder.flush();
  if (tail.length) parts.push(new Uint8Array(tail));
  return new Blob(parts, { type: "audio/mpeg" });
}
