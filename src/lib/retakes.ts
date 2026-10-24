// Retakes: a new recording lands on top of the older ones in the same place, and the older clips stay under it, silent.
// These rules say which takes are hidden, how many a channel keeps, and about how much space they use. Pure, so they are tested.

import { hiddenClipIds, type ClipData } from "./clips.ts";

/** How many hidden (older) takes a channel keeps under the newest. When a new recording pushes it over, the oldest hidden one is removed. */
export const MAX_HIDDEN_TAKES = 5;

export interface HiddenTake {
  takeId: string;
  /** Every clip of this take (they are all hidden). */
  clipIds: string[];
  /** The newest of its clips: how recently it was put on the timeline. */
  z: number;
}

/** Takes of which nothing is heard: every clip that uses them is covered by newer clips. Oldest first. */
export function hiddenTakes(clips: ClipData[]): HiddenTake[] {
  const hidden = new Set(hiddenClipIds(clips));
  const byTake = new Map<string, ClipData[]>();
  for (const c of clips) byTake.set(c.takeId, [...(byTake.get(c.takeId) ?? []), c]);
  const out: HiddenTake[] = [];
  for (const [takeId, list] of byTake) {
    if (list.every((c) => hidden.has(c.id))) out.push({ takeId, clipIds: list.map((c) => c.id), z: Math.max(...list.map((c) => c.z)) });
  }
  return out.sort((a, b) => a.z - b.z);
}

/** The clips to remove so that at most `keep` hidden takes are left: those of the oldest hidden takes. */
export function clipsToTrim(clips: ClipData[], keep = MAX_HIDDEN_TAKES): string[] {
  const hidden = hiddenTakes(clips);
  const extra = hidden.length - Math.max(0, keep);
  return extra > 0 ? hidden.slice(0, extra).flatMap((t) => t.clipIds) : [];
}

/** About how many megabytes a take of this length uses (24-bit, 48 kHz; a stereo channel is twice as much). */
export function estimateTakeMb(durationSec: number, stereo: boolean): number {
  return (durationSec * 48000 * 3 * (stereo ? 2 : 1)) / 1_000_000;
}
