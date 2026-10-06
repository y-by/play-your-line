import { useMemo } from "react";
import type { ChannelFx } from "../../types/project";
import { eqResponseDb } from "../../lib/channelFx";

const WIDTH = 220;
const HEIGHT = 74;
const MIN_HZ = 20;
const MAX_HZ = 20000;
const MAX_DB = 15;
const POINTS = 96;

// Even spacing on a log scale, the way every real EQ display works — otherwise
// the whole low end would be crushed into a few pixels.
const FREQS = new Float32Array(
  Array.from({ length: POINTS }, (_, i) => MIN_HZ * Math.pow(MAX_HZ / MIN_HZ, i / (POINTS - 1)))
);

const xForFreq = (hz: number) => (Math.log10(hz / MIN_HZ) / Math.log10(MAX_HZ / MIN_HZ)) * WIDTH;
const yForDb = (db: number) => HEIGHT / 2 - (Math.max(-MAX_DB, Math.min(MAX_DB, db)) / MAX_DB) * (HEIGHT / 2 - 4);

/**
 * The EQ's frequency response, calculated from the knob values with the same filter formulas the audio
 * uses, so the curve is what the channel sounds like, not a decorative sketch.
 */
export function EqCurve({ fx }: { fx: Pick<ChannelFx, "eqLow" | "eqMid" | "eqHigh" | "eqLowHz" | "eqMidHz" | "eqHighHz"> }) {
  const { eqLow, eqMid, eqHigh, eqLowHz, eqMidHz, eqHighHz } = fx;
  const path = useMemo(() => {
    const db = eqResponseDb({ eqLow, eqMid, eqHigh, eqLowHz, eqMidHz, eqHighHz }, FREQS);
    return FREQS.reduce((d, hz, i) => `${d}${i === 0 ? "M" : "L"} ${xForFreq(hz).toFixed(1)} ${yForDb(db[i]).toFixed(1)} `, "");
  }, [eqLow, eqMid, eqHigh, eqLowHz, eqMidHz, eqHighHz]);

  const gridFreqs = [100, 1000, 10000];

  return (
    <svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="eq-curve" role="img" aria-label="EQ frequency response">
      {gridFreqs.map((hz) => (
        <line key={hz} x1={xForFreq(hz)} x2={xForFreq(hz)} y1={0} y2={HEIGHT} className="eq-grid-line" />
      ))}
      <line x1={0} x2={WIDTH} y1={HEIGHT / 2} y2={HEIGHT / 2} className="eq-grid-zero" />
      <path d={path} className="eq-curve-fill" fill="none" />
    </svg>
  );
}
