import { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useProjectStore } from "../../store/useProjectStore";
import { HelpHint } from "../HelpHint";
import { NotesPanel } from "./NotesPanel";
import { CloseIcon } from "../icons/Icons";

/** How close to the bottom edge of the window the popup has to be dropped to dock there. */
const DOCK_ZONE_PX = 110;

/**
 * The notes as a popup, the same kind as Channels and People (it opens under the toolbar). Drag its title bar down to
 * the bottom of the screen to dock it there as the notes tray; the tray has a button to pop it out again. Unlike the
 * other popups it stays open while you work in the song.
 */
export function NotesPopup() {
  const dock = useProjectStore((s) => s.notesDock);
  const open = useProjectStore((s) => s.notesTrayOpen);
  const visible = useProjectStore((s) => s.notesVisible);
  const canWrite = useProjectStore((s) => s.canWriteNotes());
  const hasNotes = useProjectStore((s) => s.notes.length > 0);
  const openCount = useProjectStore((s) => s.notes.filter((n) => !n.done).length);
  const setOpen = useProjectStore((s) => s.setNotesTrayOpen);
  const setVisible = useProjectStore((s) => s.setNotesVisible);
  const setDock = useProjectStore((s) => s.setNotesDock);
  // Sits right under the Notes button that opens it (found again when the window or the toolbar moves).
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const shown = dock === "popup" && open && (canWrite || hasNotes);
  useLayoutEffect(() => {
    if (!shown) return;
    const place = () => {
      const r = document.querySelector<HTMLElement>(".notes-btn")?.getBoundingClientRect();
      if (!r) return;
      const width = Math.min(460, window.innerWidth - 24);
      setAt({ top: r.bottom + 6, left: Math.max(12, Math.min(r.left + r.width / 2 - 40, window.innerWidth - width - 12)) });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [shown]);
  const [drag, setDrag] = useState<{ sx: number; sy: number; dx: number; dy: number; near: boolean } | null>(null);

  if (!shown || !at) return null;

  const dockBottom = () => {
    setVisible(true);
    setDock("bottom");
  };

  return (
    <>
      <div
        className={drag ? "cb-popup notes-popup plugin-skin dragging" : "cb-popup notes-popup plugin-skin"}
        style={{ top: at.top, left: at.left, ...(drag ? { transform: `translate(${drag.dx}px, ${drag.dy}px)` } : {}) }}
        role="dialog"
        aria-label="Notes"
      >
        <header
          className="plugin-head notes-popup-head"
          onPointerDown={(e) => {
            if ((e.target as HTMLElement).closest("button")) return;
            e.preventDefault();
            try {
              e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
              // dragging still works while the pointer stays over the title bar
            }
            setDrag({ sx: e.clientX, sy: e.clientY, dx: 0, dy: 0, near: false });
          }}
          onPointerMove={(e) => {
            if (drag) setDrag({ ...drag, dx: e.clientX - drag.sx, dy: e.clientY - drag.sy, near: e.clientY > window.innerHeight - DOCK_ZONE_PX });
          }}
          onPointerUp={() => {
            const near = drag?.near;
            setDrag(null);
            if (near) dockBottom();
          }}
          onPointerCancel={() => setDrag(null)}
          title="Drag down to the bottom of the screen to dock the notes there"
        >
          <h2>
            Notes <span className="notes-count">{openCount}</span>
          </h2>
          <HelpHint topic="notes" />
          <button className="note-opt" onClick={dockBottom} title="Dock the notes at the bottom of the screen">
            Dock ⤓
          </button>
          <label className="note-opt notes-flags-toggle" title="Show the notes' flags on the ruler and their cards">
            <input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} /> Flags &amp; cards
          </label>
          <button className="plugin-close" onClick={() => setOpen(false)} aria-label="Close the notes">
            <CloseIcon />
          </button>
        </header>
        <NotesPanel />
      </div>
      {drag &&
        createPortal(
          <div className={drag.near ? "notes-dock-zone on" : "notes-dock-zone"} aria-hidden="true">
            Drop here to dock the notes at the bottom
          </div>,
          document.body
        )}
    </>
  );
}
