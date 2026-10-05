import { useCallback, useRef } from "react";
import { useProjectStore } from "../../store/useProjectStore";
import { FollowIcon } from "../icons/Icons";
import { NoteFlags } from "../notes/NoteFlags";
import { BEATS_PER_BAR, beatSec, stepSec, snapTo } from "../../lib/grid";

interface Props {
  totalBars: number;
  barPx: number;
  pxPerSec: number;
}

/** Keeps receiving the drag even if the pointer leaves the element. It's only a convenience, so a failure is ignored. */
function capture(e: React.PointerEvent<HTMLElement>) {
  try {
    e.currentTarget.setPointerCapture(e.pointerId);
  } catch {
    // dragging still works while the pointer stays over the strip
  }
}

type LoopDrag = { mode: "new" | "move" | "left" | "right"; anchorSec: number; startBeat: number; endBeat: number };

/**
 * Bar numbers along the top (click or drag to move the playhead) and, right
 * under them, a thin strip where you drag to highlight a part to loop. Drag
 * the highlight to move it, or its edges to resize it.
 */
export function Ruler({ totalBars, barPx, pxPerSec }: Props) {
  const seek = useProjectStore((s) => s.seek);
  const locked = useProjectStore((s) => s.recordingTrackId !== null);
  const loop = useProjectStore((s) => s.loop);
  const loopEnabled = useProjectStore((s) => s.loopEnabled);
  const setLoopRegion = useProjectStore((s) => s.setLoopRegion);
  const anySolo = useProjectStore((s) => Object.values(s.localSolo).some(Boolean));
  const clearSolo = useProjectStore((s) => s.clearSolo);
  const anyMuted = useProjectStore((s) => (s.project?.tracks ?? []).some((t) => s.effectiveMix(t).muted));
  const setAllMuted = useProjectStore((s) => s.setAllMuted);
  const canAdjustMix = useProjectStore((s) => s.canAdjustMix());
  const followPlayhead = useProjectStore((s) => s.followPlayhead);
  const setFollowPlayhead = useProjectStore((s) => s.setFollowPlayhead);
  const drag = useRef<LoopDrag | null>(null);

  const seekFrom = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      seek(Math.max(0, (e.clientX - rect.left) / pxPerSec));
    },
    [seek, pxPerSec]
  );

  // Snap to the current grid unless Alt is held.
  const secAt = (e: React.PointerEvent<HTMLElement>, rect: DOMRect) => {
    const s = useProjectStore.getState();
    const raw = Math.max(0, (e.clientX - rect.left) / pxPerSec);
    if (!s.snapEnabled || e.altKey) return raw;
    return snapTo(raw, stepSec(s.project?.bpm ?? 120, s.snapResolution));
  };

  const stripDown = (e: React.PointerEvent<HTMLElement>, mode: LoopDrag["mode"]) => {
    const bpm = useProjectStore.getState().project?.bpm ?? 120;
    const rect = (e.currentTarget.closest(".loop-strip") as HTMLElement).getBoundingClientRect();
    e.stopPropagation();
    capture(e);
    const at = secAt(e, rect);
    drag.current = { mode, anchorSec: at, startBeat: loop?.startBeat ?? 0, endBeat: loop?.endBeat ?? 0 };
    if (mode === "new") drag.current.startBeat = drag.current.endBeat = at / beatSec(bpm);
  };

  const stripMove = (e: React.PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || e.buttons !== 1) return;
    const bpm = useProjectStore.getState().project?.bpm ?? 120;
    const rect = (e.currentTarget.closest(".loop-strip") as HTMLElement).getBoundingClientRect();
    const beat = beatSec(bpm);
    const at = secAt(e, rect);
    if (d.mode === "new") setLoopRegion(d.anchorSec / beat, at / beat);
    else if (d.mode === "left") setLoopRegion(at / beat, d.endBeat);
    else if (d.mode === "right") setLoopRegion(d.startBeat, at / beat);
    else {
      const shift = (at - d.anchorSec) / beat;
      const start = Math.max(0, d.startBeat + shift);
      setLoopRegion(start, start + (d.endBeat - d.startBeat));
    }
  };

  const stripUp = () => {
    drag.current = null;
  };

  // Thin out the labels when zoomed far out so numbers never touch.
  const labelEvery = barPx >= 44 ? 1 : barPx >= 22 ? 2 : barPx >= 11 ? 4 : 8;
  const labels = [];
  for (let bar = 0; bar < totalBars; bar += labelEvery) {
    labels.push(
      <span key={bar} className="ruler-label" style={{ left: bar * barPx }}>
        {bar + 1}
      </span>
    );
  }

  const beatPx = pxPerSec * beatSec(useProjectStore.getState().project?.bpm ?? 120);

  return (
    <div className="arr-row ruler-row">
      <div className="arr-info ruler-corner">
        <span className="rc-label">Bar</span>
        <div className="rc-controls">
          <span className="arm-slot" aria-hidden="true" />
          <button
            className={anyMuted ? "strip-btn mute on" : "strip-btn mute"}
            disabled={!canAdjustMix}
            onClick={() => setAllMuted(!anyMuted)}
            title={anyMuted ? "Master mute: un-mute every channel" : "Master mute: mute every channel"}
            aria-pressed={anyMuted}
            aria-label="Master mute"
          >
            M
          </button>
          <button
            className={anySolo ? "strip-btn solo on" : "strip-btn solo"}
            disabled={!anySolo}
            onClick={clearSolo}
            title="Master solo: turn off every solo"
            aria-pressed={anySolo}
            aria-label="Master solo — turn off every solo"
          >
            S
          </button>
          <span className="rc-grow" />
          <button
            className={followPlayhead ? "follow-btn on" : "follow-btn"}
            onClick={() => setFollowPlayhead(!followPlayhead)}
            title={followPlayhead ? "Following the playhead — click to stop the view from scrolling" : "Not following — click to keep the playhead in view"}
            aria-pressed={followPlayhead}
            aria-label="Follow playhead"
          >
            <FollowIcon size={13} />
          </button>
        </div>
      </div>
      <div className="ruler-col" style={{ width: totalBars * barPx }}>
        <NoteFlags pxPerSec={pxPerSec} />
        <div
          className={locked ? "arr-ruler locked" : "arr-ruler"}
          style={{ "--beat-px": `${barPx / BEATS_PER_BAR}px` } as React.CSSProperties}
          onPointerDown={(e) => {
            if (locked) return;
            capture(e);
            seekFrom(e);
          }}
          onPointerMove={(e) => {
            if (!locked && e.buttons === 1) seekFrom(e);
          }}
        >
          {labels}
        </div>
        <div
          className="loop-strip"
          title="Drag to highlight a part to loop"
          onPointerDown={(e) => stripDown(e, "new")}
          onPointerMove={stripMove}
          onPointerUp={stripUp}
          onPointerCancel={stripUp}
        >
          {loop && (
            <div
              className={loopEnabled ? "loop-region on" : "loop-region"}
              style={{ left: loop.startBeat * beatPx, width: Math.max(4, (loop.endBeat - loop.startBeat) * beatPx) }}
              onPointerDown={(e) => stripDown(e, "move")}
              onPointerMove={stripMove}
              onPointerUp={stripUp}
              onPointerCancel={stripUp}
            >
              <span className="loop-handle left" onPointerDown={(e) => stripDown(e, "left")} onPointerMove={stripMove} onPointerUp={stripUp} />
              <span className="loop-handle right" onPointerDown={(e) => stripDown(e, "right")} onPointerMove={stripMove} onPointerUp={stripUp} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
