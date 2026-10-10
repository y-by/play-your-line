import { useProjectStore } from "../../store/useProjectStore";
import { peakToDb } from "../../lib/dbFader";

// Peak level in dBFS (0 dBFS is the loudest the file can hold). Five green, two amber, and a red light
// that comes on within 1 dB of the top. Peak, not average: it shows how close the signal is to clipping.
const SEGMENTS: { db: number; color: "green" | "amber" | "red" }[] = [
  { db: -48, color: "green" },
  { db: -36, color: "green" },
  { db: -28, color: "green" },
  { db: -21, color: "green" },
  { db: -15, color: "green" },
  { db: -9, color: "amber" },
  { db: -4, color: "amber" },
  { db: -1, color: "red" },
];

/**
 * Signal lights, a vertical column right beside the channel's colour tab. Two sources feed them, whichever
 * is relevant at the moment: while this channel is armed to record, the raw
 * microphone level (checking your input before/while capturing it); the rest
 * of the time, that channel's own audio — post-fader, so it lights up
 * whenever the channel is actually audible: a clip playing back, or anything
 * else passing through it.
 */
const toDb = peakToDb;

/**
 * How much of a mono signal reaches each side after the channel's pan (equal-power, the same law the
 * audio uses), so the lights show what is really going to the left and right speakers.
 */
function sideGains(pan: number): { left: number; right: number } {
  const angle = ((Math.max(-1, Math.min(1, pan)) + 1) * Math.PI) / 4;
  return { left: Math.cos(angle), right: Math.sin(angle) };
}

export const Column = ({ db }: { db: number }) => (
  <>
    {SEGMENTS.map((seg, i) => (
      <span key={i} className={db >= seg.db ? `chan-meter-seg on ${seg.color}` : "chan-meter-seg"} />
    ))}
  </>
);

export function ChannelMeter({ trackId, armed, pan }: { trackId: string; armed: boolean; pan: number }) {
  const peak = useProjectStore((s) => (armed ? s.inputPeak : (s.trackPeaks[trackId] ?? 0)));
  // Split into left and right only for a panned channel, and only for the channel's own sound — the
  // microphone you are about to record is a single signal.
  const split = !armed && Math.abs(pan) > 0.02;

  if (!split) {
    return (
      <div className="chan-meter-v" title={armed ? "Microphone peak level (red = about to clip)" : "This channel's peak level (red = about to clip)"}>
        <Column db={toDb(peak)} />
      </div>
    );
  }

  const { left, right } = sideGains(pan);
  return (
    <div className="chan-meter-v split" title="Left and right levels of this panned channel (red = about to clip)">
      <div className="chan-meter-side">
        <Column db={toDb(peak * left)} />
      </div>
      <div className="chan-meter-side">
        <Column db={toDb(peak * right)} />
      </div>
    </div>
  );
}
