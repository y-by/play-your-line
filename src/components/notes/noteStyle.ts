import { useEffect, useState } from "react";
import { TRACK_COLORS } from "../../lib/trackColors";
import { useProjectStore } from "../../store/useProjectStore";
import { hash } from "../../lib/coverArt";

/** Each author gets one steady colour (from the channel palette), so you can tell who wrote what at a glance. */
export function authorTint(authorId: string): string {
  return TRACK_COLORS[hash(authorId) % TRACK_COLORS.length];
}

/** A note on a channel wears that channel's colour, so it reads at a glance what it is about; others use the author's colour. */
export function noteTint(note: { authorId: string; trackId: string | null }, tracks: { id: string; color: string }[]): string {
  return (note.trackId && tracks.find((t) => t.id === note.trackId)?.color) || authorTint(note.authorId);
}

export function authorInitial(name: string | null): string {
  return (name?.trim().charAt(0) || "?").toUpperCase();
}

const NO_TRACKS: { id: string; color: string }[] = [];

/** The project's channels (id and colour), for tinting notes. */
export function useNoteTracks(): { id: string; color: string }[] {
  return useProjectStore((s) => s.project?.tracks ?? NO_TRACKS);
}

/** The current time, refreshed every minute, so "5 min ago" keeps up. */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}
