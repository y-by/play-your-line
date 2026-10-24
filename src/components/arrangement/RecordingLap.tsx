import { useEffect, useState } from "react";
import { useProjectStore } from "../../store/useProjectStore";

/** "Lap 3": shown on the channel being recorded, only while the recording goes round a loop. Nothing is drawn otherwise. */
export function RecordingLap() {
  const engine = useProjectStore((s) => s.engine);
  const [lap, setLap] = useState<number | null>(() => engine.getRecordingLap());
  useEffect(() => {
    const timer = window.setInterval(() => setLap(engine.getRecordingLap()), 120);
    return () => window.clearInterval(timer);
  }, [engine]);
  if (lap === null) return null;
  return (
    <span className="lap-pill" role="status" title={`Recording round the loop: this is lap ${lap}. Every lap becomes its own take.`}>
      Lap {lap}
    </span>
  );
}
