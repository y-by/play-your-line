// Converts between the saved gain (a plain multiplier, 1 = unity) and the
// decibels a fader shows. Real mixers put 0 dB near the top of the fader's
// travel — a little headroom above it, a long throw below for fine control
// near unity and a steep drop-off further down. Pure, so it's testable.

export const MIN_DB = -60;
export const MAX_DB = 6;
export const UNITY_DB = 0;

export function gainToDb(gain: number): number {
  if (gain <= 0) return MIN_DB;
  return Math.max(MIN_DB, Math.min(MAX_DB, 20 * Math.log10(gain)));
}

export function dbToGain(db: number): number {
  return Math.pow(10, Math.max(MIN_DB, Math.min(MAX_DB, db)) / 20);
}
