// Runs on the audio render thread. Buffers raw Float32 samples and ships
// them to the main thread in chunks — no compression, no resampling, no
// downstream lossy re-encoding: this is exactly what the input produced.
class PCMRecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunkSize = 1024; // ~21 ms: small enough for a live waveform that keeps up
    this.buffer = new Float32Array(this.chunkSize);
    this.writeIndex = 0;
    this.flushRequested = false;
    this.reportedStart = false;
    this.port.onmessage = (event) => {
      if (event.data && event.data.type === "flush") {
        this.flushRequested = true;
      }
    };
  }

  process(inputs) {
    // Tell the main thread which audio-clock frame the first captured sample
    // belongs to, so the take can later be placed on the song timeline exactly.
    if (!this.reportedStart) {
      this.reportedStart = true;
      this.port.postMessage({ type: "start", frame: currentFrame });
    }

    const input = inputs[0][0];
    if (input) {
      for (let i = 0; i < input.length; i++) {
        this.buffer[this.writeIndex++] = input[i];
        if (this.writeIndex >= this.chunkSize) {
          this.port.postMessage(this.buffer.slice(0));
          this.writeIndex = 0;
        }
      }
    }

    if (this.flushRequested) {
      if (this.writeIndex > 0) {
        this.port.postMessage(this.buffer.slice(0, this.writeIndex));
        this.writeIndex = 0;
      }
      this.port.postMessage({ type: "flush-done" });
      this.flushRequested = false;
    }

    return true;
  }
}

registerProcessor("pcm-recorder-processor", PCMRecorderProcessor);
