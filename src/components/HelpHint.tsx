import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { helpTopic } from "../lib/helpContent";

/**
 * A small "?" that opens the short answer to one question, with a link to the full Help page.
 * Sits in the title bar of a tool, where the question comes up.
 */
export function HelpHint({ topic, up = false }: { topic: string; up?: boolean }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const item = helpTopic(topic);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);

  // The pop-up is placed against the screen, not the little button, so it is never cut off by a window edge.
  useLayoutEffect(() => {
    if (!open || !button.current) {
      setPos(null);
      return;
    }
    const r = button.current.getBoundingClientRect();
    const width = 250;
    // Straight under the "?" (or straight above it, for a tool at the bottom of the screen).
    const left = Math.min(window.innerWidth - width - 8, Math.max(8, r.left + r.width / 2 - 24));
    setPos(up ? { left, bottom: window.innerHeight - r.top + 8 } : { left, top: r.bottom + 8 });
  }, [open, up]);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  // If the pop-up sits on the thing it explains, drag it by its title to somewhere else.
  const startDrag = (e: React.PointerEvent) => {
    if ((e.target as Element).closest("button")) return;
    e.preventDefault();
    const box = (e.currentTarget as HTMLElement).parentElement;
    if (!box) return;
    const rect = box.getBoundingClientRect();
    const dx = e.clientX - rect.left;
    const dy = e.clientY - rect.top;
    const move = (ev: PointerEvent) =>
      setPos({
        left: Math.max(4, Math.min(window.innerWidth - 60, ev.clientX - dx)),
        top: Math.max(4, Math.min(window.innerHeight - 40, ev.clientY - dy)),
      });
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };

  if (!item) return null;
  return (
    <span className="help-hint" ref={box}>
      <button ref={button} className="help-q" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label="Help" title="What is this?">
        ?
      </button>
      {open && (
        <span className="help-pop" role="dialog" aria-label={item.question} style={{ ...pos, visibility: pos ? "visible" : "hidden" }}>
          <span className="help-pop-head" onPointerDown={startDrag} title="Drag to move this out of the way">
            <b>{item.question}</b>
            <button className="help-pop-x" onClick={() => setOpen(false)} aria-label="Close help">
              ×
            </button>
          </span>
          {item.answer.slice(0, 2).map((p, i) => (
            <span key={i} className="help-pop-p">
              {p}
            </span>
          ))}
          <a href={`/help#${item.id}`} target="_blank" rel="noreferrer">
            More in Help
          </a>
        </span>
      )}
    </span>
  );
}
