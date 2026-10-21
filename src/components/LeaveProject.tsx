import { useState } from "react";
import { useProjectStore } from "../store/useProjectStore";
import { errorMessage } from "../lib/errorMessage";

/**
 * Settings > General, inside a project: leave it. A Listener, Player or Mixer just leaves. The Owner picks who takes
 * over first. Recordings are never deleted by someone leaving: empty channels become free, channels with
 * recordings pass to the Owner (leave_project, 0050).
 */
export function LeaveProject({ onLeft }: { onLeft: () => void }) {
  const project = useProjectStore((s) => s.project);
  const isOwner = useProjectStore((s) => s.isInitiator());
  const noRole = useProjectStore((s) => s.hasNoRole());
  const quitProject = useProjectStore((s) => s.quitProject);
  const [successor, setSuccessor] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!project || noRole) return null;

  // Everyone else in the project, once each.
  const others = new Map<string, string>();
  const add = (id: string | null, name: string | null) => {
    if (id && id !== project.initiatorId) others.set(id, name ?? others.get(id) ?? "Player");
  };
  add(project.mixerId, project.mixerName);
  for (const t of project.tracks) add(t.assignedUserId, t.assignedPlayerName);
  for (const l of project.listeners) add(l.userId, l.name);

  const leave = async () => {
    const name = others.get(successor);
    const text = isOwner
      ? `Hand "${project.title}" over to ${name} and leave?\n\n${name} becomes the Owner. Your channels with recordings pass to them; empty ones become free.`
      : `Leave "${project.title}"?\n\nIt disappears from your list. Any channel of yours with recordings stays in the project with the Owner (they can delete it); empty channels become free. You can only come back if the Owner invites you again.`;
    if (!confirm(text)) return;
    setBusy(true);
    setError(null);
    try {
      await quitProject(isOwner ? successor : null);
      onLeft();
    } catch (err) {
      console.error("Failed to leave the project:", err);
      setError(errorMessage(err, "Couldn't leave the project. Try again."));
      setBusy(false);
    }
  };

  return (
    <section className="settings-section">
      <h3>Leave this project</h3>
      {isOwner ? (
        others.size === 0 ? (
          <p className="settings-note">You're the only one in this project. To end it, delete it in the Project tab.</p>
        ) : (
          <>
            <p className="settings-note">Pick who takes over as Owner. They have to be in the project already.</p>
            <div className="settings-row">
              <select className="settings-select" value={successor} onChange={(e) => setSuccessor(e.target.value)} aria-label="Who takes over as Owner">
                <option value="">Choose a person…</option>
                {[...others].map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
              <button className="settings-toggle" disabled={busy || !successor} onClick={leave}>
                {busy ? "Leaving…" : "Hand over and leave…"}
              </button>
            </div>
          </>
        )
      ) : (
        <>
          <p className="settings-note">Take yourself out of this project. Your recordings stay in it, with the Owner.</p>
          <button className="settings-toggle" disabled={busy} onClick={leave}>
            {busy ? "Leaving…" : "Leave this project…"}
          </button>
        </>
      )}
      {error && <p className="assign-error">{error}</p>}
    </section>
  );
}
