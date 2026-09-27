import { create } from "zustand";
import { supabase } from "../lib/supabaseClient";
import type { Profile } from "../types/project";

interface AuthState {
  loading: boolean;
  userId: string | null;
  profile: Profile | null;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  init: () => void;
}

async function upsertProfileFromAuthUser(userId: string, meta: Record<string, unknown>) {
  if (!supabase) return null;
  const displayName = (meta.full_name as string) ?? (meta.name as string) ?? null;
  const avatarUrl = (meta.avatar_url as string) ?? (meta.picture as string) ?? null;
  const { data, error } = await supabase
    .from("profiles")
    .upsert({ id: userId, display_name: displayName, avatar_url: avatarUrl }, { onConflict: "id" })
    .select()
    .single();
  if (error) {
    console.error("Failed to create/update profile row:", error);
    return null;
  }
  return data;
}

let initialized = false;

export const useAuthStore = create<AuthState>((set, get) => ({
  loading: true,
  userId: null,
  profile: null,

  signInWithGoogle: async () => {
    if (!supabase) return;
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
  },

  signOut: async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    set({ userId: null, profile: null });
  },

  init: () => {
    if (!supabase) {
      set({ loading: false });
      return;
    }
    // A repeated call (React StrictMode runs effects twice in dev) must NOT end
    // loading early, or the sign-in screen flashes before the session is read.
    if (initialized) return;
    initialized = true;

    // onAuthStateChange is the single source of truth: Supabase guarantees it
    // fires once, right after it has finished figuring out the current
    // session — including parsing a fresh OAuth redirect's #access_token=...
    // hash. A separate getSession() call used to run in parallel with that
    // parsing; on a slow dev server there was enough delay for it to
    // accidentally work, but on a fast production build it could return
    // before the redirect was processed, landing back on the sign-in screen
    // with a valid, unused token still sitting in the URL.
    supabase.auth.onAuthStateChange(async (_event, session) => {
      const user = session?.user;
      if (!user) {
        set({ userId: null, profile: null, loading: false });
        return;
      }
      if (get().userId === user.id) {
        set({ loading: false }); // token refresh etc. — profile is already up to date
        return;
      }
      const profileRow = await upsertProfileFromAuthUser(user.id, user.user_metadata ?? {});
      set({
        userId: user.id,
        profile: profileRow
          ? { id: profileRow.id, displayName: profileRow.display_name, avatarUrl: profileRow.avatar_url }
          : { id: user.id, displayName: null, avatarUrl: null },
        loading: false,
      });
    });
  },
}));
