import { TRACK_COLORS } from "../../lib/trackColors";
import { hash } from "../../lib/coverArt";

/** Each author gets one steady colour (from the channel palette), so you can tell who wrote what at a glance. */
export function authorTint(authorId: string): string {
  return TRACK_COLORS[hash(authorId) % TRACK_COLORS.length];
}

export function authorInitial(name: string | null): string {
  return (name?.trim().charAt(0) || "?").toUpperCase();
}
