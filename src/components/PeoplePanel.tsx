import { useState } from "react";
import { useProjectStore } from "../store/useProjectStore";
import { errorMessage } from "../lib/errorMessage";
import { UserPlusIcon } from "./icons/Icons";

type LinkKind = "mixer" | "listener";

interface Member {
  id: string;
  name: string;
  channels: string[];
  isMixer: boolean;
  isListener: boolean;
}

/** Owner only: who is in the project, adding people (link or email), and choosing the Mixer. */
export function PeoplePanel() {
  const project = useProjectStore((s) => s.project);
  const createRoleInvite = useProjectStore((s) => s.createRoleInvite);
  const addMemberByEmail = useProjectStore((s) => s.addMemberByEmail);
  const setMixer = useProjectStore((s) => s.setMixer);
  const removeListener = useProjectStore((s) => s.removeListener);
  const [links, setLinks] = useState<Partial<Record<LinkKind, string>>>({});
  const [copied, setCopied] = useState<LinkKind | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null);

  if (!project) return null;

  // Everyone in the project except the Owner, once each, with what they do.
  const members = new Map<string, Member>();
  const entry = (id: string, name: string | null): Member => {
    let m = members.get(id);
    if (!m) {
      m = { id, name: name ?? "Player", channels: [], isMixer: false, isListener: false };
      members.set(id, m);
    }
    if (name) m.name = name;
    return m;
  };
  for (const t of project.tracks) {
    if (t.assignedUserId && t.assignedUserId !== project.initiatorId) entry(t.assignedUserId, t.assignedPlayerName).channels.push(t.instrument);
  }
  if (project.mixerId && project.mixerId !== project.initiatorId) entry(project.mixerId, project.mixerName).isMixer = true;
  for (const l of project.listeners) {
    if (l.userId !== project.initiatorId) entry(l.userId, l.name).isListener = true;
  }
  const roster = [...members.values()];

  const invite = async (kind: LinkKind) => {
    setMessage(null);
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
      setMessage({ text: errorMessage(err, "Couldn't create that invite."), bad: true });
    }
  };

  const addByEmail = async () => {
    if (!email.trim() || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const name = await addMemberByEmail(email);
      setEmail("");
      setMessage({ text: `${name} is in. They can listen and add their own channel.`, bad: false });
    } catch (err) {
      setMessage({ text: errorMessage(err, "Couldn't add that person."), bad: true });
    } finally {
      setBusy(false);
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
      <div className="people-section">
        <h3>In this project</h3>
        {roster.length === 0 && <p className="settings-note">Just you so far. Add people below.</p>}
        {roster.map((m) => (
          <div key={m.id} className="people-row">
            <span className="people-name">
              {m.name}
              <span className="people-tags">
                {m.isMixer && <em className="people-tag mixer">Mixer</em>}
                {m.channels.length > 0 && <em className="people-tag">Plays {m.channels.join(", ")}</em>}
                {m.channels.length === 0 && m.isListener && !m.isMixer && <em className="people-tag muted">No channel yet</em>}
              </span>
            </span>
            {m.isMixer ? (
              <button className="unclaimed-invite-btn" onClick={() => setMixer(null)}>
                Not the mixer
              </button>
            ) : (
              <button className="unclaimed-invite-btn" onClick={() => setMixer(m.id)} title="Let them set the final mix (levels, mute and pan)">
                Make mixer
              </button>
            )}
            {m.isListener && m.channels.length === 0 && !m.isMixer && (
              <button className="remove-btn" onClick={() => removeListener(m.id)} title="Remove from the project" aria-label="Remove from the project">
                ✕
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="people-section">
        <h3>Add someone</h3>
        <p className="settings-note">
          They can listen, and add and play their own channel. You can also give them a channel yourself from Channels.
        </p>
        <div className="people-row">
          <button className="unclaimed-invite-btn" onClick={() => invite("listener")}>
            <UserPlusIcon size={13} />
            Copy an invite link
          </button>
        </div>
        {linkRow("listener")}
        <div className="assign-email-row">
          <input
            type="email"
            placeholder="or their email, if they have an account"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addByEmail()}
            aria-label="Email of the person to add"
          />
          <button disabled={busy || !email.trim()} onClick={addByEmail}>
            Add
          </button>
        </div>
      </div>

      {!project.mixerId && (
        <div className="people-section">
          <h3>Mixer</h3>
          <p className="settings-note">One person who sets the final mix (levels, mute and pan). They can't touch anyone's recordings. Pick someone above, or send a link.</p>
          <div className="people-row">
            <button className="unclaimed-invite-btn" onClick={() => invite("mixer")}>
              <UserPlusIcon size={13} />
              Invite a mixer
            </button>
          </div>
          {linkRow("mixer")}
        </div>
      )}

      {message && <p className={message.bad ? "assign-error" : "settings-note"}>{message.text}</p>}
    </div>
  );
}
