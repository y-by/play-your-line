import { useProjectStore } from "../../store/useProjectStore";
import { beatSec } from "../../lib/grid";
import type { Track } from "../../types/project";

/** The detected chords of one channel, along the top of its lane. Click a chord to move the playhead there. */
export function ChordStrip({ track, pxPerSec }: { track: Track; pxPerSec: number }) {
  const shown = useProjectStore((s) => !!s.chordsShown[track.id]);
  const segments = useProjectStore((s) => s.chords[track.id]);
  const bpm = useProjectStore((s) => s.project?.bpm ?? 120);
  const seek = useProjectStore((s) => s.seek);
  if (!shown || !segments) return null;
  const beat = beatSec(bpm);

  return (
    <div className="chord-strip" aria-label={`Chords detected on ${track.instrument} (a suggestion)`}>
      {segments.map((seg, i) =>
        seg.chord ? (
          <button
            key={i}
            className={seg.confidence < 0.6 ? "chord-pill unsure" : "chord-pill"}
            style={{ left: seg.startBeat * beat * pxPerSec, width: Math.max(14, (seg.endBeat - seg.startBeat) * beat * pxPerSec - 2) }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => seek(seg.startBeat * beat)}
            title={`${seg.chord} — ${Math.round(seg.confidence * 100)}% sure (detected, not guaranteed)`}
          >
            {seg.chord}
            {seg.confidence < 0.6 ? "?" : ""}
          </button>
        ) : null
      )}
    </div>
  );
}
