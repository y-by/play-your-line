// The song grid: bars and beats derived from the tempo. Pure functions only.
// 4/4 for now — BEATS_PER_BAR is the single place a time signature would change.

export const BEATS_PER_BAR = 4;

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

export function barSec(bpm: number): number {
  return beatSec(bpm) * BEATS_PER_BAR;
}

/** Length in seconds of one snap step at the given resolution. */
export function stepSec(bpm: number, resolution: SnapResolution): number {
  const beat = beatSec(bpm);
  switch (resolution) {
    case "bar":
      return beat * BEATS_PER_BAR;
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
export function barAndBeat(sec: number, bpm: number): { bar: number; beat: number } {
  const safe = Math.max(0, sec) + 1e-9;
  const bar = Math.floor(safe / barSec(bpm)) + 1;
  const beat = Math.floor((safe % barSec(bpm)) / beatSec(bpm)) + 1;
  return { bar, beat };
}

export function formatBarsBeats(sec: number, bpm: number): string {
  const { bar, beat } = barAndBeat(sec, bpm);
  return `${bar}.${beat}`;
}
