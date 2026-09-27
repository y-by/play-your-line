// Pure timing math (no Web Audio objects) so it can be tested with plain numbers.
//
// The problem being solved: when a musician plays along to what they hear,
// their performance reaches the recording late by the "round-trip latency"
// (audio out -> speakers/headphones -> ears -> instrument -> mic/interface ->
// browser). If we drop the take on the timeline exactly where it was
// captured, it will sound slightly behind the click and the other parts.
// The fix is to measure that delay and shift the take earlier by that amount.

/**
 * Finds when each expected click actually shows up in a captured signal and
 * returns (actual - expected) in seconds for every click that was heard.
 *
 * @param samples             mono capture
 * @param sampleRate          capture sample rate
 * @param expectedClickTimesSec  when each click was scheduled to sound,
 *                            measured from the first captured sample
 */
export function measureClickLatencies(
  samples: Float32Array,
  sampleRate: number,
  expectedClickTimesSec: number[]
): number[] {
  if (expectedClickTimesSec.length === 0) return [];

  // Noise floor from the quiet stretch before the first click.
  const quietEnd = Math.max(0, Math.floor((expectedClickTimesSec[0] - 0.05) * sampleRate));
  let sumSquares = 0;
  const quietLen = Math.min(quietEnd, samples.length);
  for (let i = 0; i < quietLen; i++) sumSquares += samples[i] * samples[i];
  const noiseRms = quietLen > 0 ? Math.sqrt(sumSquares / quietLen) : 0;
  const minPeak = Math.max(0.01, noiseRms * 6);

  const latencies: number[] = [];
  for (const expected of expectedClickTimesSec) {
    const from = Math.max(0, Math.floor((expected - 0.02) * sampleRate));
    const to = Math.min(samples.length, Math.ceil((expected + 0.45) * sampleRate));
    if (to <= from) continue;

    let peak = 0;
    for (let i = from; i < to; i++) peak = Math.max(peak, Math.abs(samples[i]));
    if (peak < minPeak) continue; // nothing loud enough heard in this window

    const threshold = peak * 0.2;
    for (let i = from; i < to; i++) {
      if (Math.abs(samples[i]) >= threshold) {
        latencies.push(i / sampleRate - expected);
        break;
      }
    }
  }
  return latencies;
}

export interface LatencySummary {
  latencySec: number | null;
  spreadSec: number;
  heardCount: number;
}

/** Median of the measurements, or null when they're too few or too inconsistent to trust. */
export function summarizeLatencies(latencies: number[]): LatencySummary {
  const plausible = latencies.filter((l) => l > 0 && l < 0.5);
  if (plausible.length < 3) return { latencySec: null, spreadSec: 0, heardCount: plausible.length };
  const sorted = [...plausible].sort((a, b) => a - b);
  const spread = sorted[sorted.length - 1] - sorted[0];
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { latencySec: spread > 0.015 ? null : median, spreadSec: spread, heardCount: plausible.length };
}

/**
 * Where a freshly recorded take belongs on the song timeline.
 *
 * @param anchorPositionSec  song position that was playing at `anchorCtxSec`
 * @param anchorCtxSec       audio-clock time playback started
 * @param captureStartCtxSec audio-clock time of the first captured sample
 * @param latencySec         round-trip latency to compensate for
 * @param earliestPositionSec the take may not begin before this song position
 *          (the point where recording was started). Anything captured earlier —
 *          the count-in, or lead-in before playback began — is dropped.
 * @returns the take's timeline offset, plus how many leading samples to drop
 */
export function computeTakePlacement(params: {
  anchorPositionSec: number;
  anchorCtxSec: number;
  captureStartCtxSec: number;
  latencySec: number;
  sampleRate: number;
  earliestPositionSec?: number;
}): { offsetSec: number; dropSamples: number } {
  const { anchorPositionSec, anchorCtxSec, captureStartCtxSec, latencySec, sampleRate } = params;
  const offsetSec = anchorPositionSec + (captureStartCtxSec - anchorCtxSec) - latencySec;
  const offsetSamples = Math.round(offsetSec * sampleRate);
  const earliestSamples = Math.round(Math.max(0, params.earliestPositionSec ?? 0) * sampleRate);
  if (offsetSamples < earliestSamples) {
    return { offsetSec: earliestSamples / sampleRate, dropSamples: earliestSamples - offsetSamples };
  }
  return { offsetSec: offsetSamples / sampleRate, dropSamples: 0 };
}
