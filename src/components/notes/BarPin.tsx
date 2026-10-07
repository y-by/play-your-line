import { barSec } from "../../lib/grid";
import { useProjectStore } from "../../store/useProjectStore";

interface Props {
  pinned: boolean;
  bar: number;
  onPinned: (pinned: boolean) => void;
  onBar: (bar: number) => void;
}

/** Pin a note to any bar: a toggle, and the bar number once it is on. */
export function BarPin({ pinned, bar, onPinned, onBar }: Props) {
  const bars = useProjectStore((s) => Math.max(1, Math.ceil(s.durationSec / barSec(s.project?.bpm ?? 120, s.project?.beatsPerBar ?? 4) - 0.001)));
  return (
    <span className="bar-pin">
      <button
        type="button"
        className={pinned ? "note-opt on" : "note-opt"}
        onClick={() => onPinned(!pinned)}
        aria-pressed={pinned}
        title="Pin the note to a bar, so it shows as a flag on the timeline"
      >
        {pinned ? "Pinned to bar" : "Pin to a bar"}
      </button>
      {pinned && (
        <input
          className="bar-pin-input"
          type="number"
          min={1}
          max={Math.max(bars, bar)}
          step={1}
          value={bar}
          onChange={(e) => {
            const n = Math.floor(Number(e.target.value));
            if (Number.isFinite(n) && n >= 1) onBar(n);
          }}
          aria-label="Bar number"
          title={`Any bar from 1 to ${Math.max(bars, bar)}`}
        />
      )}
    </span>
  );
}
