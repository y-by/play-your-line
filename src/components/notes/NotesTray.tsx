import { HelpHint } from "../HelpHint";
import { useState } from "react";
import { useProjectStore } from "../../store/useProjectStore";
import { notesForTray } from "../../lib/notes";
import { NoteComposer } from "./NoteComposer";
import { NoteRow } from "./NoteRow";
import { CloseIcon } from "../icons/Icons";

/**
 * The notes drawer, docked at the bottom of the screen over everything: a one-line bar when closed
 * (how many open notes, the newest one), the composer and the full list when open.
 */
export function NotesTray() {
  const visible = useProjectStore((s) => s.notesVisible);
  const open = useProjectStore((s) => s.notesTrayOpen);
  const setOpen = useProjectStore((s) => s.setNotesTrayOpen);
  const notes = useProjectStore((s) => s.notes);
  const canWrite = useProjectStore((s) => s.canWriteNotes());
  const channelFilter = useProjectStore((s) => s.noteChannelFilter);
  const showChannelNotes = useProjectStore((s) => s.showChannelNotes);
  const channelName = useProjectStore((s) => s.project?.tracks.find((t) => t.id === s.noteChannelFilter)?.instrument ?? null);
  const floatAll = useProjectStore((s) => s.floatAllNotes);
  const unfloatAll = useProjectStore((s) => s.unfloatAllNotes);
  const cardCount = useProjectStore((s) => Object.keys(s.noteCards).length);
  const [tab, setTab] = useState<"open" | "done">("open");

  if (!visible || (!canWrite && notes.length === 0)) return null;

  const openNotes = notes.filter((n) => !n.done);
  const doneCount = notes.length - openNotes.length;
  const shown = notesForTray(notes, { done: tab === "done", trackId: channelFilter });
  const newest = notesForTray(notes, { done: false, trackId: null })[0];

  return (
    <aside className={open ? "notes-tray open plugin-skin" : "notes-tray plugin-skin"} aria-label="Notes">
      <div className="notes-bar">
        <button className="notes-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span className="notes-title">Notes</span>
          <span className="notes-count">{openNotes.length}</span>
          <span className="notes-chevron" aria-hidden="true">
            {open ? "▾" : "▴"}
          </span>
        </button>
        <HelpHint topic="notes" up />
        {!open && newest && (
          <span className="notes-preview">
            <b>{newest.authorName ?? "Someone"}:</b> {newest.body}
          </span>
        )}
        {!open && !newest && <span className="notes-preview muted">{canWrite ? "No notes yet — open the tray to write the first." : "No notes shared with you yet."}</span>}
        {open && (
          <div className="notes-tabs" role="tablist">
            <button role="tab" aria-selected={tab === "open"} className={tab === "open" ? "on" : ""} onClick={() => setTab("open")}>
              Open {openNotes.length}
            </button>
            <button role="tab" aria-selected={tab === "done"} className={tab === "done" ? "on" : ""} onClick={() => setTab("done")}>
              Done {doneCount}
            </button>
          </div>
        )}
        {open && channelFilter && (
          <button className="note-chip" onClick={() => showChannelNotes(null)} title="Show every channel's notes">
            {channelName ?? "Channel"} <CloseIcon size={10} />
          </button>
        )}
        {open && openNotes.length > 0 && (
          <>
            <button className="note-opt" onClick={floatAll} title="Pop every open note out as a card on the right of the screen">
              Open all
            </button>
            {cardCount > 0 && (
              <button className="note-opt" onClick={unfloatAll} title="Take every card off the screen">
                Close all
              </button>
            )}
          </>
        )}
        <button className="notes-close" onClick={() => setOpen(!open)} aria-label={open ? "Close the notes tray" : "Open the notes tray"}>
          {open ? <CloseIcon size={14} /> : <span aria-hidden="true">＋</span>}
        </button>
      </div>
      {open && (
        <div className="notes-body">
          {canWrite && <NoteComposer autoFocus />}
          <div className="notes-list">
            {shown.length === 0 && (
              <p className="notes-empty">{tab === "open" ? "Nothing open. New notes will appear here for everyone in the project." : "Done notes are archived here."}</p>
            )}
            {shown.map((n) => (
              <NoteRow key={n.id} note={n} />
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}
