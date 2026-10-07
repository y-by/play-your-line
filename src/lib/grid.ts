// The song grid: bars and beats derived from the tempo. Pure functions only.
// A bar has `beatsPerBar` quarter-note beats (4 for 4/4, 3 for 3/4). The functions below take it as a last
// argument that defaults to 4, so a call that does not know the time signature still works as 4/4.

export const BEATS_PER_BAR = 4;

/** The time signatures a project can use: beats per bar over a quarter-note beat. */
export const TIME_SIGNATURES = [2, 3, 4, 5, 6, 7];

export type SnapResolution = "bar" | "beat" | "eighth" | "sixteenth";

export const SNAP_OPTIONS: { value: SnapResolution; label: string }[] = [
  { value: "bar", label: "Bar" },
  { value: "beat", label: "1/4" },
  { value: "eighth", label: "1/8" },
  { value: "sixteenth", label: "1/16" },
];

export function beatSec(bpm: number): number {
  return 60 / bpm;
}

export function barSec(bpm: number, beatsPerBar = BEATS_PER_BAR): number {
  return beatSec(bpm) * beatsPerBar;
}

/** Length in seconds of one snap step at the given resolution. */
export function stepSec(bpm: number, resolution: SnapResolution, beatsPerBar = BEATS_PER_BAR): number {
  const beat = beatSec(bpm);
  switch (resolution) {
    case "bar":
      return beat * beatsPerBar;
    case "beat":
      return beat;
    case "eighth":
      return beat / 2;
    case "sixteenth":
      return beat / 4;
  }
}

/** Nearest grid line to `sec`. */
export function snapTo(sec: number, step: number): number {
  return Math.round(sec / step) * step;
}

/** 1-based bar and beat at a song position, e.g. { bar: 3, beat: 2 }. */
export function barAndBeat(sec: number, bpm: number, beatsPerBar = BEATS_PER_BAR): { bar: number; beat: number } {
  const safe = Math.max(0, sec) + 1e-9;
  const bar = Math.floor(safe / barSec(bpm, beatsPerBar)) + 1;
  const beat = Math.floor((safe % barSec(bpm, beatsPerBar)) / beatSec(bpm)) + 1;
  return { bar, beat };
}

export function formatBarsBeats(sec: number, bpm: number, beatsPerBar = BEATS_PER_BAR): string {
  const { bar, beat } = barAndBeat(sec, bpm, beatsPerBar);
  return `${bar}.${beat}`;
}
