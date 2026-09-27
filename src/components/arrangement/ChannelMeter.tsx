import { useProjectStore } from "../../store/useProjectStore";

// RMS from an analyser is quiet by nature; scale it up so a normal level
// lights a useful number of segments.
const OUTPUT_GAIN = 6; // post-fader signal — generally louder headroom than a raw mic
const MIC_GAIN = 3.5; // matches InputLevelMeter

// Thresholds start low: an ordinary playing level is often a raw RMS well
// under 0.1, so the first light needs to catch that, not just a shout.
const SEGMENTS: { threshold: number; color: "green" | "amber" | "red" }[] = [
  { threshold: 0.04, color: "green" },
  { threshold: 0.12, color: "green" },
  { threshold: 0.28, color: "green" },
  { threshold: 0.5, color: "amber" },
  { threshold: 0.8, color: "red" },
];

/**
 * Signal lights next to a channel's fader. Two sources feed them, whichever
 * is relevant at the moment: while this channel is armed to record, the raw
 * microphone level (checking your input before/while capturing it); the rest
 * of the time, that channel's own audio — post-fader, so it lights up
 * whenever the channel is actually audible: a clip playing back, or anything
 * else passing through it.
 */
export function ChannelMeter({ trackId, armed }: { trackId: string; armed: boolean }) {
  const level = useProjectStore((s) =>
    armed ? Math.min(1, s.inputLevel * MIC_GAIN) : Math.min(1, (s.trackLevels[trackId] ?? 0) * OUTPUT_GAIN)
  );

  return (
    <div className="chan-meter-row">
      <div className="chan-meter" title={armed ? "Microphone level, live while armed to record" : "This channel's own level, live while it's audible"}>
        {SEGMENTS.map((seg, i) => (
          <span key={i} className={level >= seg.threshold ? `chan-meter-seg on ${seg.color}` : "chan-meter-seg"} />
        ))}
      </div>
    </div>
  );
}
