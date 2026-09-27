// Audio Output Devices API — not yet in lib.dom.d.ts (Chrome/Edge only).
interface AudioContext {
  setSinkId?(sinkId: string | { type: "none" }): Promise<void>;
  readonly sinkId?: string | { type: "none" };
}

interface HTMLMediaElement {
  setSinkId?(sinkId: string): Promise<void>;
}

// Chrome reports an input device's own latency (seconds) on the track settings.
interface MediaTrackSettings {
  latency?: number;
}
