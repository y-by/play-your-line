import { useCallback, useEffect, useRef, useState } from "react";
import { clampPosition, DOCKED, moveByKey, readFloatState, snapPosition, writeFloatState, type FloatState, type Point } from "../lib/floatPosition";
import { DockIcon, GripIcon } from "./icons/Icons";

const DRAG_START_PX = 5;

/**
 * The main control (transport, number display, modes) with a handle. Docked, it sits in the header bar. Drag the handle and it
 * floats over the page, wherever suits the moment: it clicks to the edges and the middle, stays inside the window, and the place
 * is remembered on this device. Double-click the handle, press Enter on it, or press the dock button to put it back in the bar.
 */
export function FloatingControl({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<FloatState>(() => readFloatState());
  const [dragging, setDragging] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ dx: number; dy: number; startX: number; startY: number; moved: boolean } | null>(null);

  const measure = () => {
    const el = ref.current;
    return { size: { w: el?.offsetWidth ?? 340, h: el?.offsetHeight ?? 56 }, view: { w: window.innerWidth, h: window.innerHeight } };
  };

  const commit = useCallback((next: FloatState) => {
    setState(next);
    writeFloatState(next);
  }, []);

  // Keep it on screen when the window changes size (and once it first appears).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const keepInside = () => {
      setState((s) => {
        if (!s.floating) return s;
        const p = clampPosition({ x: s.x, y: s.y }, { w: el.offsetWidth, h: el.offsetHeight }, { w: window.innerWidth, h: window.innerHeight });
        return p.x === s.x && p.y === s.y ? s : { floating: true, ...p };
      });
    };
    const observer = new ResizeObserver(keepInside);
    observer.observe(el);
    window.addEventListener("resize", keepInside);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", keepInside);
    };
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top, startX: e.clientX, startY: e.clientY, moved: false };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_START_PX) return;
    d.moved = true;
    setDragging(true);
    const { size, view } = measure();
    const p = clampPosition({ x: e.clientX - d.dx, y: e.clientY - d.dy }, size, view);
    setState({ floating: true, ...p });
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d?.moved) return;
    setDragging(false);
    const { size, view } = measure();
    setState((s) => {
      const p = snapPosition({ x: s.x, y: s.y }, size, view);
      const next = { floating: true, ...p };
      writeFloatState(next);
      return next;
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "Enter" || e.key === "Escape") {
      if (state.floating) {
        e.preventDefault();
        commit(DOCKED);
      }
      return;
    }
    const rect = ref.current?.getBoundingClientRect();
    const from: Point = state.floating ? { x: state.x, y: state.y } : { x: rect?.left ?? 0, y: rect?.top ?? 0 };
    const to = moveByKey(from, e.key, e.shiftKey);
    if (!to) return;
    e.preventDefault();
    const { size, view } = measure();
    commit({ floating: true, ...clampPosition(to, size, view) });
  };

  const classes = ["cb-center", state.floating ? "floating" : "", dragging ? "dragging" : ""].filter(Boolean).join(" ");
  return (
    <div ref={ref} className={classes} style={state.floating ? { left: state.x, top: state.y } : undefined}>
      <button
        type="button"
        className="cb-grip"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => state.floating && commit(DOCKED)}
        onKeyDown={onKeyDown}
        title={state.floating ? "Drag to move the controls. Double-click to put them back in the bar." : "Drag me out of the bar and put me wherever suits you"}
        aria-label="Move the controls. Drag, or use the arrow keys. Enter puts them back in the bar."
      >
        <GripIcon size={14} />
      </button>
      {children}
      {state.floating && (
        <button type="button" className="cb-dock" onClick={() => commit(DOCKED)} title="Put the controls back in the bar" aria-label="Put the controls back in the bar">
          <DockIcon size={14} />
        </button>
      )}
    </div>
  );
}
