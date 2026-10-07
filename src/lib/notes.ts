// Small pure helpers for notes (so they can be tested without a browser).
import type { ProjectNote } from "../types/project";

const BEATS_PER_BAR = 4; // the default (4/4); same as grid.ts, kept here so this file needs no imports

/** The 1-based bar a beat falls in. */
export function barOfBeat(atBeat: number, beatsPerBar = BEATS_PER_BAR): number {
  return Math.floor(atBeat / beatsPerBar) + 1;
}

/** The 1-based beat inside its bar. */
export function beatInBar(atBeat: number, beatsPerBar = BEATS_PER_BAR): number {
  return Math.floor(atBeat % beatsPerBar) + 1;
}

/** "Bar 9", or "Bar 9 · beat 3" when it isn't on the first beat. */
export function pinLabel(atBeat: number, beatsPerBar = BEATS_PER_BAR): string {
  const beat = beatInBar(atBeat, beatsPerBar);
  return beat === 1 ? `Bar ${barOfBeat(atBeat, beatsPerBar)}` : `Bar ${barOfBeat(atBeat, beatsPerBar)} · beat ${beat}`;
}

/** "just now", "5 min ago", "2 h ago", "3 d ago". */
export function agoLabel(createdAt: number, now: number): string {
  const sec = Math.max(0, Math.round((now - createdAt) / 1000));
  if (sec < 45) return "just now";
  if (sec < 3600) return `${Math.max(1, Math.round(sec / 60))} min ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)} h ago`;
  return `${Math.round(sec / 86400)} d ago`;
}

/**
 * The notes the tray shows: open or done, optionally only those attached to one channel.
 * Open notes are newest first; done (archived) notes are the most recently written first too.
 */
export function notesForTray(notes: ProjectNote[], opts: { done: boolean; trackId: string | null }): ProjectNote[] {
  return notes
    .filter((n) => n.done === opts.done && (opts.trackId === null || n.trackId === opts.trackId))
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Open notes pinned to a beat, in timeline order — these become the flags on the ruler. */
export function pinnedOpenNotes(notes: ProjectNote[]): ProjectNote[] {
  return notes.filter((n) => !n.done && n.atBeat !== null).sort((a, b) => (a.atBeat as number) - (b.atBeat as number));
}

export interface Member {
  id: string;
  name: string;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Who is tagged in this text: every member whose "@Name" appears in it (longest names matched first). */
export function mentionedIds(text: string, members: Member[]): string[] {
  const found = new Set<string>();
  for (const m of [...members].sort((a, b) => b.name.length - a.name.length)) {
    if (!m.name.trim()) continue;
    if (new RegExp(`(^|\\s)@${escapeRegExp(m.name)}(?![\\p{L}\\p{N}])`, "iu").test(text)) found.add(m.id);
  }
  return [...found];
}

/** The text cut into plain pieces and tagged "@Name" pieces, so the tags can be highlighted. */
export function splitMentions(text: string, names: string[]): { text: string; mention: boolean }[] {
  const clean = names.filter((n) => n.trim()).sort((a, b) => b.length - a.length);
  if (clean.length === 0) return [{ text, mention: false }];
  const re = new RegExp(`(^|\\s)(@(?:${clean.map(escapeRegExp).join("|")}))(?![\\p{L}\\p{N}])`, "giu");
  const parts: { text: string; mention: boolean }[] = [];
  let last = 0;
  for (const match of text.matchAll(re)) {
    const start = (match.index ?? 0) + match[1].length;
    if (start > last) parts.push({ text: text.slice(last, start), mention: false });
    parts.push({ text: match[2], mention: true });
    last = start + match[2].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), mention: false });
  return parts.length ? parts : [{ text, mention: false }];
}

/** The @-tag being typed at the end of `before` (the text left of the cursor), or null. */
export function openMentionQuery(before: string): { query: string; start: number } | null {
  const m = /(^|\s)@([^\s@]*)$/u.exec(before);
  return m ? { query: m[2], start: before.length - m[2].length - 1 } : null;
}
