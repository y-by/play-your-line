import { HelpHint } from "../HelpHint";
import { useEffect, useRef } from "react";
import { useProjectStore } from "../../store/useProjectStore";
import { notesForTray } from "../../lib/notes";
import { NotesPanel } from "./NotesPanel";
import { CloseIcon } from "../icons/Icons";

/**
 * The notes drawer, docked at the bottom of the screen over everything (when the notes are docked there; otherwise
 * they are the popup): a one-line bar when closed (how many open notes, the newest one), the full panel when open.
 */
export function NotesTray() {
  const visible = useProjectStore((s) => s.notesVisible);
  const dock = useProjectStore((s) => s.notesDock);
  const open = useProjectStore((s) => s.notesTrayOpen);
  const setOpen = useProjectStore((s) => s.setNotesTrayOpen);
  const setDock = useProjectStore((s) => s.setNotesDock);
  const notes = useProjectStore((s) => s.notes);
  const canWrite = useProjectStore((s) => s.canWriteNotes());
  const tray = useRef<HTMLElement>(null);
  const showing = dock === "bottom" && visible && !(!canWrite && notes.length === 0);

  // Tell the page how tall the tray is, so the master strip can sit just above it and never be covered.
  useEffect(() => {
    const el = tray.current;
    if (!showing || !el) return;
    const publish = () => document.documentElement.style.setProperty("--notes-tray-h", `${el.getBoundingClientRect().height}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty("--notes-tray-h");
    };
  }, [showing, open]);

  if (!showing) return null;

  const openNotes = notes.filter((n) => !n.done);
  const newest = notesForTray(notes, { done: false, trackId: null })[0];

  return (
    <aside ref={tray} className={open ? "notes-tray open plugin-skin" : "notes-tray plugin-skin"} aria-label="Notes">
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
        {open && <span className="notes-preview" />}
        {open && (
          <button className="note-opt" onClick={() => setDock("popup")} title="Pop the notes out as a window under the toolbar">
            Pop out ⤒
          </button>
        )}
        <button className="notes-close" onClick={() => setOpen(!open)} aria-label={open ? "Close the notes tray" : "Open the notes tray"}>
          {open ? <CloseIcon size={14} /> : <span aria-hidden="true">＋</span>}
        </button>
      </div>
      {open && <NotesPanel />}
    </aside>
  );
}
