import { useEffect, useState } from "react";
import type { ProjectNote } from "../../types/project";
import { useProjectStore } from "../../store/useProjectStore";
import { useAuthStore } from "../../store/useAuthStore";
import { agoLabel, pinLabel, barOfBeat, mentionedIds, splitMentions } from "../../lib/notes";
import { MentionTextarea } from "./MentionTextarea";
import { BarPin } from "./BarPin";
import { useMembers } from "./useMembers";
import { authorInitial, noteTint, useNoteTracks } from "./noteStyle";
import { CheckIcon, NoteIcon, TrashIcon } from "../icons/Icons";

/** The current time, refreshed every minute, so "5 min ago" keeps up. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

/** One note in the tray: who, when, where it is pinned, the text, and what you can do with it. */
export function NoteRow({ note }: { note: ProjectNote }) {
  const uid = useAuthStore((s) => s.userId);
  const tracks = useNoteTracks();
  const isOwner = useProjectStore((s) => s.isInitiator());
  const canWrite = useProjectStore((s) => s.canWriteNotes());
  const beatsPerBar = useProjectStore((s) => s.project?.beatsPerBar ?? 4);
  const channel = useProjectStore((s) => s.project?.tracks.find((t) => t.id === note.trackId)?.instrument ?? null);
  const floating = useProjectStore((s) => !!s.noteCards[note.id]);
  const setNoteDone = useProjectStore((s) => s.setNoteDone);
  const removeNote = useProjectStore((s) => s.removeNote);
  const editNote = useProjectStore((s) => s.editNote);
  const floatNote = useProjectStore((s) => s.floatNote);
  const unfloatNote = useProjectStore((s) => s.unfloatNote);
  const jumpToNote = useProjectStore((s) => s.jumpToNote);
  const now = useNow();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.body);
  const [pinned, setPinned] = useState(note.atBeat !== null);
  const [bar, setBar] = useState(barOfBeat(note.atBeat ?? 0, beatsPerBar));
  const members = useMembers();
  const forMe = !!uid && note.mentions.includes(uid);
  const myName = members.find((m) => m.id === uid)?.name ?? "\u0000";
  const mine = note.authorId === uid;
  const canEdit = mine || isOwner;

  return (
    <div className={`note-row${note.done ? " done" : ""}${forMe && !note.done ? " for-me" : ""}`} style={{ "--note-color": noteTint(note, tracks) } as React.CSSProperties}>
      <span className="note-avatar" aria-hidden="true">
        {authorInitial(note.authorName)}
      </span>
      <div className="note-main">
        <div className="note-meta">
          <b>{mine ? "You" : (note.authorName ?? "Someone")}</b>
          <span>{agoLabel(note.createdAt, now)}</span>
          {note.atBeat !== null && (
            <button className="note-chip" onClick={() => jumpToNote(note.id)} title="Move the playhead here">
              {pinLabel(note.atBeat, beatsPerBar)}
            </button>
          )}
          {forMe && <span className="note-chip me" title="You were tagged in this note">For you</span>}
          {channel && <span className="note-chip plain">{channel}</span>}
          {note.sharedWithListeners && <span className="note-chip plain" title="Listeners can read this note">Listeners</span>}
        </div>
        {editing ? (
          <div className="note-edit">
            <MentionTextarea value={draft} onChange={setDraft} members={members} label="Edit note" />
            <BarPin pinned={pinned} bar={bar} onPinned={setPinned} onBar={setBar} />
            <div>
              <button
                className="note-send"
                disabled={!draft.trim()}
                onClick={() => {
                  void editNote(note.id, { body: draft.trim(), mentions: mentionedIds(draft, members), atBeat: pinned ? (bar - 1) * beatsPerBar : null });
                  setEditing(false);
                }}
              >
                Save
              </button>
              <button
                className="note-opt"
                onClick={() => {
                  setDraft(note.body);
                  setPinned(note.atBeat !== null);
                  setBar(barOfBeat(note.atBeat ?? 0, beatsPerBar));
                  setEditing(false);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <p className="note-body">
            {splitMentions(note.body, members.map((m) => m.name)).map((part, i) =>
              part.mention ? (
                <span key={i} className={part.text.toLowerCase() === `@${myName.toLowerCase()}` ? "mention me" : "mention"}>
                  {part.text}
                </span>
              ) : (
                part.text
              )
            )}
          </p>
        )}
      </div>
      {canWrite && !editing && (
        <div className="note-actions">
          <button
            className="note-act"
            onClick={() => void setNoteDone(note.id, !note.done)}
            title={note.done ? "Reopen this note" : "Mark as done — it moves to the archive"}
            aria-label={note.done ? "Reopen" : "Mark as done"}
          >
            <CheckIcon size={14} />
          </button>
          {!note.done && (
            <button
              className={floating ? "note-act on" : "note-act"}
              onClick={() => (floating ? unfloatNote(note.id) : floatNote(note.id))}
              title={floating ? "Take the card off the screen" : "Pop out as a card that floats over everything"}
              aria-label="Pop out as a card"
            >
              <NoteIcon size={14} />
            </button>
          )}
          {canEdit && (
            <button className="note-act" onClick={() => setEditing(true)} title="Edit" aria-label="Edit">
              <span aria-hidden="true">✎</span>
            </button>
          )}
          {canEdit && (
            <button className="note-act" onClick={() => void removeNote(note.id)} title="Delete" aria-label="Delete">
              <TrashIcon size={14} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
