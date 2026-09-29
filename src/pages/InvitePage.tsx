import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/useAuthStore";
import { getInviteDetails, acceptTrackInvite, type InviteDetails } from "../lib/projectApi";
import { GoogleIcon, WaveformIcon, CheckIcon } from "../components/icons/Icons";

/** Supabase errors are plain objects with a `.message`, not `instanceof Error` — this catches both. */
function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) return String((err as { message: unknown }).message);
  return fallback;
}

export function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const userId = useAuthStore((s) => s.userId);
  const authLoading = useAuthStore((s) => s.loading);
  const signInWithGoogle = useAuthStore((s) => s.signInWithGoogle);

  const [details, setDetails] = useState<InviteDetails | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    if (!token) return;
    getInviteDetails(token)
      .then(setDetails)
      .catch((err) => {
        console.error("Failed to load invite:", err);
        setError(errorMessage(err, "This invite link doesn't look valid."));
      });
  }, [token]);

  const handleAccept = async () => {
    if (!token) return;
    setAccepting(true);
    setError(null);
    try {
      await acceptTrackInvite(token);
      navigate(details ? `/song/${details.projectId}` : "/");
    } catch (err) {
      console.error("Failed to accept invite:", err);
      setError(errorMessage(err, "Couldn't accept this invite."));
    } finally {
      setAccepting(false);
    }
  };

  return (
    <div className="signin-screen">
      <div className="signin-card">
        <span className="signin-icon">
          <WaveformIcon size={32} />
        </span>

        {details === undefined && !error && <p>Loading invite…</p>}
        {(details === null || error) && <p>{error ?? "This invite link isn't valid or has already been used."}</p>}

        {details && (
          <>
            <h1>{details.projectTitle}</h1>
            <p>
              You're invited to play <strong>{details.instrument}</strong> on this song.
            </p>

            {details.status !== "pending" && <p className="settings-note">This invite has already been used.</p>}

            {details.status === "pending" && (
              <>
                {authLoading ? null : !userId ? (
                  <button className="google-signin-btn" onClick={signInWithGoogle}>
                    <GoogleIcon />
                    Sign in with Google to accept
                  </button>
                ) : (
                  <button className="google-signin-btn accept" onClick={handleAccept} disabled={accepting}>
                    <CheckIcon size={16} />
                    {accepting ? "Joining…" : `Join as ${details.instrument}`}
                  </button>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
