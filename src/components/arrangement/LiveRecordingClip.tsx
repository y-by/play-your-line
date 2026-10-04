import { useEffect, useRef } from "react";
import type { Track } from "../../types/project";
import { useProjectStore } from "../../store/useProjectStore";

const WAVE_HEIGHT = 72;
const MAX_COLUMNS = 4096;
const CLIP_RED = "#ff453a";

/**
 * Draws min/max peaks onto the canvas, one column per slice of `totalSec`. Returns the amplitude
 * boost it used (quiet takes are drawn larger, up to 4x, like the finished clip).
 */
function drawPeaks(
  canvas: HTMLCanvasElement,
  peaks: Float32Array,
  binSec: number,
  totalSec: number,
  widthPx: number,
  color: string,
  boost: number
) {
  const columns = Math.max(1, Math.min(MAX_COLUMNS, Math.round(widthPx)));
  if (canvas.width !== columns) canvas.width = columns;
  if (canvas.height !== WAVE_HEIGHT) canvas.height = WAVE_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, columns, WAVE_HEIGHT);
  const bins = peaks.length / 2;
  if (bins === 0 || totalSec <= 0) return;
  const mid = WAVE_HEIGHT / 2;
  const perColumn = totalSec / columns;
  for (let x = 0; x < columns; x++) {
    const from = Math.floor((x * perColumn) / binSec);
    if (from >= bins) break; // the tip: audio that hasn't arrived yet stays empty
    const to = Math.min(bins, Math.max(from + 1, Math.ceil(((x + 1) * perColumn) / binSec)));
    let lo = 0;
    let hi = 0;
    for (let b = from; b < to; b++) {
      if (peaks[b * 2] < lo) lo = peaks[b * 2];
      if (peaks[b * 2 + 1] > hi) hi = peaks[b * 2 + 1];
    }
    ctx.fillStyle = Math.max(hi, -lo) >= 0.98 ? CLIP_RED : color;
    const top = mid - Math.min(1, hi * boost) * mid;
    const bottom = mid - Math.max(-1, lo * boost) * mid;
    ctx.fillRect(x, top, 1, Math.max(1, bottom - top));
  }
}

function loudestOf(peaks: Float32Array): number {
  let loudest = 0;
  for (let i = 0; i < peaks.length; i++) loudest = Math.max(loudest, Math.abs(peaks[i]));
  return loudest;
}

/**
 * The take as it is being recorded: a waveform that grows in the channel from where the take will
 * land, then — once saved — slides and stretches into the exact place of the real clip and fades
 * into it.
 */
export function LiveRecordingClip({ track, pxPerSec }: { track: Track; pxPerSec: number }) {
  const engine = useProjectStore((s) => s.engine);
  const recording = useProjectStore((s) => s.recordingTrackId === track.id && s.recordingPhase === "recording");
  const ghost = useProjectStore((s) => (s.recordingGhost?.trackId === track.id ? s.recordingGhost : null));
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pxRef = useRef(pxPerSec);

  useEffect(() => {
    pxRef.current = pxPerSec;
  }, [pxPerSec]);

  // While recording: follow the audio clock every frame, so the right edge moves smoothly.
  useEffect(() => {
    if (!recording) return;
    let raf = 0;
    let boost = 1;
    const frame = () => {
      const wrap = wrapRef.current;
      const canvas = canvasRef.current;
      const live = engine.getLiveRecording();
      if (wrap && canvas && live) {
        const px = pxRef.current;
        const widthPx = Math.max(2, live.tipSec * px);
        wrap.style.left = `${live.startSec * px}px`;
        wrap.style.width = `${widthPx}px`;
        wrap.style.visibility = "visible";
        const loudest = loudestOf(live.peaks);
        const targetBoost = loudest > 0 ? Math.min(4, 0.9 / loudest) : 1;
        boost += (targetBoost - boost) * 0.12; // eased, so the picture doesn't jump when a loud note arrives
        drawPeaks(canvas, live.peaks, live.binSec, live.tipSec, widthPx, track.color, boost);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [recording, engine, track.color]);

  // After Stop: draw the finished recording once; CSS does the sliding.
  useEffect(() => {
    if (!ghost || recording) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const loudest = loudestOf(ghost.peaks);
    const boost = loudest > 0 ? Math.min(4, 0.9 / loudest) : 1;
    drawPeaks(canvas, ghost.peaks, ghost.binSec, ghost.durationSec, ghost.durationSec * pxRef.current, track.color, boost);
  }, [ghost, recording, track.color]);

  if (!recording && !ghost) return null;

  const settling = !!ghost && !recording;
  const where = ghost?.target ?? ghost;
  const style: React.CSSProperties = { "--clip-color": track.color } as React.CSSProperties;
  if (settling && ghost && where) {
    style.left = where.startSec * pxPerSec;
    style.width = Math.max(3, where.durationSec * pxPerSec);
  } else {
    style.visibility = "hidden"; // shown by the first frame that has audio
  }

  const className = ["live-clip", recording ? "live" : "ghost", settling && !ghost?.target ? "saving" : "", ghost?.target ? "landing" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div ref={wrapRef} className={className} style={style}>
      <canvas ref={canvasRef} className="clip-wave" />
    </div>
  );
}
