import { MIN_DB, MAX_DB } from "../../lib/dbFader";

// Ticks along the fader's travel, like the printed scale beside a console fader. `tier` decides how
// much of it shows at a given width (1 = always, 3 = only on a wide fader).
const MARKS: { db: number; label: string; tier: 1 | 2 | 3; major: boolean }[] = [
  { db: MAX_DB, label: "+6", tier: 3, major: true },
  { db: 0, label: "0", tier: 1, major: true },
  { db: -10, label: "10", tier: 3, major: true },
  { db: -20, label: "20", tier: 2, major: true },
  { db: -30, label: "30", tier: 3, major: true },
  { db: -40, label: "40", tier: 2, major: true },
  { db: -50, label: "50", tier: 3, major: true },
  { db: MIN_DB, label: "∞", tier: 1, major: true },
  { db: 3, label: "", tier: 3, major: false },
  { db: -5, label: "", tier: 3, major: false },
  { db: -15, label: "", tier: 3, major: false },
  { db: -25, label: "", tier: 3, major: false },
  { db: -35, label: "", tier: 3, major: false },
  { db: -45, label: "", tier: 3, major: false },
  { db: -55, label: "", tier: 3, major: false },
];

/** The printed dB scale under a channel fader (decoration only; the slider above does the work). */
export function FaderScale() {
  return (
    <div className="fader-scale" aria-hidden="true">
      {MARKS.map((m) => (
        <span
          key={m.db}
          className={`fader-mark tier-${m.tier}${m.major ? " major" : ""}${m.db === 0 ? " zero" : ""}`}
          style={{ ["--f" as string]: (m.db - MIN_DB) / (MAX_DB - MIN_DB) }}
        >
          <i />
          {m.label && <b>{m.label}</b>}
        </span>
      ))}
    </div>
  );
}
