import { useState } from "react";
import { useProjectStore } from "../../store/useProjectStore";
import { notesForTray } from "../../lib/notes";
import { NoteComposer } from "./NoteComposer";
import { NoteRow } from "./NoteRow";
import { CloseIcon } from "../icons/Icons";

/**
 * What the notes show inside, wherever they sit (the popup or the bottom tray): the Open / Done tabs, the channel
 * filter, Open all / Close all, the composer and the list.
 */
export function NotesPanel() {
  const notes = useProjectStore((s) => s.notes);
  const canWrite = useProjectStore((s) => s.canWriteNotes());
  const channelFilter = useProjectStore((s) => s.noteChannelFilter);
  const showChannelNotes = useProjectStore((s) => s.showChannelNotes);
  const channelName = useProjectStore((s) => s.project?.tracks.find((t) => t.id === s.noteChannelFilter)?.instrument ?? null);
  const floatAll = useProjectStore((s) => s.floatAllNotes);
  const unfloatAll = useProjectStore((s) => s.unfloatAllNotes);
  const cardCount = useProjectStore((s) => Object.keys(s.noteCards).length);
  const [tab, setTab] = useState<"open" | "done">("open");

  const openNotes = notes.filter((n) => !n.done);
  const doneCount = notes.length - openNotes.length;
  const shown = notesForTray(notes, { done: tab === "done", trackId: channelFilter });

  return (
    <div className="notes-body">
      <div className="notes-toolbar">
        <div className="notes-tabs" role="tablist">
          <button role="tab" aria-selected={tab === "open"} className={tab === "open" ? "on" : ""} onClick={() => setTab("open")}>
            Open {openNotes.length}
          </button>
          <button role="tab" aria-selected={tab === "done"} className={tab === "done" ? "on" : ""} onClick={() => setTab("done")}>
            Done {doneCount}
          </button>
        </div>
        {channelFilter && (
          <button className="note-chip" onClick={() => showChannelNotes(null)} title="Show every channel's notes">
            {channelName ?? "Channel"} <CloseIcon size={10} />
          </button>
        )}
        {openNotes.length > 0 && (
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
      </div>
      {canWrite && <NoteComposer autoFocus />}
      <div className="notes-list">
        {shown.length === 0 && <p className="notes-empty">{tab === "open" ? "Nothing open. New notes will appear here for everyone in the project." : "Done notes are archived here."}</p>}
        {shown.map((n) => (
          <NoteRow key={n.id} note={n} />
        ))}
      </div>
    </div>
  );
}
