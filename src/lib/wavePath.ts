// Turning waveform peaks into vector shapes (an SVG path), so a waveform stays sharp at any zoom, screen density or
// channel height. Pure, so it is tested with numbers.

/**
 * The outline of a waveform as one closed path: along the top (the highest sample of each column), then back along the
 * bottom (the lowest). `peaks` is [min0, max0, min1, max1, ...]. The picture is `columns` wide and `height` tall in its
 * own units; the screen scales it. `boost` makes a quiet recording larger, `minThickness` keeps silence visible as a line.
 */
export function wavePath(peaks: Float32Array, columns: number, height: number, boost = 1, minThickness = 1): string {
  const mid = height / 2;
  const tops: string[] = [];
  const bottoms: string[] = [];
  for (let x = 0; x < columns; x++) {
    let top = mid - peaks[x * 2 + 1] * boost * mid;
    let bottom = mid - peaks[x * 2] * boost * mid;
    if (bottom - top < minThickness) {
      const centre = (top + bottom) / 2;
      top = centre - minThickness / 2;
      bottom = centre + minThickness / 2;
    }
    const t = Math.max(0, Math.min(height, top));
    const b = Math.max(0, Math.min(height, bottom));
    tops.push(`${x},${round(t)} ${x + 1},${round(t)}`);
    bottoms.push(`${x + 1},${round(b)} ${x},${round(b)}`);
  }
  if (columns === 0) return "";
  // Top edge left to right in steps of one column, then the bottom edge right to left.
  return `M${tops.join(" L")} L${bottoms.reverse().join(" L")}Z`;
}

/** The loudest value in the peaks, and how much a quiet recording can be enlarged so it stays readable (up to `max`). */
export function autoBoost(peaks: Float32Array, max = 4): number {
  let loudest = 0;
  for (let i = 0; i < peaks.length; i++) loudest = Math.max(loudest, Math.abs(peaks[i]));
  return loudest > 0 ? Math.min(max, 0.9 / loudest) : 1;
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}
