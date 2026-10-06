import { useEffect } from "react";
import { useProjectStore } from "../../store/useProjectStore";

/** "Dana tagged you in a note": a message at the top when a note tagging me arrives while I am in the project. */
export function NoteAlert() {
  const alert = useProjectStore((s) => s.noteAlert);
  const dismiss = useProjectStore((s) => s.dismissNoteAlert);
  const open = useProjectStore((s) => s.openNoteAlert);

  useEffect(() => {
    if (!alert) return;
    const timer = window.setTimeout(dismiss, 10000);
    return () => window.clearTimeout(timer);
  }, [alert, dismiss]);

  if (!alert) return null;
  return (
    <div className="note-alert plugin-skin" role="status">
      <span>
        <b>{alert.from}</b> tagged you in a note
      </span>
      <button className="note-send" onClick={open}>
        Open
      </button>
      <button className="note-act" onClick={dismiss} aria-label="Dismiss">
        ✕
      </button>
    </div>
  );
}
