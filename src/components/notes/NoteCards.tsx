import { useRef, useState } from "react";
import { useProjectStore } from "../../store/useProjectStore";
import { agoLabel, barOfBeat, mentionedIds, pinLabel } from "../../lib/notes";
import { MentionTextarea } from "./MentionTextarea";
import { BarPin } from "./BarPin";
import { useMembers } from "./useMembers";
import { authorInitial, noteTint, useNoteTracks, useNow } from "./noteStyle";
import { CheckIcon, CloseIcon } from "../icons/Icons";
import type { NoteCardState, NoteCardsLayout } from "../../store/useProjectStore";
import type { ProjectNote } from "../../types/project";

function Card({ note, state, layout, index, front }: { note: ProjectNote; state: NoteCardState; layout: NoteCardsLayout; index: number; front: boolean }) {
  const { x, y, w, h } = state;
  const free = state.free === true;
  const bringNoteFront = useProjectStore((s) => s.bringNoteFront);
  const tracks = useNoteTracks();
  const now = useNow();
  const moveNoteCard = useProjectStore((s) => s.moveNoteCard);
  const resizeNoteCard = useProjectStore((s) => s.resizeNoteCard);
  const minimizeNoteCard = useProjectStore((s) => s.minimizeNoteCard);
  const unfloatNote = useProjectStore((s) => s.unfloatNote);
  const setNoteDone = useProjectStore((s) => s.setNoteDone);
  const jumpToNote = useProjectStore((s) => s.jumpToNote);
  const canWrite = useProjectStore((s) => s.canWriteNotes());
  const beatsPerBar = useProjectStore((s) => s.project?.beatsPerBar ?? 4);
  const editNote = useProjectStore((s) => s.editNote);
  const members = useMembers();
  const mayEdit = useProjectStore((s) => s.canEditNote(note));
  const canEdit = canWrite && mayEdit;
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const grow = useRef<{ sx: number; sy: number; w: number; h: number } | null>(null);
  const cardEl = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.body);
  const [pinned, setPinned] = useState(note.atBeat !== null);
  const [bar, setBar] = useState(barOfBeat(note.atBeat ?? 0, beatsPerBar));

  const startEdit = () => {
    setDraft(note.body);
    setPinned(note.atBeat !== null);
    setBar(barOfBeat(note.atBeat ?? 0, beatsPerBar));
    setEditing(true);
  };

  return (
    <div
      ref={cardEl}
      className={free ? "note-card free plugin-skin" : `note-card ${layout} plugin-skin`}
      style={
        {
          ...(free ? { left: x, top: y } : layout === "stack" ? { top: index * 34, zIndex: front ? 200 : index + 1 } : {}),
          width: w,
          height: h,
          "--note-color": noteTint(note, tracks),
        } as unknown as React.CSSProperties
      }
      onPointerDownCapture={() => {
        if (!front) bringNoteFront(note.id);
      }}
    >
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
          const box = cardEl.current?.getBoundingClientRect();
          drag.current = { dx: e.clientX - (box?.left ?? x), dy: e.clientY - (box?.top ?? y) };
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
            {pinLabel(note.atBeat, beatsPerBar)}
          </button>
        )}
        <span className="note-card-time" title={new Date(note.createdAt).toLocaleString()}>
          {agoLabel(note.createdAt, now)}
        </span>
        <span className="note-card-grow" />
        {canEdit && !editing && (
          <button className="note-act" onClick={startEdit} title="Edit" aria-label="Edit">
            <span aria-hidden="true">✎</span>
          </button>
        )}
        <button className="note-act" onClick={() => minimizeNoteCard(note.id, true)} title="Minimise to the bottom row" aria-label="Minimise">
          <span aria-hidden="true">–</span>
        </button>
        <button className="note-act" onClick={() => unfloatNote(note.id)} title="Take the card off the screen" aria-label="Close card">
          <CloseIcon size={12} />
        </button>
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
            <button className="note-opt" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <p className="note-card-body">{note.body}</p>
      )}
      {canEdit && !editing && (
        <button className="note-card-done" onClick={() => void setNoteDone(note.id, true)}>
          <CheckIcon size={12} /> Done
        </button>
      )}
      <div
        className="note-card-resize"
        title="Drag to resize"
        aria-label="Resize note"
        onPointerDown={(e) => {
          const box = cardEl.current?.getBoundingClientRect();
          if (!box) return;
          e.preventDefault();
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // resizing still works while the pointer stays over the corner
          }
          grow.current = { sx: e.clientX, sy: e.clientY, w: box.width, h: box.height };
        }}
        onPointerMove={(e) => {
          if (!grow.current) return;
          const box = cardEl.current?.getBoundingClientRect();
          const nw = Math.max(200, Math.min(window.innerWidth - (box?.left ?? 0) - 8, grow.current.w + e.clientX - grow.current.sx));
          const nh = Math.max(110, Math.min(window.innerHeight - (box?.top ?? 0) - 8, grow.current.h + e.clientY - grow.current.sy));
          resizeNoteCard(note.id, Math.round(nw), Math.round(nh));
        }}
        onPointerUp={() => (grow.current = null)}
        onPointerCancel={() => (grow.current = null)}
      />
    </div>
  );
}

/** Notes popped out of the tray: floating cards (three to a row on the right, or stacked; drag one away to place it anywhere), and a row of minimised ones along the bottom. */
export function NoteCards() {
  const visible = useProjectStore((s) => s.notesVisible);
  const tracks = useNoteTracks();
  const cards = useProjectStore((s) => s.noteCards);
  const notes = useProjectStore((s) => s.notes);
  const minimizeNoteCard = useProjectStore((s) => s.minimizeNoteCard);
  const trayOpen = useProjectStore((s) => s.notesTrayOpen);
  const layout = useProjectStore((s) => s.noteCardsLayout);
  const setLayout = useProjectStore((s) => s.setNoteCardsLayout);
  const unfloatAll = useProjectStore((s) => s.unfloatAllNotes);
  const front = useProjectStore((s) => s.noteCardFront);
  if (!visible) return null;

  const live = notes.filter((n) => cards[n.id] && !n.done);
  const floating = live.filter((n) => !cards[n.id].min);
  const minimised = live.filter((n) => cards[n.id].min);

  return (
    <>
      {live.length > 0 && (
        <div className={`note-cards-area ${layout}`}>
          <div className="note-cards-bar plugin-skin">
            <button className="note-opt" onClick={() => setLayout(layout === "grid" ? "stack" : "grid")} title={layout === "grid" ? "Pile the cards on top of each other" : "Lay the cards out three in a row"}>
              {layout === "grid" ? "Stack" : "Grid"}
            </button>
            <button className="note-opt" onClick={unfloatAll} title="Take every card off the screen">
              Close all
            </button>
          </div>
          {/* In the grid the cards fill a column from the top until it is full, then the next one: short notes pile up
              in one column and a long note gets its own (all in one flat list, so a card never remounts while you edit it). */}
          <div className="note-cards-flow">
            {floating.map((n, i) => (
              <Card key={n.id} note={n} state={cards[n.id]} layout={layout} index={floating.filter((m, j) => j < i && cards[m.id].free !== true).length} front={(front && floating.some((m) => m.id === front) ? front : floating[floating.length - 1]?.id) === n.id} />
            ))}
          </div>
        </div>
      )}
      {minimised.length > 0 && !trayOpen && (
        <div className="note-dock" aria-label="Minimised notes">
          {minimised.map((n) => (
            <button
              key={n.id}
              className="note-dock-chip plugin-skin"
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
