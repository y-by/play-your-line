import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { helpTopic } from "../lib/helpContent";
import { canAnchor, distrustAnchors, looksAnchored } from "../lib/anchor";

/**
 * A small "?" that opens the short answer to one question, with a link to the full Help page.
 * Sits in the title bar of a tool, where the question comes up.
 *
 * The pop-up is placed by the browser against the "?" (CSS anchor positioning, in the top layer so a window's
 * scaling or edge can never move or clip it). Where that is not available it is placed by measuring. Either way
 * it can be dragged by its title if it covers the thing it explains.
 */
export function HelpHint({ topic, up = false }: { topic: string; up?: boolean }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLSpanElement>(null);
  const anchorName = `--help-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const item = helpTopic(topic);
  // Where the pop-up sits once it has been measured (fallback) or dragged (both ways).
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const [dragged, setDragged] = useState(false);

  const close = () => {
    setOpen(false);
    setPos(null);
    setDragged(false);
  };
  // Without anchor positioning the place is measured, under the "?" (or above it, for a tool at the bottom).
  const measure = () => {
    if (!button.current) return;
    const r = button.current.getBoundingClientRect();
    const left = Math.min(window.innerWidth - 250 - 8, Math.max(8, r.left + r.width / 2 - 24));
    setPos(up ? { left, bottom: window.innerHeight - r.top + 8 } : { left, top: r.bottom + 8 });
  };
  const [, setTick] = useState(0);
  const toggle = () => {
    if (open) return close();
    if (!canAnchor()) measure();
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (box.current?.contains(t) || pop.current?.contains(t)) return;
      close();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Anchored: the pop-up goes into the top layer, and the browser places it.
  useLayoutEffect(() => {
    if (open && canAnchor()) pop.current?.showPopover();
  }, [open]);

  // ...and check it really landed by its "?"; if not, stop trusting that and measure instead.
  useEffect(() => {
    if (!open || !canAnchor() || dragged) return;
    const frame = requestAnimationFrame(() => {
      const p = pop.current?.getBoundingClientRect();
      const b = button.current?.getBoundingClientRect();
      if (p && b && !looksAnchored(p, b, { width: window.innerWidth, height: window.innerHeight })) {
        distrustAnchors();
        measure();
        setTick((t) => t + 1);
      }
    });
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const startDrag = (e: React.PointerEvent) => {
    if ((e.target as Element).closest("button")) return;
    e.preventDefault();
    const el = pop.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const dx = e.clientX - rect.left;
    const dy = e.clientY - rect.top;
    setDragged(true);
    setPos({ left: rect.left, top: rect.top });
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

  const content = (
    <>
      <span className="help-pop-head" onPointerDown={startDrag} title="Drag to move this out of the way">
        <b>{item.question}</b>
        <button className="help-pop-x" onClick={close} aria-label="Close help">
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
    </>
  );

  // Dragged: plain screen coordinates, whichever way it was first placed.
  const dragStyle = dragged && pos ? ({ inset: "auto", top: pos.top, left: pos.left, margin: 0, positionArea: "none", positionTryFallbacks: "none", justifySelf: "auto" } as React.CSSProperties) : null;

  return (
    <span className="help-hint" ref={box}>
      <button
        ref={button}
        className="help-q"
        style={canAnchor() ? ({ anchorName } as React.CSSProperties) : undefined}
        onClick={toggle}
        aria-expanded={open}
        aria-label="Help"
        title="What is this?"
      >
        ?
      </button>
      {open &&
        (canAnchor() ? (
          <span
            ref={pop}
            popover="manual"
            className={up ? "help-pop anchored up" : "help-pop anchored"}
            role="dialog"
            aria-label={item.question}
            style={dragStyle ?? ({ positionAnchor: anchorName } as React.CSSProperties)}
          >
            {content}
          </span>
        ) : (
          createPortal(
            <span ref={pop} className="help-pop" role="dialog" aria-label={item.question} style={{ ...pos, visibility: pos ? "visible" : "hidden" }}>
              {content}
            </span>,
            document.body
          )
        ))}
    </span>
  );
}
