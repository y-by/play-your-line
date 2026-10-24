// Where the floating main control sits. Pure, so the rules (stay on screen, snap to the edges and the middle, arrow keys,
// remembering the place) are tested with plain numbers. The screen part is components/FloatingControl.tsx.

export interface FloatState {
  /** True once the person has pulled the control out of the header bar. */
  floating: boolean;
  /** Distance from the left and top of the window, in pixels. */
  x: number;
  y: number;
}

export interface Point {
  x: number;
  y: number;
}
export interface Size {
  w: number;
  h: number;
}

export const FLOAT_MARGIN = 8;
/** Within this many pixels of an edge (or the middle) a released control clicks into place. */
export const SNAP_RANGE = 18;
const KEY = "pyl.controlFloat.v1";

export const DOCKED: FloatState = { floating: false, x: 0, y: 0 };

/** Keeps the whole control inside the window, with a small margin all round. A control wider than the window sits at the left margin. */
export function clampPosition(pos: Point, size: Size, view: Size, margin = FLOAT_MARGIN): Point {
  const maxX = Math.max(margin, view.w - size.w - margin);
  const maxY = Math.max(margin, view.h - size.h - margin);
  return { x: Math.min(Math.max(pos.x, margin), maxX), y: Math.min(Math.max(pos.y, margin), maxY) };
}

/** After a drag: clamp, then click to the left, right, top or bottom edge, or to the horizontal middle, when close to one. */
export function snapPosition(pos: Point, size: Size, view: Size, margin = FLOAT_MARGIN, range = SNAP_RANGE): Point {
  const c = clampPosition(pos, size, view, margin);
  const maxX = Math.max(margin, view.w - size.w - margin);
  const maxY = Math.max(margin, view.h - size.h - margin);
  const middle = Math.round((view.w - size.w) / 2);
  let { x, y } = c;
  if (Math.abs(x - margin) <= range) x = margin;
  else if (Math.abs(x - maxX) <= range) x = maxX;
  else if (Math.abs(x - middle) <= range) x = middle;
  if (Math.abs(y - margin) <= range) y = margin;
  else if (Math.abs(y - maxY) <= range) y = maxY;
  return { x, y };
}

/** An arrow key moves the control 10 pixels (40 with Shift). Any other key returns null. */
export function moveByKey(pos: Point, key: string, shift: boolean): Point | null {
  const step = shift ? 40 : 10;
  switch (key) {
    case "ArrowLeft":
      return { x: pos.x - step, y: pos.y };
    case "ArrowRight":
      return { x: pos.x + step, y: pos.y };
    case "ArrowUp":
      return { x: pos.x, y: pos.y - step };
    case "ArrowDown":
      return { x: pos.x, y: pos.y + step };
    default:
      return null;
  }
}

/** Reads what was remembered; anything unreadable means "in the bar". */
export function parseFloatState(raw: unknown): FloatState {
  if (raw && typeof raw === "object") {
    const { floating, x, y } = raw as Partial<FloatState>;
    if (floating === true && typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y)) {
      return { floating: true, x, y };
    }
  }
  return DOCKED;
}

export function readFloatState(): FloatState {
  try {
    return parseFloatState(JSON.parse(localStorage.getItem(KEY) ?? "null"));
  } catch {
    return DOCKED;
  }
}

export function writeFloatState(state: FloatState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // storage unavailable: the place is simply not remembered
  }
}
