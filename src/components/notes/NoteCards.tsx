import { useRef } from "react";
import { useProjectStore } from "../../store/useProjectStore";
import { pinLabel } from "../../lib/notes";
import { authorInitial, noteTint, useNoteTracks } from "./noteStyle";
import { CheckIcon, CloseIcon } from "../icons/Icons";
import type { ProjectNote } from "../../types/project";

function Card({ note, x, y }: { note: ProjectNote; x: number; y: number }) {
  const tracks = useNoteTracks();
  const moveNoteCard = useProjectStore((s) => s.moveNoteCard);
  const minimizeNoteCard = useProjectStore((s) => s.minimizeNoteCard);
  const unfloatNote = useProjectStore((s) => s.unfloatNote);
  const setNoteDone = useProjectStore((s) => s.setNoteDone);
  const jumpToNote = useProjectStore((s) => s.jumpToNote);
  const canWrite = useProjectStore((s) => s.canWriteNotes());
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  return (
    <div className="note-card" style={{ left: x, top: y, "--note-color": noteTint(note, tracks) } as React.CSSProperties}>
      <div
        className="note-card-head"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          e.preventDefault();
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // dragging still works while the pointer stays over the header
          }
          drag.current = { dx: e.clientX - x, dy: e.clientY - y };
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const nx = Math.max(0, Math.min(window.innerWidth - 120, e.clientX - drag.current.dx));
          const ny = Math.max(0, Math.min(window.innerHeight - 80, e.clientY - drag.current.dy));
          moveNoteCard(note.id, nx, ny);
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      >
        <span className="note-avatar small" aria-hidden="true">
          {authorInitial(note.authorName)}
        </span>
        <b>{note.authorName ?? "Someone"}</b>
        {note.atBeat !== null && (
          <button className="note-chip" onClick={() => jumpToNote(note.id)} title="Move the playhead here">
            {pinLabel(note.atBeat)}
          </button>
        )}
        <span className="note-card-grow" />
        <button className="note-act" onClick={() => minimizeNoteCard(note.id, true)} title="Minimise to the bottom row" aria-label="Minimise">
          <span aria-hidden="true">–</span>
        </button>
        <button className="note-act" onClick={() => unfloatNote(note.id)} title="Take the card off the screen" aria-label="Close card">
          <CloseIcon size={12} />
        </button>
      </div>
      <p className="note-card-body">{note.body}</p>
      {canWrite && (
        <button className="note-card-done" onClick={() => void setNoteDone(note.id, true)}>
          <CheckIcon size={12} /> Done
        </button>
      )}
    </div>
  );
}

/** Notes popped out of the tray: floating cards you can drag anywhere, and a row of minimised ones along the bottom. */
export function NoteCards() {
  const visible = useProjectStore((s) => s.notesVisible);
  const tracks = useNoteTracks();
  const cards = useProjectStore((s) => s.noteCards);
  const notes = useProjectStore((s) => s.notes);
  const minimizeNoteCard = useProjectStore((s) => s.minimizeNoteCard);
  const trayOpen = useProjectStore((s) => s.notesTrayOpen);
  if (!visible) return null;

  const live = notes.filter((n) => cards[n.id] && !n.done);
  const floating = live.filter((n) => !cards[n.id].min);
  const minimised = live.filter((n) => cards[n.id].min);

  return (
    <>
      {floating.map((n) => (
        <Card key={n.id} note={n} x={cards[n.id].x} y={cards[n.id].y} />
      ))}
      {minimised.length > 0 && !trayOpen && (
        <div className="note-dock" aria-label="Minimised notes">
          {minimised.map((n) => (
            <button
              key={n.id}
              className="note-dock-chip"
              style={{ "--note-color": noteTint(n, tracks) } as React.CSSProperties}
              onClick={() => minimizeNoteCard(n.id, false)}
              title={n.body}
            >
              <span className="note-avatar small" aria-hidden="true">
                {authorInitial(n.authorName)}
              </span>
              {n.body.length > 22 ? `${n.body.slice(0, 22)}…` : n.body}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
