import { useEffect, useRef, useState } from "react";

export type Pos = { top: number; left: number };

/**
 * A window you can drag by its header. It may start with no position (`null`): then the browser places it
 * against its button (CSS anchor positioning) until the first drag or resize turns that into real coordinates.
 */
export function usePlacement(initial: Pos | null) {
  const [pos, setPos] = useState<Pos | null>(initial);
  const drag = useRef<{ startX: number; startY: number; startTop: number; startLeft: number } | null>(null);
  const headerProps = {
    onPointerDown: (e: React.PointerEvent) => {
      if ((e.target as Element).closest("button, select, input, [role=switch]")) return;
      e.preventDefault();
      try {
        (e.target as Element).setPointerCapture(e.pointerId);
      } catch {
        // Capture is only a convenience; dragging still works while the pointer stays over the header.
      }
      let base = pos;
      if (!base) {
        const r = (e.currentTarget as HTMLElement).closest(".channel-fx-plugin")?.getBoundingClientRect();
        base = r ? { top: r.top, left: r.left } : { top: 8, left: 8 };
        setPos(base);
      }
      drag.current = { startX: e.clientX, startY: e.clientY, startTop: base.top, startLeft: base.left };
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (!drag.current) return;
      const { startX, startY, startTop, startLeft } = drag.current;
      setPos({
        top: Math.max(0, startTop + (e.clientY - startY)),
        left: Math.max(0, Math.min(window.innerWidth - 60, startLeft + (e.clientX - startX))),
      });
    },
    onPointerUp: () => {
      drag.current = null;
    },
  };
  /** Carry on dragging this window with a pointer that is already down (a tab that was just pulled out). */
  const startWindowDrag = (clientX: number, clientY: number) => {
    const start = { x: clientX, y: clientY, top: pos?.top ?? 8, left: pos?.left ?? 8 };
    const move = (e: PointerEvent) =>
      setPos({
        top: Math.max(0, start.top + (e.clientY - start.y)),
        left: Math.max(0, Math.min(window.innerWidth - 60, start.left + (e.clientX - start.x))),
      });
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };
  return { pos, setPos, headerProps, startWindowDrag };
}

/**
 * Keeps a window on the screen. When it opens (or its size changes: another tab, a bigger window, a resized
 * browser) and it runs past the bottom or the right edge, it is moved back so all of it can be seen.
 * It does not fight you while you drag it: only a change of size or of the screen triggers it.
 */
export function useKeepOnScreen(box: React.RefObject<HTMLDivElement | null>, setPos: React.Dispatch<React.SetStateAction<Pos | null>>, active = true) {
  useEffect(() => {
    const el = box.current;
    if (!el || !active) return;
    const fit = () => {
      const r = el.getBoundingClientRect();
      const margin = 8;
      const dy = r.bottom > window.innerHeight - margin ? window.innerHeight - margin - r.bottom : 0;
      const dx = r.right > window.innerWidth - margin ? window.innerWidth - margin - r.right : 0;
      if (dx === 0 && dy === 0) return;
      setPos((p) => (p ? { top: Math.max(margin, p.top + dy), left: Math.max(margin, p.left + dx) } : p));
    };
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    window.addEventListener("resize", fit);
    fit();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, [box, setPos, active]);
}

export const SCALE_KEY = "pyl.fxScale";
export const TUNER_SCALE_KEY = "pyl.tunerScale";
const MAX_SCALE = 2;

/** Grow a window by dragging its bottom-right corner, up to double its size (less on a narrow screen). */
export function readStoredScale(key: string): number {
  try {
    const v = Number(localStorage.getItem(key));
    return v >= 1 && v <= MAX_SCALE ? v : 1;
  } catch {
    return 1;
  }
}

export function useResizable(rememberAs: string | null, onBegin?: () => void) {
  const [scale, setScale] = useState(() => {
    if (!rememberAs) return 1;
    try {
      const v = Number(localStorage.getItem(rememberAs));
      return v >= 1 && v <= MAX_SCALE ? v : 1;
    } catch {
      return 1;
    }
  });
  const box = useRef<HTMLDivElement>(null);
  const grip = {
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const el = box.current;
      if (!el) return;
      onBegin?.(); // a window placed by its button gets real coordinates before it grows
      const baseW = el.offsetWidth;
      const baseH = el.offsetHeight;
      const startX = e.clientX;
      const startY = e.clientY;
      const startScale = scale;
      const max = Math.max(1, Math.min(MAX_SCALE, (window.innerWidth - 12) / baseW));
      let latest = startScale;
      const move = (ev: PointerEvent) => {
        // The corner follows the pointer: a drag across the window's own size doubles it.
        latest = Math.min(max, Math.max(1, startScale + (ev.clientX - startX + ev.clientY - startY) / (baseW + baseH)));
        setScale(latest);
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        if (rememberAs) {
          try {
            localStorage.setItem(rememberAs, String(Math.round(latest * 100) / 100));
          } catch {
            // storage unavailable — the size just won't be remembered
          }
        }
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    },
    onDoubleClick: () => setScale(1),
  };
  const style = scale === 1 ? {} : { transform: `scale(${scale})`, transformOrigin: "top left" };
  return { box, grip, style };
}

