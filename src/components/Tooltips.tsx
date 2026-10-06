import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { parseTip, type TipParts } from "../lib/tooltip";
import { canAnchor, distrustAnchors, looksAnchored } from "../lib/anchor";

interface Shown {
  tip: TipParts;
  rect: DOMRect;
}

/**
 * One styled tooltip for the whole app. It takes over the hints already written as `title` on buttons and
 * controls: while the pointer (or keyboard focus) is on one, the browser's own plain tooltip is set aside
 * and this one is shown instead. On a touch screen, press and hold a control to see its hint.
 */
export function Tooltips() {
  const [shown, setShown] = useState<Shown | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let current: HTMLElement | null = null;
    let timer = 0;
    let observer: MutationObserver | null = null;
    let previousAnchor = "";

    const textOf = (el: HTMLElement) => el.getAttribute("title") ?? el.dataset.tip ?? "";
    const release = () => {
      window.clearTimeout(timer);
      observer?.disconnect();
      observer = null;
      if (current) {
        if (canAnchor()) {
          if (previousAnchor) current.style.setProperty("anchor-name", previousAnchor);
          else current.style.removeProperty("anchor-name");
        }
        const text = current.dataset.tip;
        if (text && !current.hasAttribute("title")) current.setAttribute("title", text);
        delete current.dataset.tip;
      }
      current = null;
      setShown(null);
      setPos(null);
    };
    const show = () => {
      if (!current) return;
      const text = current.dataset.tip;
      if (text) setShown({ tip: parseTip(text), rect: current.getBoundingClientRect() });
    };
    const take = (el: HTMLElement, delay: number) => {
      if (el === current) return;
      release();
      const text = textOf(el);
      if (!text) return;
      current = el;
      if (canAnchor()) {
        // The browser places the tip against the thing it explains; an element may already be an anchor for something else.
        previousAnchor = el.style.getPropertyValue("anchor-name");
        el.style.setProperty("anchor-name", previousAnchor ? `${previousAnchor}, --tip-anchor` : "--tip-anchor");
      }
      el.dataset.tip = text;
      el.removeAttribute("title");
      // A hint that changes while it is up (a slider's dB value) is picked up and shown fresh.
      observer = new MutationObserver(() => {
        const next = el.getAttribute("title");
        if (next) {
          el.dataset.tip = next;
          el.removeAttribute("title");
          show();
        }
      });
      observer.observe(el, { attributes: true, attributeFilter: ["title"] });
      timer = window.setTimeout(show, delay);
    };
    const target = (e: Event) => (e.target instanceof Element ? (e.target.closest("[title], [data-tip]") as HTMLElement | null) : null);

    const onOver = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const el = target(e);
      if (el) take(el, 380);
      else release();
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "touch") {
        const el = target(e);
        if (el) {
          take(el, 450);
          window.setTimeout(() => current === el && release(), 2600);
        }
      } else {
        release(); // a click is done reading
      }
    };
    const onFocus = (e: FocusEvent) => {
      const el = target(e);
      if (el && el.matches(":focus-visible")) take(el, 0);
    };
    const onLeave = () => release();
    document.addEventListener("pointerover", onOver);
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", onLeave);
    document.addEventListener("pointerleave", onLeave);
    window.addEventListener("scroll", onLeave, true);
    window.addEventListener("keydown", onLeave);
    window.addEventListener("blur", onLeave);
    return () => {
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", onLeave);
      document.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("scroll", onLeave, true);
      window.removeEventListener("keydown", onLeave);
      window.removeEventListener("blur", onLeave);
      release();
    };
  }, []);

  // Above the control, centred; below it if there is no room; always kept on screen.
  useLayoutEffect(() => {
    if (canAnchor() || !shown || !box.current) return;
    const { width, height } = box.current.getBoundingClientRect();
    const r = shown.rect;
    const gap = 8;
    let top = r.top - height - gap;
    if (top < 4) top = Math.min(window.innerHeight - height - 4, r.bottom + gap);
    const left = Math.min(window.innerWidth - width - 6, Math.max(6, r.left + r.width / 2 - width / 2));
    setPos({ left, top });
  }, [shown]);

  // Placed by the browser: make sure it really landed beside its target. If not, stop trusting that and measure instead.
  useEffect(() => {
    if (!shown || !canAnchor()) return;
    const frame = requestAnimationFrame(() => {
      const r = box.current?.getBoundingClientRect();
      if (r && !looksAnchored(r, shown.rect, { width: window.innerWidth, height: window.innerHeight })) {
        distrustAnchors();
        setShown({ ...shown });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [shown]);

  if (!shown) return null;
  const { tip } = shown;
  // Put at the very end of the page each time: an anchored pop-up has to come after the thing it is anchored to.
  return createPortal(
    <div
      ref={box}
      className={canAnchor() ? "tip anchored" : "tip"}
      role="tooltip"
      style={canAnchor() ? undefined : { left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? "visible" : "hidden" }}
    >
      <span className="tip-main">
        <span className="tip-name">{tip.name}</span>
        {tip.hint && <span className="tip-hint">{tip.hint}</span>}
      </span>
      {tip.key && <span className="tip-key">{tip.key}</span>}
    </div>,
    document.body
  );
}
