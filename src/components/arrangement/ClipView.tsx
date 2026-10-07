import { useEffect, useRef, useState } from "react";
import type { Clip, Take, Track } from "../../types/project";
import { useProjectStore } from "../../store/useProjectStore";
import { clipEnd, moveClip, setClipFade, trimClipEnd, trimClipStart } from "../../lib/clips";
import { snapTo, stepSec } from "../../lib/grid";
import { computePeaks } from "../../lib/waveform";

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
const MAX_WAVE_COLUMNS = 4096;

export function ClipView({ track, clip, take, canEdit, selected, pxPerSec }: Props) {
  const engine = useProjectStore((s) => s.engine);
  const bpm = useProjectStore((s) => s.project?.bpm ?? 120);
  const beatsPerBar = useProjectStore((s) => s.project?.beatsPerBar ?? 4);
  const snapEnabled = useProjectStore((s) => s.snapEnabled);
  const snapResolution = useProjectStore((s) => s.snapResolution);
  const takesVersion = useProjectStore((s) => s.takesVersion);
  const selectClip = useProjectStore((s) => s.selectClip);
  const commitClips = useProjectStore((s) => s.commitClips);
  const marks = useProjectStore((s) => (s.quantiseMarks?.clipId === clip.id ? s.quantiseMarks.times : null));

  // While dragging, the clip follows the pointer locally; nothing is saved until you let go.
  const [preview, setPreview] = useState<Clip | null>(null);
  const [dragMode, setDragMode] = useState<DragMode | null>(null);
  const drag = useRef<{ mode: DragMode; startX: number; original: Clip; latest: Clip; moved: boolean } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const shown = preview ?? clip;
  const widthPx = Math.max(3, shown.durationSec * pxPerSec);
  const columns = Math.max(1, Math.min(MAX_WAVE_COLUMNS, Math.round(widthPx)));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = columns;
    canvas.height = WAVE_HEIGHT;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, columns, WAVE_HEIGHT);
    const buffer = engine.getTakeBuffer(clip.takeId);
    if (!buffer) return;

    const peaks = computePeaks(buffer.getChannelData(0), buffer.sampleRate, shown.sourceStartSec, shown.durationSec, columns);
    let loudest = 0;
    for (let i = 0; i < peaks.length; i++) loudest = Math.max(loudest, Math.abs(peaks[i]));
    // Quiet takes are drawn a little larger (up to 4x) so they stay readable.
    const boost = loudest > 0 ? Math.min(4, 0.9 / loudest) : 1;

    const mid = WAVE_HEIGHT / 2;
    ctx.fillStyle = track.color;
    for (let x = 0; x < columns; x++) {
      const top = mid - peaks[x * 2 + 1] * boost * mid;
      const bottom = mid - peaks[x * 2] * boost * mid;
      ctx.fillRect(x, top, 1, Math.max(1, bottom - top));
    }
  }, [engine, clip.takeId, shown.sourceStartSec, shown.durationSec, columns, takesVersion, track.color]);

  const step = stepSec(bpm, snapResolution, beatsPerBar);
  // Holding Alt while dragging ignores snapping (free placement).
  const snap = (sec: number, free: boolean) => (snapEnabled && !free ? snapTo(sec, step) : sec);

  const begin = (mode: DragMode, e: React.PointerEvent<HTMLElement>) => {
    if (!canEdit) return;
    e.stopPropagation();
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Capture is only a convenience; dragging still works while the pointer stays over the clip.
    }
    selectClip({ trackId: track.id, clipId: clip.id });
    drag.current = { mode, startX: e.clientX, original: clip, latest: clip, moved: false };
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    if (!d.moved && Math.abs(dx) < 3) return;
    d.moved = true;
    setDragMode(d.mode);
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
    setPreview(next);
  };

  const onEnd = () => {
    const d = drag.current;
    drag.current = null;
    setDragMode(null);
    if (!d) return;
    if (d.moved) void commitClips(track.id, track.clips.map((c) => (c.id === clip.id ? d.latest : c)));
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

  const className = ["clip", selected ? "selected" : "", canEdit ? "editable" : "", preview ? "dragging" : ""]
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
      <canvas ref={canvasRef} className="clip-wave" />
      {(fadeInPx > 0 || fadeOutPx > 0) && (
        <svg className="clip-fades" width={widthPx} height={WAVE_HEIGHT} aria-hidden="true">
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
    </div>
  );
}
