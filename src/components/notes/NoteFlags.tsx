import { useEffect, useState } from "react";
import { useProjectStore } from "../../store/useProjectStore";
import { beatSec } from "../../lib/grid";
import { pinLabel, pinnedOpenNotes } from "../../lib/notes";
import { noteTint, useNoteTracks } from "./noteStyle";
import { canAnchor, distrustAnchors, looksAnchored } from "../../lib/anchor";
import { CheckIcon, FlagIcon } from "../icons/Icons";

/** Flags on the ruler at each open, pinned note. Click one for its bubble. */
export function NoteFlags({ pxPerSec }: { pxPerSec: number }) {
  const visible = useProjectStore((s) => s.notesVisible);
  const tracks = useNoteTracks();
  const notes = useProjectStore((s) => s.notes);
  const bpm = useProjectStore((s) => s.project?.bpm ?? 120);
  const openId = useProjectStore((s) => s.openFlagId);
  const setOpenFlag = useProjectStore((s) => s.setOpenFlag);
  const setNoteDone = useProjectStore((s) => s.setNoteDone);
  const jumpToNote = useProjectStore((s) => s.jumpToNote);
  const floatNote = useProjectStore((s) => s.floatNote);
  const canWrite = useProjectStore((s) => s.canWriteNotes());
  // Where the clicked flag is on screen, so the bubble can sit under it and stay inside the window.
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    if (!openId) return;
    const close = () => setOpenFlag(null);
    // Anchored, the bubble follows its flag as the ruler scrolls; measured, it can't, so it closes.
    if (!canAnchor()) window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [openId, setOpenFlag]);

  // Placed by the browser: make sure the bubble really landed by its flag; if not, measure instead.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!openId || !canAnchor()) return;
    const frame = requestAnimationFrame(() => {
      const bubble = document.querySelector(".note-bubble")?.getBoundingClientRect();
      const flag = document.querySelector(".note-flag.open")?.getBoundingClientRect();
      if (bubble && flag && !looksAnchored(bubble, flag, { width: window.innerWidth, height: window.innerHeight })) {
        distrustAnchors();
        setTick((t) => t + 1);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [openId]);

  if (!visible) return null;

  const pinned = pinnedOpenNotes(notes);
  const open = pinned.find((n) => n.id === openId) ?? null;
  const left = (atBeat: number) => atBeat * beatSec(bpm) * pxPerSec;
  const BUBBLE = 240;
  const bubbleLeft = anchor ? Math.max(8, Math.min(anchor.left - 4, window.innerWidth - BUBBLE - 8)) : 8;

  return (
    <>
      {pinned.map((n) => (
        <button
          key={n.id}
          className={n.id === openId ? "note-flag open" : "note-flag"}
          style={{ left: left(n.atBeat as number), color: noteTint(n, tracks), ...(canAnchor() && n.id === openId ? { anchorName: "--note-flag" } : {}) } as React.CSSProperties}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setAnchor({ left: r.left, top: r.bottom });
            setOpenFlag(n.id === openId ? null : n.id);
          }}
          title={`${n.authorName ?? "Someone"}: ${n.body}`}
          aria-label={`Note at ${pinLabel(n.atBeat as number)}`}
        >
          <FlagIcon size={14} />
        </button>
      ))}
      {open && anchor && (
        <div
          className={canAnchor() ? "note-bubble plugin-skin anchored" : "note-bubble plugin-skin"}
          style={{ ...(canAnchor() ? {} : { left: bubbleLeft, top: anchor.top + 6 }), width: BUBBLE, "--note-color": noteTint(open, tracks) } as React.CSSProperties}
        >
          <div className="note-meta">
            <b>{open.authorName ?? "Someone"}</b>
            <span>{pinLabel(open.atBeat as number)}</span>
          </div>
          <p className="note-body">{open.body}</p>
          <div className="note-bubble-actions">
            <button className="note-opt" onClick={() => jumpToNote(open.id)}>
              Go here
            </button>
            {canWrite && (
              <>
                <button className="note-opt" onClick={() => floatNote(open.id)}>
                  Pop out
                </button>
                <button className="note-send" onClick={() => void setNoteDone(open.id, true)}>
                  <CheckIcon size={12} /> Done
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
