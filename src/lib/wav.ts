// WAV encoders.
//
// Takes (recordings, imports, joined clips) are stored as 24-bit PCM: an audio interface captures 24 bits at most,
// so 32-bit float stored nothing extra, and 24-bit files are a quarter smaller (storage, downloads, the take cache).
// The browser decodes every take back to 32-bit float, which holds every 24-bit value exactly, so playback, editing,
// effects and export are unchanged. Old 32-bit float takes still decode as before; both kinds live side by side.
//
// Export Mix stays 32-bit float (format code 3): a one-off download, where float's headroom above full scale is useful.

const PCM24_MAX = 8388607; // 2^23 - 1

/** Highest absolute sample value across the channels (1.0 = full scale). */
export function peakOf(channels: Float32Array[]): number {
  let peak = 0;
  for (const data of channels) {
    for (let i = 0; i < data.length; i++) {
      const a = Math.abs(data[i]);
      if (a > peak) peak = a;
    }
  }
  return peak;
}

/**
 * Integer PCM can't hold anything above full scale (a float bounce from a DAW, or overlapping clips joined, can go
 * past it). Rather than clip those peaks, the whole file is lowered just enough to fit. Returns the channels to
 * store (the originals when nothing needed changing) and how many dB they were lowered (0 if not).
 */
export function fitToFullScale(channels: Float32Array[], ceiling = 0.999): { channels: Float32Array[]; loweredDb: number } {
  const peak = peakOf(channels);
  if (peak <= 1) return { channels, loweredDb: 0 };
  const gain = ceiling / peak;
  const scaled = channels.map((data) => {
    const out = new Float32Array(data.length);
    for (let i = 0; i < data.length; i++) out[i] = data[i] * gain;
    return out;
  });
  return { channels: scaled, loweredDb: -20 * Math.log10(gain) };
}

/** 24-bit PCM WAV (format code 1) from raw channel data. Anything past full scale is clamped (call fitToFullScale first to avoid that). */
export function encodeWavPcm24Channels(channels: Float32Array[], sampleRate: number): Blob {
  const numChannels = Math.max(1, channels.length);
  const length = channels[0]?.length ?? 0;
  const bytesPerSample = 3;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = length * blockAlign;
  const out = new ArrayBuffer(44 + dataSize);
  const view = new DataView(out);
  const bytes = new Uint8Array(out);

  writeHeader(view, { formatCode: 1, numChannels, sampleRate, bitsPerSample: 24, dataSize });

  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const x = channels[ch]?.[i] ?? 0;
      let v = Math.round(x * PCM24_MAX);
      if (v > PCM24_MAX) v = PCM24_MAX;
      else if (v < -PCM24_MAX - 1) v = -PCM24_MAX - 1;
      // Little-endian, two's complement: the low 24 bits of v.
      bytes[offset] = v & 0xff;
      bytes[offset + 1] = (v >> 8) & 0xff;
      bytes[offset + 2] = (v >> 16) & 0xff;
      offset += 3;
    }
  }

  return new Blob([out], { type: "audio/wav" });
}

/** 24-bit PCM WAV from an AudioBuffer (see encodeWavPcm24Channels). */
export function encodeWavPcm24(buffer: AudioBuffer): Blob {
  const channels: Float32Array[] = [];
  for (let i = 0; i < buffer.numberOfChannels; i++) channels.push(buffer.getChannelData(i));
  return encodeWavPcm24Channels(channels, buffer.sampleRate);
}

/** Stores a take: lowered to fit full scale if needed, then 24-bit PCM WAV. loweredDb > 0 means it was turned down. */
export function encodeTake(buffer: AudioBuffer): { blob: Blob; loweredDb: number } {
  const raw: Float32Array[] = [];
  for (let i = 0; i < buffer.numberOfChannels; i++) raw.push(buffer.getChannelData(i));
  const { channels, loweredDb } = fitToFullScale(raw);
  return { blob: encodeWavPcm24Channels(channels, buffer.sampleRate), loweredDb };
}

function writeHeader(
  view: DataView,
  h: { formatCode: number; numChannels: number; sampleRate: number; bitsPerSample: number; dataSize: number },
) {
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  const blockAlign = h.numChannels * (h.bitsPerSample / 8);
  writeString(0, "RIFF");
  view.setUint32(4, 36 + h.dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, h.formatCode, true);
  view.setUint16(22, h.numChannels, true);
  view.setUint32(24, h.sampleRate, true);
  view.setUint32(28, h.sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, h.bitsPerSample, true);
  writeString(36, "data");
  view.setUint32(40, h.dataSize, true);
}

/** 32-bit float PCM WAV (format code 3), used for Export Mix. */
export function encodeWavFloat32(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const bytesPerSample = 4;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = buffer.length * blockAlign;
  const bufferOut = new ArrayBuffer(44 + dataSize);
  const view = new DataView(bufferOut);
  writeHeader(view, { formatCode: 3, numChannels, sampleRate, bitsPerSample: 32, dataSize });

  const channels: Float32Array[] = [];
  for (let i = 0; i < numChannels; i++) channels.push(buffer.getChannelData(i));

  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      view.setFloat32(offset, channels[ch][i], true);
      offset += 4;
    }
  }

  return new Blob([bufferOut], { type: "audio/wav" });
}
