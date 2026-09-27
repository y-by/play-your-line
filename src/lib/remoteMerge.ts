// Pure helpers for folding changes that arrive from other people into the
// local song. Kept free of React / Supabase so they can be tested with numbers.
import type { Clip, Track } from "../types/project";

export function sameClip(a: Clip, b: Clip): boolean {
  return (
    a.id === b.id &&
    a.takeId === b.takeId &&
    a.startSec === b.startSec &&
    a.sourceStartSec === b.sourceStartSec &&
    a.durationSec === b.durationSec &&
    a.z === b.z
  );
}

/** Adds or replaces a clip on a channel. Returns the SAME array when nothing changed (so callers can skip work). */
export function upsertClip(tracks: Track[], trackId: string, clip: Clip): Track[] {
  const track = tracks.find((t) => t.id === trackId);
  if (!track) return tracks;
  const existing = track.clips.find((c) => c.id === clip.id);
  if (existing && sameClip(existing, clip)) return tracks;
  const clips = existing ? track.clips.map((c) => (c.id === clip.id ? clip : c)) : [...track.clips, clip];
  return tracks.map((t) => (t.id === trackId ? { ...t, clips } : t));
}

/** Removes a clip from whichever channel holds it. Returns the SAME array when the clip isn't there. */
export function removeClip(tracks: Track[], clipId: string): Track[] {
  if (!tracks.some((t) => t.clips.some((c) => c.id === clipId))) return tracks;
  return tracks.map((t) => (t.clips.some((c) => c.id === clipId) ? { ...t, clips: t.clips.filter((c) => c.id !== clipId) } : t));
}
