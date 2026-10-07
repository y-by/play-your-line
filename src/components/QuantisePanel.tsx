import { useEffect, useRef, useState } from "react";
import { useProjectStore } from "../store/useProjectStore";
import { QUANTISE_GRIDS } from "../lib/quantise";
import { HelpHint } from "./HelpHint";

const KEY = "pyl.quantise";

interface Saved {
  grid: number;
  strength: number;
  sensitivity: number;
}

function readSaved(): Saved {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return {
      grid: QUANTISE_GRIDS.some((g) => g.value === p.grid) ? p.grid : 16,
      strength: typeof p.strength === "number" ? Math.min(100, Math.max(0, p.strength)) : 100,
      sensitivity: typeof p.sensitivity === "number" ? Math.min(100, Math.max(0, p.sensitivity)) : 50,
    };
  } catch {
    return { grid: 16, strength: 100, sensitivity: 50 };
  }
}

/**
 * Quantise the selected clip: it is cut at each hit or note and the pieces are moved toward the grid.
 * The hits it found are drawn on the clip while this is open, so you can see what it will do before it does it.
 */
export function QuantisePanel({ onClose }: { onClose: () => void }) {
  const [saved] = useState(readSaved);
  const [grid, setGrid] = useState(saved.grid);
  const [strength, setStrength] = useState(saved.strength);
  const [sensitivity, setSensitivity] = useState(saved.sensitivity);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const selected = useProjectStore((s) => s.selectedClip);
  const previewQuantise = useProjectStore((s) => s.previewQuantise);
  const quantiseSelected = useProjectStore((s) => s.quantiseSelected);
  const setQuantiseMarks = useProjectStore((s) => s.setQuantiseMarks);
  const [found, setFound] = useState<{ hits: number; moves: number } | null>(null);
  const gridBeats = QUANTISE_GRIDS.find((g) => g.value === grid)?.beats ?? 0.25;
  const timer = useRef(0);

  // Look for the hits again whenever a setting (or the selected clip) changes, and draw them on the clip.
  useEffect(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setFound(previewQuantise({ sensitivity: sensitivity / 100, gridBeats, strength: strength / 100 }));
    }, 120);
    return () => window.clearTimeout(timer.current);
  }, [previewQuantise, sensitivity, gridBeats, strength, selected]);

  // Take the markers off the clip when the panel goes away.
  useEffect(() => () => setQuantiseMarks(null), [setQuantiseMarks]);

  const apply = async () => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      localStorage.setItem(KEY, JSON.stringify({ grid, strength, sensitivity }));
    } catch {
      // storage unavailable — the choice just won't be remembered
    }
    const moved = await quantiseSelected({ sensitivity: sensitivity / 100, gridBeats, strength: strength / 100 });
    setBusy(false);
    if (moved === null) setNote("Nothing to move: the hits are already on the grid, or none were found.");
    else if (moved === false) setNote("Couldn't save that, so it was undone. Try again.");
    else onClose();
  };

  return (
    <div className="quantise-panel">
      {!selected && <p className="settings-note">Select a clip first: click it in a channel of yours.</p>}
      <div className="quantise-row">
        <span>Grid</span>
        <div className="quantise-grids" role="group" aria-label="Grid">
          {QUANTISE_GRIDS.map((g) => (
            <button key={g.value} className={grid === g.value ? "quantise-opt on" : "quantise-opt"} aria-pressed={grid === g.value} onClick={() => setGrid(g.value)}>
              {g.label}
            </button>
          ))}
        </div>
      </div>
      <label className="quantise-row">
        <span>Strength</span>
        <input type="range" min={0} max={100} step={5} value={strength} onChange={(e) => setStrength(Number(e.target.value))} aria-label="Strength" />
        <b>{strength}%</b>
      </label>
      <label className="quantise-row">
        <span>Sensitivity</span>
        <input type="range" min={0} max={100} step={5} value={sensitivity} onChange={(e) => setSensitivity(Number(e.target.value))} aria-label="Sensitivity" />
        <b>{sensitivity < 34 ? "Few" : sensitivity < 67 ? "Normal" : "Many"}</b>
      </label>
      <p className="quantise-found" aria-live="polite">
        {selected ? (found ? `Found ${found.hits} ${found.hits === 1 ? "hit" : "hits"}; ${found.moves} would move.` : "Looking for hits…") : ""}
      </p>
      {note && <p className="assign-error">{note}</p>}
      <div className="quantise-actions">
        <button className="note-send" disabled={!selected || busy || !found || found.moves === 0} onClick={() => void apply()}>
          {busy ? "Working…" : "Quantise"}
        </button>
        <button className="note-opt" onClick={onClose}>
          Cancel
        </button>
        <HelpHint topic="quantise" up />
      </div>
    </div>
  );
}
