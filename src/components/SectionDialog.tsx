import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useProjectStore } from "../store/useProjectStore";
import { useSectionUiStore } from "../store/useSectionUiStore";
import { beatSec } from "../lib/grid";
import { barNumberAt, SECTION_COLORS, SECTION_NAME_MAX, SECTION_PRESETS, sectionColorFor } from "../lib/sections";

/** Add a section at the playhead, or change one (rename, colour, move to the playhead, delete). Owner and Mixer only. */
export function SectionDialog() {
  const dialog = useSectionUiStore((s) => s.dialog);
  const close = useSectionUiStore((s) => s.close);
  const sections = useProjectStore((s) => s.sections);
  const positionSec = useProjectStore((s) => s.positionSec);
  const bpm = useProjectStore((s) => s.project?.bpm ?? 120);
  const beatsPerBar = useProjectStore((s) => s.project?.beatsPerBar ?? 4);
  const addSectionAtPlayhead = useProjectStore((s) => s.addSectionAtPlayhead);
  const editSection = useProjectStore((s) => s.editSection);
  const removeSection = useProjectStore((s) => s.removeSection);
  const existing = dialog?.mode === "edit" ? sections.find((x) => x.id === dialog.id) : undefined;
  const [name, setName] = useState("");
  const [color, setColor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Start fresh each time a dialog opens (the fields come from the section being changed).
  const openKey = dialog ? (dialog.mode === "edit" ? `edit:${dialog.id}` : "add") : "";
  const [shownKey, setShownKey] = useState("");
  if (openKey !== shownKey) {
    setShownKey(openKey);
    setName(existing?.name ?? "");
    setColor(existing?.color ?? null);
    setError(null);
  }

  useEffect(() => {
    if (!dialog) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog, close]);

  if (!dialog) return null;
  const addBeat = dialog?.mode === "add" && dialog.atBeat !== null ? dialog.atBeat : null;
  const bar = barNumberAt(addBeat ?? positionSec / beatSec(bpm), beatsPerBar);
  const chosenColor = color ?? sectionColorFor(name, sections.filter((s) => s.id !== existing?.id).map((s) => s.color));

  const run = async (work: () => Promise<string | null>) => {
    setBusy(true);
    setError(null);
    const problem = await work();
    setBusy(false);
    if (problem) setError(problem);
    else close();
  };

  const save = () =>
    run(() => (existing ? editSection(existing.id, { name, color: chosenColor }) : addSectionAtPlayhead(name, chosenColor, addBeat ?? undefined)));

  return createPortal(
    <div className="zip-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="zip-panel fb-panel" role="dialog" aria-label={existing ? "Change section" : "Add section"}>
        <h3>{existing ? "Change section" : `Add a section at bar ${bar}`}</h3>
        <p className="zip-lead">
          {existing
            ? "Rename it, give it another colour, or move it to the bar where the playhead is. It lasts until the next section."
            : addBeat !== null
              ? "The section starts at the bar you double-clicked and lasts until the next section."
              : "The section starts at the bar the playhead is in and lasts until the next section."}
        </p>
        <div className="sec-presets" role="group" aria-label="Pick a name">
          {SECTION_PRESETS.map((p) => (
            <button key={p.name} type="button" className={name.trim().toLowerCase() === p.name.toLowerCase() ? "on" : ""} style={{ "--section-color": p.color } as React.CSSProperties} onClick={() => { setName(p.name); setColor(null); }}>
              {p.name}
            </button>
          ))}
        </div>
        <input
          id="section-name"
          className="fb-text sec-input"
          value={name}
          maxLength={SECTION_NAME_MAX}
          placeholder="or type your own name"
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) void save(); }}
          aria-label="Section name"
        />
        <div className="sec-colors" role="group" aria-label="Colour">
          {SECTION_COLORS.map((c) => (
            <button key={c} type="button" className={c === chosenColor ? "on" : ""} style={{ background: c }} onClick={() => setColor(c)} aria-label={`Colour ${c}`} />
          ))}
        </div>
        {existing && (
          <button className="fb-attach" disabled={busy} onClick={() => void run(() => editSection(existing.id, { moveToPlayhead: true }))}>
            Move it to bar {bar} (where the playhead is)
          </button>
        )}
        {error && <p className="fb-warn" role="alert">{error}</p>}
        <div className="fb-row">
          {existing && (
            <button className="zip-cancel sec-delete" disabled={busy} onClick={() => { if (confirm(`Delete the section "${existing.name}"?`)) void run(() => removeSection(existing.id)); }}>
              Delete
            </button>
          )}
          <button className="zip-cancel" onClick={close} disabled={busy}>Cancel</button>
          <button className="fb-send" onClick={() => void save()} disabled={busy || !name.trim()}>{busy ? "Saving…" : existing ? "Save" : "Add section"}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
