import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/useAuthStore";
import { getProjectInviteDetails, acceptProjectInvite, type ProjectInviteDetails } from "../lib/projectApi";
import { GoogleIcon, WaveformIcon, CheckIcon } from "../components/icons/Icons";

const ROLE_TEXT = {
  mixer: { title: "Mixer", blurb: "set the final mix (levels and mute)" },
  listener: { title: "Listener", blurb: "listen to the draft" },
} as const;

/** Landing page for a Mixer / Listener invite link (/join/<token>). */
export function JoinPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const userId = useAuthStore((s) => s.userId);
  const authLoading = useAuthStore((s) => s.loading);
  const signInWithGoogle = useAuthStore((s) => s.signInWithGoogle);

  const [details, setDetails] = useState<ProjectInviteDetails | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    if (!token) return;
    getProjectInviteDetails(token)
      .then(setDetails)
      .catch((err) => {
        console.error("Failed to load invite:", err);
        setError("This invite link doesn't look valid.");
      });
  }, [token]);

  const handleAccept = async () => {
    if (!token) return;
    setAccepting(true);
    setError(null);
    try {
      const projectId = await acceptProjectInvite(token);
      navigate(`/song/${projectId}`);
    } catch (err) {
      console.error("Failed to accept invite:", err);
      setError(err instanceof Error ? err.message : "Couldn't accept this invite.");
    } finally {
      setAccepting(false);
    }
  };

  const text = details ? ROLE_TEXT[details.role] : null;

  return (
    <div className="signin-screen">
      <div className="signin-card">
        <span className="signin-icon">
          <WaveformIcon size={32} />
        </span>

        {details === undefined && !error && <p>Loading invite…</p>}
        {(details === null || error) && <p>{error ?? "This invite link isn't valid or has already been used."}</p>}

        {details && text && (
          <>
            <h1>{details.projectTitle}</h1>
            <p>
              You're invited as <strong>{text.title}</strong> — you'll {text.blurb}.
            </p>

            {details.status !== "pending" && <p className="settings-note">This invite has already been used.</p>}

            {details.status === "pending" &&
              (authLoading ? null : !userId ? (
                <button className="google-signin-btn" onClick={signInWithGoogle}>
                  <GoogleIcon />
                  Sign in with Google to accept
                </button>
              ) : (
                <button className="google-signin-btn accept" onClick={handleAccept} disabled={accepting}>
                  <CheckIcon size={16} />
                  {accepting ? "Joining…" : `Join as ${text.title}`}
                </button>
              ))}
          </>
        )}
      </div>
    </div>
  );
}
