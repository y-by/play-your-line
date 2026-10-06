/**
 * CSS anchor positioning: a pop-up that is placed against another element by the browser itself (it follows
 * the element, flips to the other side when there is no room, and stays on screen) instead of by measuring in
 * JavaScript. Supported in current Chrome, Edge and Safari; where it is missing, the old measured placement runs.
 *
 * It is also checked after the fact: if a pop-up ever lands somewhere that makes no sense (off screen, or far from
 * what it belongs to) the browser's support is not trusted for the rest of the visit and the measured placement
 * takes over, so a pop-up is never simply missing.
 */
const SUPPORTED: boolean =
  typeof CSS !== "undefined" &&
  typeof CSS.supports === "function" &&
  CSS.supports("anchor-name", "--a") &&
  CSS.supports("position-area", "top") &&
  CSS.supports("justify-self", "anchor-center") &&
  CSS.supports("position-try-fallbacks", "flip-block") &&
  typeof HTMLElement !== "undefined" &&
  "showPopover" in HTMLElement.prototype;

const state = { trusted: true };

/** Whether pop-ups should be placed by the browser right now. */
export function canAnchor(): boolean {
  return SUPPORTED && state.trusted;
}

/** Stop trusting the browser's anchor positioning for the rest of this visit. */
export function distrustAnchors(): void {
  state.trusted = false;
}

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Does a pop-up sit where a pop-up for this anchor should: on screen, and right next to it? */
export function looksAnchored(popup: Box, anchor: Box, viewport: { width: number; height: number }): boolean {
  const slack = 3;
  const onScreen = popup.left >= -slack && popup.top >= -slack && popup.right <= viewport.width + slack && popup.bottom <= viewport.height + slack;
  const nearVertically = popup.top >= anchor.bottom - slack ? popup.top - anchor.bottom <= 80 : anchor.top - popup.bottom <= 80;
  const overlapsHorizontally = popup.right >= anchor.left - 80 && popup.left <= anchor.right + 80;
  return onScreen && nearVertically && overlapsHorizontally;
}
