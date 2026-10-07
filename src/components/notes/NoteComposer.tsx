import { useState } from "react";
import { useProjectStore } from "../../store/useProjectStore";
import { beatSec } from "../../lib/grid";
import { barOfBeat, mentionedIds } from "../../lib/notes";
import { MentionTextarea } from "./MentionTextarea";
import { BarPin } from "./BarPin";
import { useMembers } from "./useMembers";

/** Write a note: tag people with @, pin it to any bar, attach it to a channel, share it with listeners. */
export function NoteComposer({ autoFocus }: { autoFocus?: boolean }) {
  const addNote = useProjectStore((s) => s.addNote);
  const tracks = useProjectStore((s) => s.project?.tracks ?? []);
  const bpm = useProjectStore((s) => s.project?.bpm ?? 120);
  const positionSec = useProjectStore((s) => s.positionSec);
  const beatsPerBar = useProjectStore((s) => s.project?.beatsPerBar ?? 4);
  const channelFilter = useProjectStore((s) => s.noteChannelFilter);
  const [text, setText] = useState("");
  const members = useMembers();
  const [barChoice, setBarChoice] = useState<number | null>(null);
  const [pinChoice, setPinChoice] = useState<boolean | null>(null); // null = follow the default
  const [trackChoice, setTrackChoice] = useState<string | null>(null);
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);

  const beat = Math.floor(positionSec / beatSec(bpm));
  const bar = barChoice ?? barOfBeat(beat, beatsPerBar);
  const pinned = pinChoice ?? positionSec > 0.05; // by default a note lands on the bar you are listening to
  const trackId = trackChoice ?? channelFilter ?? "";

  const submit = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    await addNote({ body: text, atBeat: pinned ? (bar - 1) * beatsPerBar : null, mentions: mentionedIds(text, members), trackId: trackId || null, sharedWithListeners: shared });
    setText("");
    setPinChoice(null);
    setBarChoice(null);
    setBusy(false);
  };

  return (
    <div className="note-composer">
      <MentionTextarea
        autoFocus={autoFocus}
        value={text}
        onChange={setText}
        members={members}
        placeholder="Leave a note for the others… type @ to tag someone"
        label="New note"
        onSubmit={() => void submit()}
      />
      <div className="note-options">
        <BarPin pinned={pinned} bar={bar} onPinned={setPinChoice} onBar={setBarChoice} />
        <select className="note-opt" value={trackId} onChange={(e) => setTrackChoice(e.target.value)} aria-label="Attach to a channel">
          <option value="">No channel</option>
          {tracks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.instrument}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={shared ? "note-opt on" : "note-opt"}
          onClick={() => setShared(!shared)}
          aria-pressed={shared}
          title="Let listeners read this note too"
        >
          {shared ? "Listeners can read it" : "Show to listeners"}
        </button>
        <button type="button" className="note-send" disabled={!text.trim() || busy} onClick={() => void submit()}>
          Add note
        </button>
      </div>
    </div>
  );
}
