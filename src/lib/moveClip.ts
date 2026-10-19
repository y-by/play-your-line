// Moving a clip to another channel of the same player. A take belongs to one channel, so the clip's audio is cut into a
// new take for the other channel (with a short handle each side so the clip can still be trimmed a little).
// Pure rules and numbers, so they are testable without a browser.

/** Audio kept before and after the moved piece so it can still be trimmed outwards, in seconds. */
export const MOVE_HANDLE_SEC = 2;

/** Which part of the take to copy, and where the clip starts inside the copy. */
export function planMoveSlice(
  clip: { sourceStartSec: number; durationSec: number },
  takeDurationSec: number,
  handleSec = MOVE_HANDLE_SEC,
): { sliceStartSec: number; sliceEndSec: number; newSourceStartSec: number } {
  const sliceStartSec = Math.max(0, clip.sourceStartSec - handleSec);
  const sliceEndSec = Math.min(takeDurationSec, clip.sourceStartSec + clip.durationSec + handleSec);
  return { sliceStartSec, sliceEndSec, newSourceStartSec: clip.sourceStartSec - sliceStartSec };
}

/**
 * A clip may move between two channels when both are assigned to the same person, and the one asking is that person or
 * the song's Owner. Nobody else, and never to another player's channel.
 */
export function canMoveBetween(
  who: { userId: string | null; isOwner: boolean },
  from: { id: string; assignedUserId: string | null },
  to: { id: string; assignedUserId: string | null },
): boolean {
  if (!who.userId || from.id === to.id) return false;
  if (!from.assignedUserId || from.assignedUserId !== to.assignedUserId) return false;
  return who.isOwner || who.userId === from.assignedUserId;
}
