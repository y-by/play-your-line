// Runs on the audio render thread. Buffers raw Float32 samples and ships
// them to the main thread in chunks — no compression, no resampling, no
// downstream lossy re-encoding: this is exactly what the input produced.
class PCMRecorderProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    // A stereo channel records two inputs: the left goes out as before, together with the right.
    this.stereo = !!(options && options.processorOptions && options.processorOptions.stereo);
    this.chunkSize = 1024; // ~21 ms: small enough for a live waveform that keeps up
    this.buffer = new Float32Array(this.chunkSize);
    this.bufferR = new Float32Array(this.chunkSize);
    this.writeIndex = 0;
    this.flushRequested = false;
    this.reportedStart = false;
    this.port.onmessage = (event) => {
      if (event.data && event.data.type === "flush") {
        this.flushRequested = true;
      }
    };
  }

  /** Ships what is buffered: the left samples alone (mono), or the left and right together (stereo). */
  send(count) {
    if (this.stereo) this.port.postMessage({ type: "stereo", left: this.buffer.slice(0, count), right: this.bufferR.slice(0, count) });
    else this.port.postMessage(this.buffer.slice(0, count));
  }

  process(inputs) {
    // Tell the main thread which audio-clock frame the first captured sample
    // belongs to, so the take can later be placed on the song timeline exactly.
    if (!this.reportedStart) {
      this.reportedStart = true;
      this.port.postMessage({ type: "start", frame: currentFrame });
    }

    const input = inputs[0][0];
    // A one-channel input into a stereo take fills both sides with it.
    const right = this.stereo ? inputs[0][1] || input : null;
    if (input) {
      for (let i = 0; i < input.length; i++) {
        if (right) this.bufferR[this.writeIndex] = right[i];
        this.buffer[this.writeIndex++] = input[i];
        if (this.writeIndex >= this.chunkSize) {
          this.send(this.chunkSize);
          this.writeIndex = 0;
        }
      }
    }

    if (this.flushRequested) {
      if (this.writeIndex > 0) {
        this.send(this.writeIndex);
        this.writeIndex = 0;
      }
      this.port.postMessage({ type: "flush-done" });
      this.flushRequested = false;
    }

    return true;
  }
}

registerProcessor("pcm-recorder-processor", PCMRecorderProcessor);
