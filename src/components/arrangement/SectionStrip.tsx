import { Fragment, useRef, useState } from "react";
import { useProjectStore } from "../../store/useProjectStore";
import { useSectionUiStore } from "../../store/useSectionUiStore";
import { beatSec } from "../../lib/grid";
import { barNumberAt, barStartBeat, dragSectionStart, sectionRanges } from "../../lib/sections";
import { LoopIcon } from "../icons/Icons";

/**
 * The song's sections under the bar numbers: a coloured band for each mark, lasting until the next one.
 * - Drag the handle at the left edge of a band (the line between two sections) to move where that section starts. It clicks to the bars.
 * - Double-click an empty part of the strip to add a section at that bar.
 * - Click a name to move the playhead to the start of the section; the loop button repeats just that part.
 * Only the Owner and the Mixer can drag, add or change; everyone else can jump and repeat.
 */
export function SectionStrip({ totalBars, pxPerSec }: { totalBars: number; pxPerSec: number }) {
  const sections = useProjectStore((s) => s.sections);
  const bpm = useProjectStore((s) => s.project?.bpm ?? 120);
  const beatsPerBar = useProjectStore((s) => s.project?.beatsPerBar ?? 4);
  const seek = useProjectStore((s) => s.seek);
  const setLoopRegion = useProjectStore((s) => s.setLoopRegion);
  const editSection = useProjectStore((s) => s.editSection);
  const canEdit = useProjectStore((s) => s.canEditSections());
  const locked = useProjectStore((s) => s.recordingTrackId !== null);
  const openEdit = useSectionUiStore((s) => s.openEdit);
  const openAdd = useSectionUiStore((s) => s.openAdd);
  const stripRef = useRef<HTMLDivElement>(null);
  // While a boundary is dragged the band follows the pointer at once; the change is saved when it is let go, and the band stays
  // where it was dropped until the saved value has come back (so it never jumps back to the old place first).
  const [drag, setDrag] = useState<{ id: string; atBeat: number; saving?: boolean } | null>(null);
  const dragRef = useRef<{ id: string; atBeat: number; startBeat: number } | null>(null);

  if (sections.length === 0 && !canEdit) return null;
  const beatPx = pxPerSec * beatSec(bpm);
  const shown = drag ? sections.map((s) => (s.id === drag.id ? { ...s, atBeat: drag.atBeat } : s)) : sections;
  const ranges = sectionRanges(shown, totalBars * beatsPerBar);

  const beatAt = (clientX: number) => {
    const rect = stripRef.current?.getBoundingClientRect();
    return rect ? Math.max(0, (clientX - rect.left) / beatPx) : 0;
  };

  const down = (e: React.PointerEvent<HTMLElement>, id: string, startBeat: number) => {
    if (!canEdit || locked || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { id, atBeat: startBeat, startBeat };
    setDrag({ id, atBeat: startBeat });
  };
  const move = (e: React.PointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const atBeat = dragSectionStart(sections, d.id, beatAt(e.clientX), beatsPerBar);
    if (atBeat === d.atBeat) return;
    dragRef.current = { ...d, atBeat };
    setDrag({ id: d.id, atBeat });
  };
  const up = async () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d || d.atBeat === d.startBeat) {
      setDrag(null);
      return;
    }
    setDrag({ id: d.id, atBeat: d.atBeat, saving: true });
    const problem = await editSection(d.id, { atBeat: d.atBeat });
    setDrag(null);
    if (problem) useProjectStore.setState({ editError: problem });
  };

  const addAt = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!canEdit || locked) return;
    // A double-click on a name or a handle is not a request for a new section.
    if ((e.target as HTMLElement).closest("button, .section-handle")) return;
    openAdd(barStartBeat(beatAt(e.clientX), beatsPerBar));
  };

  return (
    <div ref={stripRef} className={canEdit ? "section-strip editable" : "section-strip"} aria-label="Song sections" onDoubleClick={addAt} title={canEdit ? "Double-click here to add a section at that bar" : undefined}>
      {sections.length === 0 && <span className="section-hint">Double-click here to mark a part of the song: Intro, Verse, Chorus…</span>}
      {ranges.map(({ section, startBeat, endBeat }) => {
        const dragging = drag?.id === section.id && !drag.saving;
        const left = startBeat * beatPx;
        return (
          <Fragment key={section.id}>
            <div
              className={dragging ? "section-band dragging" : "section-band"}
              style={{ left, width: Math.max(6, (endBeat - startBeat) * beatPx), "--section-color": section.color } as React.CSSProperties}
              title={`${section.name}: from bar ${barNumberAt(startBeat, beatsPerBar)}`}
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
            {canEdit && !locked && (
              <span
                className={dragging ? "section-handle dragging" : "section-handle"}
                style={{ left, "--section-color": section.color } as React.CSSProperties}
                onPointerDown={(e) => down(e, section.id, section.atBeat)}
                onPointerMove={move}
                onPointerUp={() => void up()}
                onPointerCancel={() => void up()}
                title={`Drag to move where ${section.name} starts`}
                aria-hidden="true"
              />
            )}
            {dragging && (
              <span className="section-tip" style={{ left: left + 10 }} role="status">
                {section.name} starts at bar {barNumberAt(startBeat, beatsPerBar)}
              </span>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
