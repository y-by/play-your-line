import { useState } from "react";
import { useProjectStore } from "../store/useProjectStore";
import { UserPlusIcon } from "./icons/Icons";

type LinkKind = "mixer" | "listener";

/** Owner only: choose the Mixer and manage Listeners. */
export function PeoplePanel() {
  const project = useProjectStore((s) => s.project);
  const createRoleInvite = useProjectStore((s) => s.createRoleInvite);
  const setMixer = useProjectStore((s) => s.setMixer);
  const removeListener = useProjectStore((s) => s.removeListener);
  const [links, setLinks] = useState<Partial<Record<LinkKind, string>>>({});
  const [copied, setCopied] = useState<LinkKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!project) return null;

  // Anyone already in the song (players and listeners) can be named the Mixer.
  const candidates = new Map<string, string>();
  for (const t of project.tracks) {
    if (t.assignedUserId && t.assignedUserId !== project.initiatorId) candidates.set(t.assignedUserId, t.assignedPlayerName ?? "Player");
  }
  for (const l of project.listeners) candidates.set(l.userId, l.name ?? "Listener");
  if (project.mixerId) candidates.delete(project.mixerId);

  const invite = async (kind: LinkKind) => {
    setError(null);
    try {
      const link = await createRoleInvite(kind);
      setLinks((prev) => ({ ...prev, [kind]: link }));
      setCopied(null);
      await navigator.clipboard.writeText(link).then(
        () => setCopied(kind),
        () => {}
      );
    } catch (err) {
      console.error("Failed to create invite:", err);
      setError(err instanceof Error ? err.message : "Couldn't create that invite.");
    }
  };

  const linkRow = (kind: LinkKind) =>
    links[kind] && (
      <div className="invite-banner">
        <span>{copied === kind ? "Copied!" : "Link:"}</span>
        <input className="invite-link-field" readOnly value={links[kind]} onFocus={(e) => e.target.select()} />
      </div>
    );

  return (
    <div className="add-channel-panel people-panel">
      <p className="settings-note">
        Invite people for roles beyond playing an instrument — a mixer to balance levels, or listeners to hear the
        draft.
      </p>
      <div className="people-section">
        <h3>Mixer</h3>
        <p className="settings-note">One person who sets the final mix (levels and mute). They can't touch anyone's recordings.</p>
        {project.mixerId ? (
          <div className="people-row">
            <span className="people-name">{project.mixerName ?? "Mixer"}</span>
            <button className="unclaimed-invite-btn" onClick={() => setMixer(null)}>
              Remove
            </button>
          </div>
        ) : (
          <div className="people-row">
            <span className="people-name muted">Nobody — you mix</span>
            {candidates.size > 0 && (
              <select
                className="people-select"
                value=""
                onChange={(e) => e.target.value && setMixer(e.target.value)}
                aria-label="Make someone the mixer"
              >
                <option value="">Make mixer…</option>
                {[...candidates].map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            )}
            <button className="unclaimed-invite-btn" onClick={() => invite("mixer")}>
              <UserPlusIcon size={13} />
              Invite a mixer
            </button>
          </div>
        )}
        {!project.mixerId && linkRow("mixer")}
      </div>

      <div className="people-section">
        <h3>Listeners</h3>
        <p className="settings-note">Invited people who can hear the draft, nothing else.</p>
        {project.listeners.map((l) => (
          <div key={l.userId} className="people-row">
            <span className="people-name">{l.name ?? "Listener"}</span>
            <button className="unclaimed-invite-btn" onClick={() => removeListener(l.userId)}>
              Remove
            </button>
          </div>
        ))}
        <div className="people-row">
          <button className="unclaimed-invite-btn" onClick={() => invite("listener")}>
            <UserPlusIcon size={13} />
            Invite a listener
          </button>
        </div>
        {linkRow("listener")}
      </div>
      {error && <p className="settings-note">{error}</p>}
    </div>
  );
}
