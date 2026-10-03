import { useState } from "react";
import { useAuthStore } from "../store/useAuthStore";
import { supabaseConfigured } from "../lib/supabaseClient";
import { GoogleIcon, WaveformIcon } from "./icons/Icons";

/** One-time, right after a new account is created: confirm or change the name others will see. */
function NamePrompt() {
  const googleName = useAuthStore((s) => s.profile?.displayName ?? "");
  const confirmName = useAuthStore((s) => s.confirmName);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const value = draft ?? googleName;

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await confirmName(value.trim() || googleName || "Player");
    } catch (err) {
      console.error("Failed to save the name:", err);
      setError("Couldn't save your name — try again.");
      setSaving(false);
    }
  };

  return (
    <div className="settings-backdrop">
      <div className="settings-panel name-prompt" role="dialog" aria-label="Choose your name">
        <h2>Choose your name</h2>
        <p className="settings-note">
          This is what other people see on your channels and on project cards. It starts as your Google name — use a
          stage name if you prefer. You can change it any time in Settings.
        </p>
        <input
          autoFocus
          className="settings-select"
          value={value}
          placeholder="Name or stage name"
          maxLength={40}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !saving && submit()}
          aria-label="Your display name"
        />
        {error && <p className="assign-error">{error}</p>}
        <button className="google-signin-btn accept" onClick={submit} disabled={saving}>
          {saving ? "Saving…" : "Continue"}
        </button>
      </div>
    </div>
  );
}

export function SignInGate({ children }: { children: React.ReactNode }) {
  const loading = useAuthStore((s) => s.loading);
  const userId = useAuthStore((s) => s.userId);
  const signInWithGoogle = useAuthStore((s) => s.signInWithGoogle);
  const needsName = useAuthStore((s) => s.needsName);

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
          <p>Sign in to create a project, join a channel, or listen to what's been published.</p>
          <button className="google-signin-btn" onClick={signInWithGoogle}>
            <GoogleIcon />
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {children}
      {needsName && <NamePrompt />}
    </>
  );
}
