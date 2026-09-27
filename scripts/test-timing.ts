// Checks the latency-compensation math with synthetic recordings of a known delay.
// Run: npm run test:timing
import { measureClickLatencies, summarizeLatencies, computeTakePlacement } from "../src/lib/latency.ts";

const sr = 48000;
function capture(latencySec: number, clickTimes: number[], opts: { silent?: boolean; jitter?: number } = {}) {
  const s = new Float32Array(sr * 5);
  for (let i = 0; i < s.length; i++) s[i] = (Math.random() - 0.5) * 0.002; // room noise
  if (!opts.silent) {
    clickTimes.forEach((t, k) => {
      const j = opts.jitter ? (k % 2 ? opts.jitter : 0) : 0;
      const start = Math.round((t + latencySec + j) * sr);
      for (let n = 0; n < 0.03 * sr; n++) {
        const env = Math.min(1, n / (0.002 * sr)) * Math.exp(-n / (0.008 * sr));
        s[start + n] += 0.3 * env * Math.sin((2 * Math.PI * 1500 * n) / sr);
      }
    });
  }
  return s;
}
const clicks = [0.6, 1.1, 1.6, 2.1, 2.6, 3.1];
let fail = 0;
const check = (name: string, ok: boolean, detail = "") => { console.log((ok ? "PASS " : "FAIL ") + name + " " + detail); if (!ok) fail++; };

const a = summarizeLatencies(measureClickLatencies(capture(0.037, clicks), sr, clicks));
check("recovers a 37 ms delay", a.latencySec !== null && Math.abs(a.latencySec - 0.037) < 0.001, `-> ${((a.latencySec ?? 0) * 1000).toFixed(2)} ms, heard ${a.heardCount}/6`);

const b = summarizeLatencies(measureClickLatencies(capture(0.112, clicks), sr, clicks));
check("recovers a 112 ms delay", b.latencySec !== null && Math.abs(b.latencySec - 0.112) < 0.001, `-> ${((b.latencySec ?? 0) * 1000).toFixed(2)} ms`);

const c = summarizeLatencies(measureClickLatencies(capture(0.04, clicks, { silent: true }), sr, clicks));
check("headphones (no click heard) is refused, not guessed", c.latencySec === null, `heard ${c.heardCount}/6`);

const d = summarizeLatencies(measureClickLatencies(capture(0.04, clicks, { jitter: 0.03 }), sr, clicks));
check("inconsistent measurements are refused", d.latencySec === null, `spread ${(d.spreadSec * 1000).toFixed(1)} ms`);

// Take placement
const p1 = computeTakePlacement({ anchorPositionSec: 0, anchorCtxSec: 10.06, captureStartCtxSec: 9.98, latencySec: 0.04, sampleRate: sr });
check("capture that started before playback, minus latency -> trims head", p1.dropSamples > 0 && p1.offsetSec === 0, JSON.stringify(p1));
const p2 = computeTakePlacement({ anchorPositionSec: 30, anchorCtxSec: 50, captureStartCtxSec: 49.9, latencySec: 0.04, sampleRate: sr, earliestPositionSec: 30 });
check("recording from 0:30 starts at 0:30, not 0:00 (earlier audio dropped)", p2.offsetSec === 30 && Math.abs(p2.dropSamples - 0.14 * sr) <= 1, JSON.stringify(p2));
const p3 = computeTakePlacement({ anchorPositionSec: 0, anchorCtxSec: 5, captureStartCtxSec: 5.2, latencySec: 0.04, sampleRate: sr });
check("capture that started 200 ms after playback -> offset 160 ms", Math.abs(p3.offsetSec - 0.16) < 0.0001, JSON.stringify(p3));
// Count-in: capture starts ~2 s (4 beats @120) before the song position starts moving.
const c1 = computeTakePlacement({ anchorPositionSec: 0, anchorCtxSec: 12.06, captureStartCtxSec: 10.05, latencySec: 0.04, sampleRate: sr, earliestPositionSec: 0 });
check("count-in from 0:00: the whole count-in is dropped, take starts at 0", c1.offsetSec === 0 && Math.abs(c1.dropSamples - 2.05 * sr) <= 1, JSON.stringify(c1));
const c2 = computeTakePlacement({ anchorPositionSec: 8, anchorCtxSec: 12, captureStartCtxSec: 10, latencySec: 0.04, sampleRate: sr, earliestPositionSec: 8 });
check("count-in from 0:08: take starts at 0:08, count-in dropped", c2.offsetSec === 8 && Math.abs(c2.dropSamples - 2.04 * sr) <= 1, JSON.stringify(c2));
const c3 = computeTakePlacement({ anchorPositionSec: 8, anchorCtxSec: 12, captureStartCtxSec: 12.5, latencySec: 0.04, sampleRate: sr, earliestPositionSec: 8 });
check("capture that began after the song started keeps its own offset (8.46)", Math.abs(c3.offsetSec - 8.46) < 0.0001 && c3.dropSamples === 0, JSON.stringify(c3));
process.exit(fail ? 1 : 0);
