import { useRef, useState } from "react";

interface Props {
  /** -1 (hard left) … 0 (centre) … +1 (hard right). */
  value: number;
  disabled: boolean;
  onChange: (pan: number) => void;
}

const SWEEP = 135; // degrees either side of straight up
const SIZE = 22;

function describe(pan: number): string {
  const n = Math.round(Math.abs(pan) * 100);
  return n === 0 ? "C" : pan < 0 ? `L${n}` : `R${n}`;
}

/**
 * A small pan knob. Drag up/down (or scroll) to move it, hold Shift to fine-tune, double-click to
 * centre. It snaps to the middle when you get close, like a hardware detent.
 */
export function PanKnob({ value, disabled, onChange }: Props) {
  const drag = useRef<{ startY: number; startValue: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const clamp = (v: number) => Math.min(1, Math.max(-1, v));
  const snap = (v: number) => (Math.abs(v) < 0.04 ? 0 : v);

  const angle = value * SWEEP; // 0 = straight up
  const r = SIZE / 2 - 3;
  const c = SIZE / 2;
  const pt = (deg: number, radius: number): [number, number] => [c + radius * Math.sin((deg * Math.PI) / 180), c - radius * Math.cos((deg * Math.PI) / 180)];
  const [px, py] = pt(angle, r - 1);
  const arc = () => {
    if (Math.abs(angle) < 1) return "";
    const [x1, y1] = pt(0, r);
    const [x2, y2] = pt(angle, r);
    return `M ${x1} ${y1} A ${r} ${r} 0 0 ${angle > 0 ? 1 : 0} ${x2} ${y2}`;
  };

  return (
    <svg
      className={["pan-knob", dragging ? "dragging" : "", disabled ? "disabled" : ""].filter(Boolean).join(" ")}
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="slider"
      aria-label="Pan"
      aria-valuemin={-100}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      aria-valuetext={describe(value)}
      tabIndex={disabled ? -1 : 0}
      onPointerDown={(e) => {
        if (disabled) return;
        e.preventDefault();
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // dragging still works while the pointer stays over the knob
        }
        drag.current = { startY: e.clientY, startValue: value };
        setDragging(true);
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        const fine = e.shiftKey ? 0.25 : 1;
        onChange(snap(clamp(drag.current.startValue + ((drag.current.startY - e.clientY) * 0.012 * fine))));
      }}
      onPointerUp={() => {
        drag.current = null;
        setDragging(false);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setDragging(false);
      }}
      onDoubleClick={() => !disabled && onChange(0)}
      onWheel={(e) => {
        if (disabled) return;
        e.preventDefault();
        onChange(snap(clamp(value - Math.sign(e.deltaY) * 0.05)));
      }}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === "ArrowLeft" || e.key === "ArrowDown") onChange(snap(clamp(value - 0.05)));
        if (e.key === "ArrowRight" || e.key === "ArrowUp") onChange(snap(clamp(value + 0.05)));
        if (e.key === "Home" || e.key === "0") onChange(0);
      }}
    >
      <title>{`Pan ${describe(value)}${disabled ? " (set by the owner or mixer)" : " — drag, scroll or double-click to centre"}`}</title>
      <circle cx={c} cy={c} r={r} className="pan-track" />
      <path d={arc()} className="pan-fill" fill="none" />
      <line x1={c} y1={c} x2={px} y2={py} className="pan-pointer" />
      <circle cx={c} cy={c - r} r="1.1" className="pan-detent" />
    </svg>
  );
}
