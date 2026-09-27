import { useAuthStore } from "../store/useAuthStore";
import { supabaseConfigured } from "../lib/supabaseClient";
import { GoogleIcon, WaveformIcon } from "./icons/Icons";

export function SignInGate({ children }: { children: React.ReactNode }) {
  const loading = useAuthStore((s) => s.loading);
  const userId = useAuthStore((s) => s.userId);
  const signInWithGoogle = useAuthStore((s) => s.signInWithGoogle);

  if (!supabaseConfigured) {
    return (
      <div className="signin-screen">
        <div className="signin-card">
          <p className="settings-note">
            Supabase isn't configured yet. Set <code>VITE_SUPABASE_URL</code> and{" "}
            <code>VITE_SUPABASE_ANON_KEY</code> in <code>.env.local</code>, then restart the dev server.
          </p>
        </div>
      </div>
    );
  }

  if (loading) return null;

  if (!userId) {
    return (
      <div className="signin-screen">
        <div className="signin-card">
          <span className="signin-icon">
            <WaveformIcon size={32} />
          </span>
          <h1>Play Your Line</h1>
          <p>Sign in to create a song, join a channel, or listen to what's been published.</p>
          <button className="google-signin-btn" onClick={signInWithGoogle}>
            <GoogleIcon />
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
