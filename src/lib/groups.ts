// Group channels (busses): plain data and rules, so they are testable without an audio context.
// The audio graph is in the engine (audioEngine.ts) and the export (mixdown.ts).

import type { ChannelFx, Group, Track } from "../types/project";
import { clampFx, DEFAULT_CHANNEL_FX } from "./channelFx.ts";

/** The saved effects json of a group (anything missing is neutral, every number is clamped). */
export function parseGroupFx(json: unknown): ChannelFx {
  const obj = json && typeof json === "object" && !Array.isArray(json) ? (json as Record<string, unknown>) : {};
  return { ...DEFAULT_CHANNEL_FX, ...clampFx(obj as Partial<ChannelFx>) };
}

/** A groups row (or a live update of one). `fallback` supplies what a partial update does not mention. */
export function groupFromRow(row: Record<string, unknown>, fallback?: Group): Group {
  return {
    id: row.id as string,
    projectId: (row.project_id as string) ?? fallback?.projectId ?? "",
    name: typeof row.name === "string" ? row.name : (fallback?.name ?? "Group"),
    color: typeof row.color === "string" ? row.color : (fallback?.color ?? "#8e8e93"),
    position: typeof row.position === "number" ? row.position : (fallback?.position ?? 0),
    volume: typeof row.volume === "number" ? Math.min(4, Math.max(0, row.volume)) : (fallback?.volume ?? 1),
    muted: typeof row.muted === "boolean" ? row.muted : (fallback?.muted ?? false),
    pan: typeof row.pan === "number" ? Math.min(1, Math.max(-1, row.pan)) : (fallback?.pan ?? 0),
    fx: "fx" in row ? parseGroupFx(row.fx) : (fallback?.fx ?? DEFAULT_CHANNEL_FX),
  };
}

/** The effects as the json to save. */
export function groupFxToJson(fx: ChannelFx): Record<string, number | boolean> {
  return { ...fx };
}

// ---- Which rows the screen shows --------------------------------------------------------------------------------------

export type Row = { kind: "group"; group: Group; members: Track[] } | { kind: "lane"; track: Track; group: Group | null };

/**
 * The rows of the channel list: a channel that is not in a group is one row; the first channel of a group brings the
 * group's header row, followed by all the channels in it (they stay together, in the order they have). A folded group
 * shows only its header row. A channel whose group no longer exists counts as ungrouped.
 */
export function buildRows(ordered: Track[], groups: Group[], collapsed: ReadonlySet<string> = new Set()): Row[] {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const rows: Row[] = [];
  const done = new Set<string>();
  for (const t of ordered) {
    const g = t.groupId ? byId.get(t.groupId) : undefined;
    if (!g) {
      rows.push({ kind: "lane", track: t, group: null });
      continue;
    }
    if (done.has(g.id)) continue;
    done.add(g.id);
    const members = ordered.filter((m) => m.groupId === g.id);
    rows.push({ kind: "group", group: g, members });
    if (!collapsed.has(g.id)) for (const m of members) rows.push({ kind: "lane", track: m, group: g });
  }
  return rows;
}

/** The channels in the order the screen shows them (folded groups' channels are not shown, so they are left out). */
export function visibleLanes(rows: Row[]): Track[] {
  return rows.flatMap((r) => (r.kind === "lane" ? [r.track] : []));
}

/** Every channel in the order the screen would show them if no group were folded. */
export function groupedOrder(ordered: Track[], groups: Group[]): Track[] {
  return visibleLanes(buildRows(ordered, groups));
}

// ---- Who is heard: mute and solo with groups ------------------------------------------------------------------------

export interface MixTrack {
  id: string;
  groupId: string | null;
  volume: number;
  muted: boolean;
  solo: boolean;
}
export interface MixGroup {
  id: string;
  volume: number;
  muted: boolean;
  solo: boolean;
}

/**
 * The level each channel and each group plays at. One rule, used by playback (the export ignores solo).
 *  - Nothing soloed: a muted channel is silent; a muted group silences everything in it.
 *  - Something soloed: solo beats mute. A soloed channel is heard, and so is the group it sits in (that group's
 *    own mute is ignored). A soloed group plays all its channels. Everything else is silent.
 */
export function resolveMix(tracks: MixTrack[], groups: MixGroup[]): { tracks: Record<string, number>; groups: Record<string, number> } {
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const anySolo = tracks.some((t) => t.solo) || groups.some((g) => g.solo);
  const out = { tracks: {} as Record<string, number>, groups: {} as Record<string, number> };
  for (const g of groups) {
    const open = anySolo ? g.solo || tracks.some((t) => t.groupId === g.id && t.solo) : !g.muted;
    out.groups[g.id] = open ? g.volume : 0;
  }
  for (const t of tracks) {
    const g = t.groupId ? groupById.get(t.groupId) : undefined;
    const audible = anySolo ? t.solo || !!g?.solo : !t.muted;
    out.tracks[t.id] = audible ? t.volume : 0;
  }
  return out;
}
