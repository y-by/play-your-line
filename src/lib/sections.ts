// Song sections: named marks on the timeline (Intro, Verse, Chorus, Part C...). A mark sits at a place counted in beats and lasts
// until the next mark; the last one runs to the end of the song. Pure, so the rules are tested with plain numbers.
// The beats-per-bar of a section is stored but not used yet (a different time signature for each section comes later).

export interface Section {
  id: string;
  projectId: string;
  name: string;
  color: string;
  /** Where the section starts, in beats from the beginning of the song (normally the first beat of a bar). */
  atBeat: number;
  /** A time signature for this section only. Not used yet: always null today. */
  beatsPerBar: number | null;
}

export const SECTION_NAME_MAX = 40;

/** The names offered to pick from, each with its own colour so the song reads like a map. */
export const SECTION_PRESETS: { name: string; color: string }[] = [
  { name: "Intro", color: "#5ac8fa" },
  { name: "Verse", color: "#34c759" },
  { name: "Pre-chorus", color: "#ffcc00" },
  { name: "Chorus", color: "#ff9500" },
  { name: "Bridge", color: "#af52de" },
  { name: "Solo", color: "#ff2d55" },
  { name: "Outro", color: "#8e8e93" },
  { name: "Part A", color: "#0a84ff" },
  { name: "Part B", color: "#30b0c7" },
  { name: "Part C", color: "#bf5af2" },
  { name: "Part D", color: "#ff6b35" },
];

/** The colours to choose from for a custom name. */
export const SECTION_COLORS: string[] = [...SECTION_PRESETS.map((p) => p.color), "#a2845e", "#64d2ff"];

/** A name as stored: trimmed, single spaces, at most 40 characters. */
export function cleanSectionName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, SECTION_NAME_MAX);
}

/** The colour for a name: the preset's own when the name is one of them (any capitals), otherwise the first colour not yet used in this song. */
export function sectionColorFor(name: string, used: string[]): string {
  const preset = SECTION_PRESETS.find((p) => p.name.toLowerCase() === cleanSectionName(name).toLowerCase());
  if (preset) return preset.color;
  return SECTION_COLORS.find((c) => !used.includes(c)) ?? SECTION_COLORS[used.length % SECTION_COLORS.length];
}

/** The first beat of the bar a beat falls in (bars of `beatsPerBar` beats, the first bar starting at beat 0). */
export function barStartBeat(beat: number, beatsPerBar: number): number {
  const bars = Math.max(1, Math.round(beatsPerBar));
  return Math.floor(Math.max(0, beat) / bars + 1e-9) * bars;
}

/** Bar number (the first bar is 1) at a beat. */
export function barNumberAt(beat: number, beatsPerBar: number): number {
  return Math.floor(Math.max(0, beat) / Math.max(1, Math.round(beatsPerBar)) + 1e-9) + 1;
}

export interface SectionRange {
  section: Section;
  startBeat: number;
  /** Where it ends: the next mark, or the end of the song. */
  endBeat: number;
}

/** The marks in order of place, each lasting until the next one; the last one lasts until `songEndBeat`. */
export function sectionRanges(sections: Section[], songEndBeat: number): SectionRange[] {
  const sorted = [...sections].sort((a, b) => a.atBeat - b.atBeat);
  return sorted.map((section, i) => ({
    section,
    startBeat: section.atBeat,
    endBeat: i + 1 < sorted.length ? sorted[i + 1].atBeat : Math.max(songEndBeat, section.atBeat + 1),
  }));
}

/** The section a beat is in, or null before the first mark. */
export function sectionAtBeat(sections: Section[], beat: number): Section | null {
  let found: Section | null = null;
  for (const s of [...sections].sort((a, b) => a.atBeat - b.atBeat)) {
    if (s.atBeat <= beat + 1e-9) found = s;
    else break;
  }
  return found;
}

/** True when no other section already starts at this beat (the section being moved is ignored). */
export function placeIsFree(sections: Section[], atBeat: number, ignoreId?: string): boolean {
  return !sections.some((s) => s.id !== ignoreId && Math.abs(s.atBeat - atBeat) < 0.001);
}

/**
 * Where a section's start may go when it is dragged: to the nearest bar, never closer than one bar to the section before it or the
 * one after it (so two marks never meet or swap), and never before the start of the song.
 */
export function dragSectionStart(sections: Section[], id: string, beat: number, beatsPerBar: number): number {
  const bars = Math.max(1, Math.round(beatsPerBar));
  const sorted = [...sections].sort((a, b) => a.atBeat - b.atBeat);
  const i = sorted.findIndex((s) => s.id === id);
  const min = i > 0 ? sorted[i - 1].atBeat + bars : 0;
  const max = i >= 0 && i + 1 < sorted.length ? sorted[i + 1].atBeat - bars : Number.POSITIVE_INFINITY;
  const nearest = Math.round(Math.max(0, beat) / bars) * bars;
  return Math.max(min, Math.min(max, nearest));
}
