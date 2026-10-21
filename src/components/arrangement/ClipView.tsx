import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Clip, Take, Track } from "../../types/project";
import { useProjectStore } from "../../store/useProjectStore";
import { clipEnd, moveClip, setClipFade, trimClipEnd, trimClipStart } from "../../lib/clips";
import { snapTo, stepSec } from "../../lib/grid";
import { computeTakePeaks } from "../../lib/waveform";
import { autoBoost, wavePath } from "../../lib/wavePath";

type DragMode = "move" | "trim-start" | "trim-end" | "fade-in" | "fade-out";

interface Props {
  track: Track;
  clip: Clip;
  take: Take | undefined;
  canEdit: boolean;
  selected: boolean;
  pxPerSec: number;
}

const WAVE_HEIGHT = 72;
const MAX_WAVE_COLUMNS = 8192;

export function ClipView({ track, clip, take, canEdit, selected, pxPerSec }: Props) {
  const engine = useProjectStore((s) => s.engine);
  const bpm = useProjectStore((s) => s.project?.bpm ?? 120);
  const beatsPerBar = useProjectStore((s) => s.project?.beatsPerBar ?? 4);
  const snapEnabled = useProjectStore((s) => s.snapEnabled);
  const snapResolution = useProjectStore((s) => s.snapResolution);
  const takesVersion = useProjectStore((s) => s.takesVersion);
  const selectClip = useProjectStore((s) => s.selectClip);
  const toggleClipSelected = useProjectStore((s) => s.toggleClipSelected);
  const commitClips = useProjectStore((s) => s.commitClips);
  const moveClipToTrack = useProjectStore((s) => s.moveClipToTrack);
  const setMoveLanding = useProjectStore((s) => s.setMoveLanding);
  const canMoveFrom = useProjectStore((s) => s.canMoveClipsFrom(track));
  const beingMoved = useProjectStore((s) => s.movingClipId === clip.id);
  const marks = useProjectStore((s) => (s.quantiseMarks?.clipId === clip.id ? s.quantiseMarks.times : null));

  // While dragging, the clip follows the pointer locally; nothing is saved until you let go.
  const [preview, setPreview] = useState<Clip | null>(null);
  const [dragMode, setDragMode] = useState<DragMode | null>(null);
  // The clip follows the pointer between channels (a copy drawn over everything), so you see what you are placing.
  const [ghost, setGhost] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const drag = useRef<{ mode: DragMode; startX: number; startY: number; original: Clip; latest: Clip; moved: boolean; target: string | null; grab: { dx: number; dy: number; w: number; h: number } } | null>(null);

  const shown = preview ?? clip;
  const widthPx = Math.max(3, shown.durationSec * pxPerSec);
  // One column for each device pixel (twice as many on a sharp screen); the waveform is a vector shape, so it stays
  // crisp when the clip is zoomed or the channel is made taller.
  const density = Math.min(2, typeof window === "undefined" ? 1 : window.devicePixelRatio || 1);
  const columns = Math.max(1, Math.min(MAX_WAVE_COLUMNS, Math.round(widthPx * density)));
  const wave = useMemo(() => {
    const buffer = engine.getTakeBuffer(clip.takeId);
    if (!buffer) return "";
    const peaks = computeTakePeaks(buffer, shown.sourceStartSec, shown.durationSec, columns);
    // Quiet takes are drawn a little larger (up to 4x) so they stay readable.
    return wavePath(peaks, columns, WAVE_HEIGHT, autoBoost(peaks));
    // takesVersion says when a recording has arrived (the buffer is not React state).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, clip.takeId, shown.sourceStartSec, shown.durationSec, columns, takesVersion]);

  const step = stepSec(bpm, snapResolution, beatsPerBar);
  // Holding Alt while dragging ignores snapping (free placement).
  const snap = (sec: number, free: boolean) => (snapEnabled && !free ? snapTo(sec, step) : sec);

  const begin = (mode: DragMode, e: React.PointerEvent<HTMLElement>) => {
    // Someone who cannot edit this clip may still drag it to another channel of the same player (the Owner, for any player).
    if (!canEdit && !(mode === "move" && canMoveFrom)) return;
    e.stopPropagation();
    e.preventDefault();
    // Shift or ⌘/Ctrl-click adds the clip to the selection (or takes it out) instead of starting a drag.
    if (mode === "move" && (e.shiftKey || e.metaKey || e.ctrlKey)) {
      toggleClipSelected({ trackId: track.id, clipId: clip.id });
      return;
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Capture is only a convenience; dragging still works while the pointer stays over the clip.
    }
    selectClip({ trackId: track.id, clipId: clip.id });
    const box = e.currentTarget.getBoundingClientRect();
    drag.current = { mode, startX: e.clientX, startY: e.clientY, original: clip, latest: clip, moved: false, target: null, grab: { dx: e.clientX - box.left, dy: e.clientY - box.top, w: box.width, h: box.height } };
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    if (!d.moved && Math.abs(dx) < 3 && Math.abs(e.clientY - d.startY) < 3) return;
    d.moved = true;
    setDragMode(d.mode);
    if (d.mode === "move" && canMoveFrom) {
      // The channel under the pointer, when the clip may go there: it is highlighted and the clip moves on release.
      const state = useProjectStore.getState();
      let target: string | null = null;
      for (const el of document.elementsFromPoint(e.clientX, e.clientY)) {
        const id = el.closest<HTMLElement>("[data-lane-id]")?.dataset.laneId;
        if (!id) continue;
        const other = state.project?.tracks.find((t) => t.id === id);
        if (other && other.id !== track.id && state.canMoveClipTo(track, other)) target = other.id;
        break;
      }
      d.target = target;
      // The copy shows once the pointer leaves the clip's own channel; until then the clip just slides along its channel.
      setGhost(target || Math.abs(e.clientY - d.startY) > d.grab.h ? { left: e.clientX - d.grab.dx, top: e.clientY - d.grab.dy, width: d.grab.w, height: d.grab.h } : null);
    }
    const delta = dx / pxPerSec;
    const free = e.altKey;
    let next: Clip;
    if (d.mode === "move") {
      next = moveClip(d.original, snap(d.original.startSec + delta, free));
    } else if (d.mode === "fade-in") {
      next = setClipFade(d.original, "in", d.original.fadeInSec + delta);
    } else if (d.mode === "fade-out") {
      next = setClipFade(d.original, "out", d.original.fadeOutSec - delta);
    } else if (d.mode === "trim-start") {
      next = trimClipStart(d.original, snap(d.original.startSec + delta, free));
    } else {
      next = trimClipEnd(d.original, snap(clipEnd(d.original) + delta, free), take?.durationSec ?? clipEnd(d.original));
    }
    d.latest = next;
    // Someone who cannot edit this clip (the Owner on a player's clip) only changes its channel: the clip stays where it is
    // until it is dropped on another channel, where the outline shows the place they chose.
    if (canEdit || d.mode !== "move") setPreview(next);
    // Where the clip would land in the channel under it (snapped like any move), outlined there.
    setMoveLanding(d.target ? { trackId: d.target, startSec: next.startSec, durationSec: next.durationSec } : null);
  };

  const onEnd = () => {
    const d = drag.current;
    drag.current = null;
    setDragMode(null);
    setGhost(null);
    // A drop on another channel keeps its outline until the move is done (the store clears it); anything else clears it now.
    if (!d?.target) setMoveLanding(null);
    if (!d) return;
    if (d.moved && d.target) void moveClipToTrack(clip.id, track.id, d.target, d.latest.startSec);
    else if (d.moved && canEdit) void commitClips(track.id, track.clips.map((c) => (c.id === clip.id ? d.latest : c)));
    setPreview(null);
  };

  const fadeInPx = shown.fadeInSec * pxPerSec;
  const fadeOutPx = shown.fadeOutSec * pxPerSec;
  const showFadeHandles = canEdit && widthPx >= 48;
  const dragging = dragMode;
  const resetFade = (which: "in" | "out") => (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canEdit) return;
    const next = setClipFade(clip, which, 0);
    if (next !== clip) void commitClips(track.id, track.clips.map((c) => (c.id === clip.id ? next : c)));
  };

  const className = ["clip", selected ? "selected" : "", canEdit ? "editable" : "", !canEdit && canMoveFrom ? "movable" : "", preview ? "dragging" : "", ghost || beingMoved ? "ghosted" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={className}
      style={{ left: shown.startSec * pxPerSec, width: widthPx, "--clip-color": track.color } as React.CSSProperties}
      onPointerDown={(e) => begin("move", e)}
      onPointerMove={onMove}
      onPointerUp={onEnd}
      onPointerCancel={onEnd}
    >
      <svg className="clip-wave" viewBox={`0 0 ${columns} ${WAVE_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
        <path d={wave} fill={track.color} />
      </svg>
      {(fadeInPx > 0 || fadeOutPx > 0) && (
        <svg className="clip-fades" viewBox={`0 0 ${widthPx} ${WAVE_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
          {fadeInPx > 0 && (
            <>
              <polygon points={`0,0 ${fadeInPx},0 0,${WAVE_HEIGHT}`} className="clip-fade-shade" />
              <line x1={0} y1={WAVE_HEIGHT} x2={fadeInPx} y2={0} className="clip-fade-line" />
            </>
          )}
          {fadeOutPx > 0 && (
            <>
              <polygon points={`${widthPx},0 ${widthPx - fadeOutPx},0 ${widthPx},${WAVE_HEIGHT}`} className="clip-fade-shade" />
              <line x1={widthPx - fadeOutPx} y1={0} x2={widthPx} y2={WAVE_HEIGHT} className="clip-fade-line" />
            </>
          )}
        </svg>
      )}
      {marks && marks.map((t, i) => <span key={i} className="clip-hit" style={{ left: (t - shown.startSec) * pxPerSec }} />)}
      <div className="clip-name">{track.assignedPlayerName ?? track.instrument}</div>
      {dragging === "fade-in" && <div className="clip-fade-tip left">{shown.fadeInSec.toFixed(2)} s</div>}
      {dragging === "fade-out" && <div className="clip-fade-tip right">{shown.fadeOutSec.toFixed(2)} s</div>}
      {showFadeHandles && (
        <>
          <div
            className={shown.fadeInSec > 0 ? "clip-fade-handle left set" : "clip-fade-handle left"}
            style={{ left: 10 + fadeInPx }}
            onPointerDown={(e) => begin("fade-in", e)}
            onDoubleClick={resetFade("in")}
            title="Drag to fade in. Double-click to remove the fade."
          />
          <div
            className={shown.fadeOutSec > 0 ? "clip-fade-handle right set" : "clip-fade-handle right"}
            style={{ right: 10 + fadeOutPx }}
            onPointerDown={(e) => begin("fade-out", e)}
            onDoubleClick={resetFade("out")}
            title="Drag to fade out. Double-click to remove the fade."
          />
        </>
      )}
      {canEdit && (
        <>
          <div className="clip-handle left" onPointerDown={(e) => begin("trim-start", e)} />
          <div className="clip-handle right" onPointerDown={(e) => begin("trim-end", e)} />
        </>
      )}
      {ghost &&
        createPortal(
          <div className="clip-ghost" style={{ left: ghost.left, top: ghost.top, width: ghost.width, height: ghost.height, "--clip-color": track.color } as React.CSSProperties}>
            <svg className="clip-wave" viewBox={`0 0 ${columns} ${WAVE_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
              <path d={wave} fill={track.color} />
            </svg>
          </div>,
          document.body,
        )}
    </div>
  );
}
