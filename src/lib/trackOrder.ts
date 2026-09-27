// Which order the channels are shown in. Pure, so it can be tested with numbers.
//
// The song has a DEFAULT order (saved by the initiator). Anyone else may
// arrange the channels for themselves; that personal order is kept only on
// their own device.
import type { Track } from "../types/project";

/** The song's default order: the initiator's arrangement. */
export function defaultOrder(tracks: Track[]): Track[] {
  return [...tracks].sort((a, b) => a.position - b.position);
}

/**
 * What one person sees: their personal order where they have one, and any
 * channels they haven't placed yet (new ones) at the bottom in default order.
 * Channels that no longer exist drop out of the personal list.
 */
export function orderTracks(tracks: Track[], personal: string[] | null): Track[] {
  const base = defaultOrder(tracks);
  if (!personal || personal.length === 0) return base;
  const remaining = new Map(base.map((t) => [t.id, t]));
  const out: Track[] = [];
  for (const id of personal) {
    const t = remaining.get(id);
    if (t) {
      out.push(t);
      remaining.delete(id);
    }
  }
  for (const t of base) if (remaining.has(t.id)) out.push(t);
  return out;
}

/** Moves one entry of a list to a new position. */
export function moveId(ids: string[], from: number, to: number): string[] {
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, moved);
  return next;
}
