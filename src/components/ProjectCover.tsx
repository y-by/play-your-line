import { TRACK_COLORS } from "../lib/trackColors";
import { hash, makeRandom } from "../lib/coverArt";

const delay = (i: number, step = 0.5) => ({ animationDelay: `${(-i * step).toFixed(2)}s` });

/** Line-art motifs, each with its own slow, subtle movement (see .motif-* in app.css). */
const MOTIFS: ((next: () => number) => React.ReactNode)[] = [
  // Concentric rings that breathe
  () => (
    <g className="motif-rings">
      {[36, 25, 14].map((r, i) => (
        <circle key={r} cx="50" cy="50" r={r} style={delay(i, 0.7)} />
      ))}
    </g>
  ),
  // A dashed orbit turning around a core
  () => (
    <g>
      <g className="motif-orbit">
        <circle cx="50" cy="50" r="34" strokeDasharray="3.2 4.4" />
        <circle cx="84" cy="50" r="3.4" className="motif-dot" />
      </g>
      <circle cx="50" cy="50" r="10" className="motif-core" />
    </g>
  ),
  // A four-point sparkle
  () => (
    <path
      className="motif-sparkle"
      d="M50 12 C54 36 64 46 88 50 C64 54 54 64 50 88 C46 64 36 54 12 50 C36 46 46 36 50 12 Z"
    />
  ),
  // Stacked stones, floating
  () => (
    <g className="motif-stack">
      <ellipse cx="50" cy="26" rx="13" ry="9" style={delay(0, 0.9)} />
      <ellipse cx="50" cy="48" rx="23" ry="12" style={delay(1, 0.9)} />
      <ellipse cx="50" cy="73" rx="33" ry="15" style={delay(2, 0.9)} />
    </g>
  ),
  // Waveform bars that bob
  (next) => (
    <g className="motif-bars">
      {Array.from({ length: 15 }, (_, i) => {
        const swell = Math.sin((i / 14) * Math.PI);
        const v = 10 + swell * 34 + ((next() % 1000) / 1000) * 14;
        return <line key={i} x1={14 + i * 5.7} x2={14 + i * 5.7} y1={50 - v / 2} y2={50 + v / 2} style={delay(i, 0.18)} />;
      })}
    </g>
  ),
  // A vortex of ellipses that sways
  () => (
    <g className="motif-spiral">
      {[34, 28, 22, 16, 11, 7].map((rx, i) => (
        <ellipse key={rx} cx="50" cy={22 + i * 11} rx={rx} ry={rx * 0.3} style={delay(i, 0.6)} />
      ))}
    </g>
  ),
];

/** The project's cover: its own image if the Owner added one, otherwise generated line-art on a gradient. */
export function ProjectCover({ id, imageUrl }: { id: string; imageUrl?: string | null }) {
  if (imageUrl) {
    return (
      <div className="cover" aria-hidden="true">
        <img className="cover-backdrop" src={imageUrl} alt="" loading="lazy" draggable={false} />
        <img className="cover-image" src={imageUrl} alt="" loading="lazy" draggable={false} />
      </div>
    );
  }
  const next = makeRandom(hash(id));
  const a = TRACK_COLORS[next() % TRACK_COLORS.length];
  const angle = 130 + (next() % 70);
  const motif = MOTIFS[next() % MOTIFS.length](next);

  return (
    <div
      className="cover"
      style={{
        background: `linear-gradient(${angle}deg, color-mix(in srgb, ${a} 76%, white), ${a} 55%, color-mix(in srgb, ${a} 78%, black))`,
      }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
        {motif}
      </svg>
    </div>
  );
}
