import { useEffect, useMemo, useRef, useState } from "react";
import { useProjectStore } from "../../store/useProjectStore";
import { renderMixFromBuffers } from "../../lib/mixdown";
import { computeStereoPeaks } from "../../lib/waveform";

const HEIGHT = 72;
const MAX_COLUMNS = 4096;
/** The mix is drawn from a render at this sample rate: cheap, and plenty to draw a waveform from. */
const DRAW_RATE = 8000;

/**
 * The waveform of the whole song as it comes out of the master: every channel with its fader, pan and effects,
 * through the master's fader, EQ, compressor and limiter. It is drawn again a moment after anything that changes
 * the sound (a clip, a fader, an effect), never while recording. Parts that reach the top are drawn in red.
 */
export function MasterWave({ pxPerSec }: { pxPerSec: number }) {
  const project = useProjectStore((s) => s.project);
  const engine = useProjectStore((s) => s.engine);
  const takesVersion = useProjectStore((s) => s.takesVersion);
  const recording = useProjectStore((s) => s.recordingTrackId !== null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [mix, setMix] = useState<AudioBuffer | null>(null);

  // Anything that changes what the master hears. (Solo is a listening aid and is not part of the mix.)
  const signature = useMemo(
    () => JSON.stringify([project?.tracks.map((t) => [t.id, t.volume, t.muted, t.pan, t.fx, t.clips, t.groupId]), project?.groups, project?.master, takesVersion]),
    [project?.tracks, project?.groups, project?.master, takesVersion]
  );

  useEffect(() => {
    if (!project || recording) return;
    let alive = true;
    const timer = setTimeout(async () => {
      const buffers = new Map<string, AudioBuffer>();
      for (const id of Object.keys(project.takes)) {
        const buffer = engine.getTakeBuffer(id);
        if (buffer) buffers.set(id, buffer);
      }
      if (buffers.size === 0) {
        if (alive) setMix(null);
        return;
      }
      try {
        const rendered = await renderMixFromBuffers(project, buffers, DRAW_RATE);
        if (alive) setMix(rendered);
      } catch (err) {
        console.warn("Couldn't draw the master waveform:", err);
      }
    }, 700);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // The signature says when the sound changed; the project object itself changes on every small edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, recording, engine]);

  const widthPx = mix ? Math.max(1, mix.duration * pxPerSec) : 0;
  const columns = Math.max(1, Math.min(MAX_COLUMNS, Math.round(widthPx)));

  useEffect(() => {
    const el = canvas.current;
    if (!el || !mix) return;
    el.width = columns;
    el.height = HEIGHT;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, columns, HEIGHT);
    const peaks = computeStereoPeaks(mix, columns);
    const mid = HEIGHT / 2;
    const scale = mid - 2;
    // A plain colour string and an alpha: some browsers hand back newer colour syntax that a canvas will not take.
    const wave = getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim() || "#4cc3cd";
    ctx.globalAlpha = 0.85;
    for (let c = 0; c < columns; c++) {
      const lo = peaks[c * 2];
      const hi = peaks[c * 2 + 1];
      const top = mid - Math.min(1, hi) * scale;
      const bottom = mid - Math.max(-1, lo) * scale;
      ctx.fillStyle = Math.max(hi, -lo) >= 0.99 ? "#ff453a" : wave;
      ctx.fillRect(c, top, 1, Math.max(1, bottom - top));
    }
  }, [mix, columns]);

  if (!mix) return null;
  return <canvas ref={canvas} className="master-wave" style={{ width: widthPx }} aria-label="Waveform of the whole song through the master" />;
}
