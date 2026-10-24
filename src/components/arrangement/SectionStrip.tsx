import { useProjectStore } from "../../store/useProjectStore";
import { useSectionUiStore } from "../../store/useSectionUiStore";
import { beatSec } from "../../lib/grid";
import { sectionRanges } from "../../lib/sections";
import { LoopIcon } from "../icons/Icons";

/**
 * The song's sections under the bar numbers: a coloured band for each mark, lasting until the next one. Click a name to move the
 * playhead to its start; the small loop button repeats just that part; the Owner and the Mixer also get a ⋯ button to change it.
 */
export function SectionStrip({ totalBars, pxPerSec }: { totalBars: number; pxPerSec: number }) {
  const sections = useProjectStore((s) => s.sections);
  const bpm = useProjectStore((s) => s.project?.bpm ?? 120);
  const beatsPerBar = useProjectStore((s) => s.project?.beatsPerBar ?? 4);
  const seek = useProjectStore((s) => s.seek);
  const setLoopRegion = useProjectStore((s) => s.setLoopRegion);
  const canEdit = useProjectStore((s) => s.canEditSections());
  const locked = useProjectStore((s) => s.recordingTrackId !== null);
  const openEdit = useSectionUiStore((s) => s.openEdit);
  if (sections.length === 0) return null;
  const beatPx = pxPerSec * beatSec(bpm);
  const ranges = sectionRanges(sections, totalBars * beatsPerBar);
  return (
    <div className="section-strip" aria-label="Song sections">
      {ranges.map(({ section, startBeat, endBeat }) => (
        <div
          key={section.id}
          className="section-band"
          style={{ left: startBeat * beatPx, width: Math.max(6, (endBeat - startBeat) * beatPx), "--section-color": section.color } as React.CSSProperties}
          title={`${section.name}: from bar ${Math.floor(startBeat / beatsPerBar) + 1}`}
        >
          <button className="section-name" disabled={locked} onClick={() => seek(startBeat * beatSec(bpm))}>
            {section.name}
          </button>
          <button className="section-act" onClick={() => setLoopRegion(startBeat, endBeat)} title={`Repeat ${section.name}`} aria-label={`Repeat ${section.name}`}>
            <LoopIcon size={11} />
          </button>
          {canEdit && (
            <button className="section-act" onClick={() => openEdit(section.id)} title={`Change ${section.name}`} aria-label={`Change ${section.name}`}>
              ⋯
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
