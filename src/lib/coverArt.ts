import { TRACK_COLORS } from "./trackColors";

/** Small deterministic hash so a project always gets the same artwork. */
export function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function makeRandom(seed: number): () => number {
  let h = seed;
  return () => (h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0);
}

/** The colour a project's generated cover is built on (also used to tint its card). */
export function coverTint(id: string): string {
  return TRACK_COLORS[makeRandom(hash(id))() % TRACK_COLORS.length];
}
