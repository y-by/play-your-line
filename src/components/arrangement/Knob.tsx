import { useRef, useState } from "react";

interface KnobProps {
  label: string;
  value: number;
  unit?: string;
  min: number;
  max: number;
  /** How much the value changes per pixel of vertical drag. */
  sensitivity: number;
  disabled: boolean;
  /** Called continuously while dragging, with the fully clamped new value. */
  onChange: (v: number) => void;
  /** What double-clicking resets the knob to. */
  defaultValue: number;
  /** How many decimal places to show — 0 for whole numbers. */
  decimals?: number;
  size?: number;
}

const SWEEP_DEG = 270; // total rotation from fully-left to fully-right, centred at bottom
const START_DEG = 135; // pointing down-left at the minimum

/** A real, drag-to-turn knob (vertical drag, like every DAW/plugin), rendered as SVG. */
export function Knob({ label, value, unit = "", min, max, sensitivity, disabled, onChange, defaultValue, decimals = 0, size = 44 }: KnobProps) {
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ startY: number; startValue: number } | null>(null);

  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const frac = (clamp(value) - min) / (max - min || 1);
  const angle = START_DEG + frac * SWEEP_DEG;

  const r = size / 2 - 4;
  const cx = size / 2;
  const cy = size / 2;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const pointerX = cx + r * Math.cos(toRad(angle));
  const pointerY = cy + r * Math.sin(toRad(angle));

  // The track arc, drawn once, and a "fill" arc from the minimum to the current value.
  const arcPoint = (deg: number, radius: number) => [cx + radius * Math.cos(toRad(deg)), cy + radius * Math.sin(toRad(deg))];
  const describeArc = (fromDeg: number, toDeg: number, radius: number) => {
    const [x1, y1] = arcPoint(fromDeg, radius);
    const [x2, y2] = arcPoint(toDeg, radius);
    const large = toDeg - fromDeg > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${radius} ${radius} 0 ${large} 1 ${x2} ${y2}`;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled) return;
    e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = { startY: e.clientY, startValue: value };
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const deltaY = drag.current.startY - e.clientY; // up = increase
    const fine = e.shiftKey ? 0.25 : 1; // hold Shift for fine control
    onChange(clamp(drag.current.startValue + deltaY * sensitivity * fine));
  };
  const onPointerUp = () => {
    drag.current = null;
    setDragging(false);
  };
  const onDoubleClick = () => {
    if (!disabled) onChange(clamp(defaultValue));
  };
  const onWheel = (e: React.WheelEvent) => {
    if (disabled) return;
    e.preventDefault();
    onChange(clamp(value - Math.sign(e.deltaY) * sensitivity * 4));
  };

  return (
    <div className={dragging ? "knob dragging" : "knob"}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        onWheel={onWheel}
        className={disabled ? "knob-svg disabled" : "knob-svg"}
        role="slider"
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        tabIndex={disabled ? -1 : 0}
      >
        <path d={describeArc(START_DEG, START_DEG + SWEEP_DEG, r)} className="knob-track" fill="none" />
        <path d={describeArc(START_DEG, angle, r)} className="knob-fill" fill="none" />
        <circle cx={cx} cy={cy} r={r - 7} className="knob-face" />
        <line x1={cx} y1={cy} x2={pointerX} y2={pointerY} className="knob-pointer" />
      </svg>
      <span className="knob-value">
        {value.toFixed(decimals)}
        {unit}
      </span>
      <span className="knob-label">{label}</span>
    </div>
  );
}
