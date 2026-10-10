import { useEffect, useMemo, useState } from "react";
import { useProjectStore } from "../../store/useProjectStore";
import { renderMixFromBuffers } from "../../lib/mixdown";
import { computeStereoPeaks } from "../../lib/waveform";
import { wavePath } from "../../lib/wavePath";

const HEIGHT = 72;
const MAX_COLUMNS = 8192;
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
  const density = Math.min(2, typeof window === "undefined" ? 1 : window.devicePixelRatio || 1);
  const columns = Math.max(1, Math.min(MAX_COLUMNS, Math.round(widthPx * density)));

  // The wave as vector shapes: sharp at any zoom or height. Columns that reach the top are drawn again in red.
  const shapes = useMemo(() => {
    if (!mix) return null;
    const peaks = computeStereoPeaks(mix, columns);
    const clipped: string[] = [];
    for (let c = 0; c < columns; c++) {
      if (Math.max(peaks[c * 2 + 1], -peaks[c * 2]) >= 0.99) clipped.push(`M${c},0h1v${HEIGHT}h-1z`);
    }
    return { wave: wavePath(peaks, columns, HEIGHT), clipped: clipped.join("") };
  }, [mix, columns]);

  if (!shapes) return null;
  return (
    <svg className="master-wave" style={{ width: widthPx }} viewBox={`0 0 ${columns} ${HEIGHT}`} preserveAspectRatio="none" role="img" aria-label="Waveform of the whole song through the master">
      <path d={shapes.wave} fill="currentColor" fillOpacity="0.85" />
      {shapes.clipped && <path d={shapes.clipped} fill="#ff453a" />}
    </svg>
  );
}
