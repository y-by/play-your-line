import { useProjectStore } from "../store/useProjectStore";

// RMS from the analyser is quiet by nature; scale it up so normal playing
// levels fill a useful portion of the meter instead of sitting near zero.
const METER_GAIN = 3.5;

export function InputLevelMeter() {
  const inputLevel = useProjectStore((s) => s.inputLevel);
  const level = Math.min(1, inputLevel * METER_GAIN);
  const percent = Math.round(level * 100);

  return (
    <div className="level-meter" title="Input level">
      <div
        className="level-meter-fill"
        style={{
          width: `${percent}%`,
          background:
            percent > 90
              ? "var(--color-red)"
              : percent > 70
                ? "#ffb200"
                : "var(--color-green)",
        }}
      />
    </div>
  );
}
