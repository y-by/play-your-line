import { useState } from "react";
import { useProjectStore } from "../store/useProjectStore";
import type { Project } from "../types/project";
import { PlusCircleIcon, UserPlusIcon, MicIcon, XmarkCircleIcon } from "./icons/Icons";

/** Everyone already in the song besides whoever's on `excludeTrackId` — candidates for direct assignment. */
function participantCandidates(project: Project, excludeTrackId: string) {
  const byId = new Map<string, string | null>();
  if (project.mixerId) byId.set(project.mixerId, project.mixerName);
  for (const t of project.tracks) {
    if (t.id !== excludeTrackId && t.assignedUserId) byId.set(t.assignedUserId, t.assignedPlayerName);
  }
  for (const l of project.listeners) byId.set(l.userId, l.name);
  return Array.from(byId, ([id, name]) => ({ id, name }));
}

export function AddChannelPanel() {
  const project = useProjectStore((s) => s.project);
  const addTrack = useProjectStore((s) => s.addTrack);
  const createInvite = useProjectStore((s) => s.createInvite);
  const claimChannel = useProjectStore((s) => s.claimChannel);
  const assignTrackToUser = useProjectStore((s) => s.assignTrackToUser);
  const assignTrackByEmail = useProjectStore((s) => s.assignTrackByEmail);
  const removeTrack = useProjectStore((s) => s.removeTrack);
  const isInitiator = useProjectStore((s) => s.isInitiator());
  const isParticipant = useProjectStore((s) => s.isParticipant());
  const [instrument, setInstrument] = useState("");
  const [inviteLinks, setInviteLinks] = useState<Record<string, string>>({});
  const [copiedTrackId, setCopiedTrackId] = useState<string | null>(null);
  const [assigningTrackId, setAssigningTrackId] = useState<string | null>(null);
  const [emailInputs, setEmailInputs] = useState<Record<string, string>>({});
  const [assignErrors, setAssignErrors] = useState<Record<string, string>>({});
  const [assigningBusy, setAssigningBusy] = useState<string | null>(null);

  if (!isParticipant || !project) return null;

  const unclaimed = project.tracks.filter((t) => !t.assignedUserId);

  const submit = async () => {
    if (!instrument.trim()) return;
    await addTrack(instrument.trim());
    setInstrument("");
  };

  const handleInvite = async (trackId: string) => {
    try {
      const link = await createInvite(trackId);
      setInviteLinks((prev) => ({ ...prev, [trackId]: link }));
      setCopiedTrackId(null);
      await navigator.clipboard.writeText(link).then(
        () => setCopiedTrackId(trackId),
        () => {}
      );
    } catch (err) {
      console.error("Failed to create invite:", err);
    }
  };

  const handleAssignToUser = async (trackId: string, userId: string) => {
    setAssignErrors((prev) => ({ ...prev, [trackId]: "" }));
    setAssigningBusy(trackId);
    try {
      await assignTrackToUser(trackId, userId);
      setAssigningTrackId(null);
    } catch (err) {
      console.error("Failed to assign the channel:", err);
      setAssignErrors((prev) => ({ ...prev, [trackId]: "Couldn't assign that channel." }));
    } finally {
      setAssigningBusy(null);
    }
  };

  const handleAssignByEmail = async (trackId: string) => {
    const email = emailInputs[trackId]?.trim();
    if (!email) return;
    setAssignErrors((prev) => ({ ...prev, [trackId]: "" }));
    setAssigningBusy(trackId);
    try {
      await assignTrackByEmail(trackId, email);
      setAssigningTrackId(null);
      setEmailInputs((prev) => ({ ...prev, [trackId]: "" }));
    } catch (err) {
      setAssignErrors((prev) => ({ ...prev, [trackId]: err instanceof Error ? err.message : "Couldn't assign that channel." }));
    } finally {
      setAssigningBusy(null);
    }
  };

  return (
    <div className="add-channel-panel">
      <div className="add-track-form">
        <input
          autoFocus
          placeholder="Instrument (e.g. Guitar)"
          value={instrument}
          onChange={(e) => setInstrument(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        <button onClick={submit}>
          <PlusCircleIcon />
          Add Channel
        </button>
      </div>

      {unclaimed.length > 0 && (
        <div className="unclaimed-list">
          <h3>Who plays these channels?</h3>
          <p className="settings-note">
            {isInitiator
              ? "Invite a regular player to record on a channel here. The mixer and listeners are invited from the People section instead."
              : "Anyone can add a channel; only the owner sends the invite that lets someone play it."}
          </p>
          {unclaimed.map((t) => (
            <div key={t.id} className="unclaimed-row">
              <span className="unclaimed-row-instrument">{t.instrument}</span>
              {isInitiator && t.clips.length === 0 && (
                <button className="remove-btn" onClick={() => removeTrack(t.id)} title="Remove this empty channel" aria-label="Remove channel">
                  <XmarkCircleIcon size={16} />
                </button>
              )}
              {!isInitiator ? (
                <span className="settings-note">Waiting for the owner to invite a player.</span>
              ) : inviteLinks[t.id] ? (
                <div className="invite-banner">
                  <span>{copiedTrackId === t.id ? "Copied!" : "Link:"}</span>
                  <input className="invite-link-field" readOnly value={inviteLinks[t.id]} onFocus={(e) => e.target.select()} />
                </div>
              ) : (
                <div className="unclaimed-actions">
                  <button className="unclaimed-invite-btn" onClick={() => claimChannel(t.id)} title="Take this channel and play it yourself">
                    <MicIcon size={13} />
                    I'll play it
                  </button>
                  <button className="unclaimed-invite-btn" onClick={() => handleInvite(t.id)}>
                    <UserPlusIcon size={13} />
                    Invite
                  </button>
                  <button
                    className="unclaimed-invite-btn"
                    onClick={() => setAssigningTrackId(assigningTrackId === t.id ? null : t.id)}
                    title="Assign this channel to someone directly, no invite link needed"
                  >
                    <UserPlusIcon size={13} />
                    Assign
                  </button>
                </div>
              )}
              {isInitiator && assigningTrackId === t.id && (
                <div className="assign-panel">
                  {participantCandidates(project, t.id).length > 0 && (
                    <div className="assign-candidates">
                      {participantCandidates(project, t.id).map((p) => (
                        <button
                          key={p.id}
                          className="assign-candidate-btn"
                          disabled={assigningBusy === t.id}
                          onClick={() => handleAssignToUser(t.id, p.id)}
                        >
                          {p.name ?? "Unnamed player"}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="assign-email-row">
                    <input
                      type="email"
                      placeholder="their@email.com"
                      value={emailInputs[t.id] ?? ""}
                      onChange={(e) => setEmailInputs((prev) => ({ ...prev, [t.id]: e.target.value }))}
                      onKeyDown={(e) => e.key === "Enter" && handleAssignByEmail(t.id)}
                    />
                    <button disabled={assigningBusy === t.id} onClick={() => handleAssignByEmail(t.id)}>
                      Assign
                    </button>
                  </div>
                  {assignErrors[t.id] && <p className="assign-error">{assignErrors[t.id]}</p>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
