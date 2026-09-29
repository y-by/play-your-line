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

async function upsertProfileFromAuthUser(userId: string, meta: Record<string, unknown>, email: string | null) {
  if (!supabase) return null;
  const displayName = (meta.full_name as string) ?? (meta.name as string) ?? null;
  const avatarUrl = (meta.avatar_url as string) ?? (meta.picture as string) ?? null;
  // .select() below deliberately omits `email` — that column's SELECT grant
  // is locked to the find_profile_by_email() RPC only (see 0019), so
  // requesting it here (even for one's own row) would fail.
  const { data, error } = await supabase
    .from("profiles")
    .upsert({ id: userId, display_name: displayName, avatar_url: avatarUrl, email }, { onConflict: "id" })
    .select("id, display_name, avatar_url")
    .single();
  if (error) {
    console.error("Failed to create/update profile row:", error);
    return null;
  }
  return data;
}

let initialized = false;

// Google's redirect always lands back on the bare origin (that's the only URL
// registered in Supabase's Redirect URLs, so a deep link like /invite/<token>
// isn't safe to pass as `redirectTo` directly — Supabase would reject it and
// fall back to the site's default anyway). Instead, remember where the user
// was before sending them off, and hop back there ourselves once signed in —
// e.g. so accepting an invite doesn't strand them on the home page instead.
const POST_SIGNIN_REDIRECT_KEY = "pyl_post_signin_redirect";

export const useAuthStore = create<AuthState>((set, get) => ({
  loading: true,
  userId: null,
  profile: null,

  signInWithGoogle: async () => {
    if (!supabase) return;
    try {
      sessionStorage.setItem(POST_SIGNIN_REDIRECT_KEY, window.location.pathname + window.location.search);
    } catch {
      // Worst case (private browsing etc.) they land on the home page instead — sign-in still works.
    }
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
      const profileRow = await upsertProfileFromAuthUser(user.id, user.user_metadata ?? {}, user.email ?? null);
      set({
        userId: user.id,
        profile: profileRow
          ? { id: profileRow.id, displayName: profileRow.display_name, avatarUrl: profileRow.avatar_url }
          : { id: user.id, displayName: null, avatarUrl: null },
        loading: false,
      });

      try {
        const dest = sessionStorage.getItem(POST_SIGNIN_REDIRECT_KEY);
        if (dest) {
          sessionStorage.removeItem(POST_SIGNIN_REDIRECT_KEY);
          if (dest !== window.location.pathname + window.location.search) {
            window.location.replace(dest);
          }
        }
      } catch {
        // Same fallback as above — sign-in already succeeded either way.
      }
    });
  },
}));
