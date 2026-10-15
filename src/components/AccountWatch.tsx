import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useAuthStore } from "../store/useAuthStore";
import { useAccountStore } from "../store/useAccountStore";

const HEARTBEAT_MS = 60_000;

/**
 * Runs for every signed-in person: keeps their account status live (admin / blocked / forced sign-out), sends the
 * "I'm here" heartbeat the owner dashboard reads (once a minute while the tab is visible, and on every page change),
 * and covers the app with the blocked screen when the account is blocked.
 */
export function AccountWatch() {
  const userId = useAuthStore((s) => s.userId);
  const signOut = useAuthStore((s) => s.signOut);
  const start = useAccountStore((s) => s.start);
  const stop = useAccountStore((s) => s.stop);
  const heartbeat = useAccountStore((s) => s.heartbeat);
  const blocked = useAccountStore((s) => s.blocked);
  const reason = useAccountStore((s) => s.blockedReason);
  const loaded = useAccountStore((s) => s.loaded);
  const { pathname } = useLocation();
  const projectId = pathname.match(/^\/song\/([0-9a-f-]{36})/)?.[1] ?? null;

  useEffect(() => {
    if (userId) start(userId);
    else stop();
  }, [userId, start, stop]);

  useEffect(() => {
    if (!userId || !loaded) return;
    const beat = () => {
      if (document.visibilityState === "visible") heartbeat(projectId);
    };
    beat();
    const timer = window.setInterval(beat, HEARTBEAT_MS);
    document.addEventListener("visibilitychange", beat);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", beat);
    };
  }, [userId, loaded, projectId, heartbeat]);

  if (!userId || !blocked) return null;

  return (
    <div className="blocked-screen" role="alertdialog" aria-labelledby="blocked-title">
      <div className="blocked-card">
        <h1 id="blocked-title">This account is blocked</h1>
        <p>You can't open or change projects in Play Your Line right now.</p>
        {reason && <p className="blocked-reason">“{reason}”</p>}
        <button className="link-btn" onClick={signOut}>
          Sign out
        </button>
      </div>
    </div>
  );
}
