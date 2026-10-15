import { create } from "zustand";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "../lib/supabaseClient";
import { fetchAccountStatus, touchLastSeen, type AccountStatus } from "../lib/adminApi";
import { useAuthStore } from "./useAuthStore";

/**
 * The signed-in person's standing in the whole system (migration 0046): system owner (admin), blocked, or asked to
 * sign out. Read once at sign-in and kept live, so a block or a forced sign-out lands within a second.
 */
interface AccountState extends AccountStatus {
  loaded: boolean;
  start: (userId: string) => void;
  stop: () => void;
  heartbeat: (projectId: string | null) => void;
}

let channel: RealtimeChannel | null = null;
let watchedUserId: string | null = null;

/** Signs out when the admin asked for it after this session began. */
async function honourForcedSignOut(signoutAfter: string | null) {
  if (!signoutAfter || !supabase) return;
  const { data } = await supabase.auth.getSession();
  const since = data.session?.user?.last_sign_in_at;
  if (since && new Date(signoutAfter).getTime() > new Date(since).getTime()) {
    await useAuthStore.getState().signOut();
  }
}

export const useAccountStore = create<AccountState>((set, get) => ({
  isAdmin: false,
  blocked: false,
  blockedReason: null,
  signoutAfter: null,
  loaded: false,

  start: (userId) => {
    if (!supabase || watchedUserId === userId) return;
    get().stop();
    watchedUserId = userId;
    void fetchAccountStatus().then((status) => {
      if (watchedUserId !== userId) return;
      set({ ...status, loaded: true });
      void honourForcedSignOut(status.signoutAfter);
    });
    channel = supabase
      .channel(`account:${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "user_status", filter: `user_id=eq.${userId}` }, (p) => {
        const row = (p.eventType === "DELETE" ? p.old : p.new) as Record<string, unknown>;
        if (p.eventType === "DELETE") {
          set({ isAdmin: false, blocked: false, blockedReason: null, signoutAfter: null });
          return;
        }
        const wasBlocked = get().blocked;
        const next = {
          isAdmin: !!row.is_admin,
          blocked: !!row.blocked,
          blockedReason: (row.blocked_reason as string | null) ?? null,
          signoutAfter: (row.signout_after as string | null) ?? null,
        };
        set(next);
        if (next.signoutAfter !== null) void honourForcedSignOut(next.signoutAfter);
        // Unblocked: start clean, everything that failed while blocked loads again.
        if (wasBlocked && !next.blocked) window.location.reload();
      })
      .subscribe();
  },

  stop: () => {
    if (channel && supabase) void supabase.removeChannel(channel);
    channel = null;
    watchedUserId = null;
    set({ isAdmin: false, blocked: false, blockedReason: null, signoutAfter: null, loaded: false });
  },

  heartbeat: (projectId) => {
    if (!watchedUserId || get().blocked) return;
    touchLastSeen(projectId).catch(() => {
      // Before 0046, or offline: the dashboard just shows an older "last seen".
    });
  },
}));
