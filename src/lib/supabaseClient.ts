import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Both the URL and anon key are meant to be public in a client app — access
// control is enforced by the RLS policies in supabase/migrations, not by
// keeping these secret. Never put the service_role key here.
export const supabaseConfigured = Boolean(url && anonKey);

export const supabase = supabaseConfigured
  ? createClient(url, anonKey)
  : null;

if (!supabaseConfigured) {
  console.warn(
    "Supabase is not configured — set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local. " +
      "Collaboration (accounts, invites, publishing) is unavailable until then."
  );
}
