// Loop ("cycle") timing. Pure, so the maths can be tested with plain numbers.
//
// Playing with a loop: the song plays from `startPos` up to the loop's end,
// then jumps to the loop's start and repeats that region until you stop.
// If you start at or after the loop's end, there is no looping.

export interface LoopRegion {
  startSec: number;
  endSec: number;
}

/** Shortest loop that makes sense. */
export const MIN_LOOP_SEC = 0.05;

/** Does a play that begins at `startPos` loop at all? */
export function loopApplies(loop: LoopRegion | null, startPos: number): loop is LoopRegion {
  return !!loop && loop.endSec - loop.startSec >= MIN_LOOP_SEC && startPos < loop.endSec;
}

/** Where the playhead is, `elapsedSec` after playback began at `startPos`. */
export function positionWithLoop(startPos: number, elapsedSec: number, loop: LoopRegion | null): number {
  if (!loopApplies(loop, startPos)) return startPos + elapsedSec;
  const firstPass = loop.endSec - startPos;
  if (elapsedSec < firstPass) return startPos + elapsedSec;
  const length = loop.endSec - loop.startSec;
  return loop.startSec + ((elapsedSec - firstPass) % length);
}

/** The stretch of song heard in one pass: [from, to) starting on the audio clock at ctxStart. */
export interface LoopPass {
  from: number;
  to: number;
  ctxStart: number;
}

/** The pass that follows `pass`: always the whole loop region, starting exactly where the last one ended. */
export function nextLoopPass(pass: LoopPass, loop: LoopRegion): LoopPass {
  return { from: loop.startSec, to: loop.endSec, ctxStart: pass.ctxStart + (pass.to - pass.from) };
}
