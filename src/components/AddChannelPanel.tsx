import { useState } from "react";
import { useProjectStore } from "../store/useProjectStore";
import { PlusCircleIcon, UserPlusIcon, MicIcon } from "./icons/Icons";

export function AddChannelPanel() {
  const project = useProjectStore((s) => s.project);
  const addTrack = useProjectStore((s) => s.addTrack);
  const createInvite = useProjectStore((s) => s.createInvite);
  const claimChannel = useProjectStore((s) => s.claimChannel);
  const isInitiator = useProjectStore((s) => s.isInitiator());
  const [instrument, setInstrument] = useState("");
  const [inviteLinks, setInviteLinks] = useState<Record<string, string>>({});
  const [copiedTrackId, setCopiedTrackId] = useState<string | null>(null);

  if (!isInitiator || !project) return null;

  const unclaimed = project.tracks.filter((t) => !t.assignedUserId);

  const submit = () => {
    if (!instrument.trim()) return;
    addTrack(instrument.trim());
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
            Invite a regular player to record on a channel here. The mixer and listeners are invited from the People
            section instead.
          </p>
          {unclaimed.map((t) => (
            <div key={t.id} className="unclaimed-row">
              <span className="unclaimed-row-instrument">{t.instrument}</span>
              {inviteLinks[t.id] ? (
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
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
