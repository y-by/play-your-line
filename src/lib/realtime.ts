import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";

export type RealtimeStatus = "connecting" | "live" | "offline";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;
export interface PresentUser {
  userId: string;
  name: string;
}
export type ChangeType = "INSERT" | "UPDATE" | "DELETE";

export interface RealtimeHandlers {
  onProject: (row: Row) => void;
  onTrack: (type: ChangeType, row: Row) => void;
  onClip: (type: ChangeType, row: Row) => void;
  onGroup: (type: ChangeType, row: Row) => void;
  onListeners: () => void;
  onNote: (type: ChangeType, row: Row) => void;
  onStatus: (status: RealtimeStatus) => void;
  /** Who has this song open right now (each person once, even on several devices). */
  onPresence: (users: PresentUser[]) => void;
}

let subscriptionCount = 0;

/**
 * Listens for changes other people make to this song (Supabase Realtime).
 * What arrives is already filtered by the same permission rules as normal
 * reads. Returns a function that stops listening.
 */
export function subscribeToProject(projectId: string, handlers: RealtimeHandlers, me: PresentUser | null): () => void {
  if (!supabase) return () => {};
  const client = supabase;

  // A fresh name every time: the library hands back the SAME channel for a name it still has, and removing
  // the old one takes a moment, so re-entering a song quickly would try to add listeners to a live channel.
  const channel: RealtimeChannel = client
    .channel(`song:${projectId}:${++subscriptionCount}`, { config: { presence: { key: me?.userId ?? "anonymous" } } })
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "projects", filter: `id=eq.${projectId}` }, (p) =>
      handlers.onProject(p.new)
    )
    .on("postgres_changes", { event: "*", schema: "public", table: "tracks", filter: `project_id=eq.${projectId}` }, (p) =>
      handlers.onTrack(p.eventType as ChangeType, p.eventType === "DELETE" ? p.old : p.new)
    )
    .on("postgres_changes", { event: "*", schema: "public", table: "track_groups", filter: `project_id=eq.${projectId}` }, (p) =>
      handlers.onGroup(p.eventType as ChangeType, p.eventType === "DELETE" ? p.old : p.new)
    )
    .on("postgres_changes", { event: "*", schema: "public", table: "project_listeners", filter: `project_id=eq.${projectId}` }, () =>
      handlers.onListeners()
    )
    // Clips carry no project id, so every visible clip change arrives and the store ignores other songs' channels.
    .on("postgres_changes", { event: "*", schema: "public", table: "clips" }, (p) =>
      handlers.onClip(p.eventType as ChangeType, p.eventType === "DELETE" ? p.old : p.new)
    )
    // Notes: DELETE events can't be filtered by project, so every visible note change arrives and the store checks the project.
    .on("postgres_changes", { event: "*", schema: "public", table: "project_notes" }, (p) =>
      handlers.onNote(p.eventType as ChangeType, p.eventType === "DELETE" ? p.old : p.new)
    )
    .on("presence", { event: "sync" }, () => {
      const state = channel.presenceState() as Record<string, { name?: string }[]>;
      handlers.onPresence(Object.entries(state).map(([userId, metas]) => ({ userId, name: metas[0]?.name ?? "Someone" })));
    })
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        handlers.onStatus("live");
        if (me) void channel.track({ name: me.name });
      }
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") handlers.onStatus("offline");
      else handlers.onStatus("connecting");
    });

  return () => {
    void client.removeChannel(channel);
  };
}
