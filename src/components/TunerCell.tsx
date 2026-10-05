import { useEffect, useState } from "react";
import { useProjectStore } from "../store/useProjectStore";
import { buildAudioConstraints, resolveInputDeviceId } from "../lib/inputDevices";
import { detectPitch, noteFromHz, type TunerReading } from "../lib/tuner";

/** The tuner, as one more cell of the number display: click it, play a string, read the note and how far off it is. */
export function TunerCell() {
  const [on, setOn] = useState(false);
  const [reading, setReading] = useState<TunerReading | null>(null);
  const [error, setError] = useState(false);
  const recording = useProjectStore((s) => !!s.recordingTrackId);

  useEffect(() => {
    if (!on || recording) return;
    let stopped = false;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let timer = 0;
    (async () => {
      try {
        const { inputDeviceId } = useProjectStore.getState();
        const id = await resolveInputDeviceId(inputDeviceId);
        stream = await navigator.mediaDevices.getUserMedia({ audio: buildAudioConstraints(id) });
        if (stopped) return stream.getTracks().forEach((t) => t.stop());
        ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 4096;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const buf = new Float32Array(analyser.fftSize);
        let last: TunerReading | null = null;
        let quiet = 0;
        timer = window.setInterval(() => {
          analyser.getFloatTimeDomainData(buf);
          const hz = detectPitch(buf, ctx!.sampleRate);
          if (hz) {
            last = noteFromHz(hz);
            quiet = 0;
            setReading(last);
          } else if (++quiet > 12) {
            setReading(null); // hold the last note briefly so it doesn't flicker as the string fades
          }
        }, 60);
      } catch (err) {
        console.error("Tuner couldn't open the microphone:", err);
        if (!stopped) {
          setError(true);
          setOn(false);
        }
      }
    })();
    return () => {
      stopped = true;
      window.clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
      void ctx?.close();
      setReading(null);
    };
  }, [on, recording]);

  const live = on && !recording;
  const inTune = !!reading && Math.abs(reading.cents) <= 5;
  const hint = !live ? (error ? "no mic" : "off") : !reading ? "play a note" : inTune ? "in tune" : reading.cents < 0 ? `${-reading.cents}¢ flat` : `${reading.cents}¢ sharp`;

  return (
    <button
      className={live ? "lcd-cell tuner-cell on" : "lcd-cell tuner-cell"}
      onClick={() => {
        setError(false);
        setOn(!on);
      }}
      disabled={recording}
      title={recording ? "The tuner is off while recording" : live ? "Tuner on — click to turn it off" : "Tuner: click, then play a string"}
      aria-pressed={live}
      aria-label="Tuner"
    >
      <span className={inTune ? "lcd-n s tuner-note ok" : "lcd-n s tuner-note"}>{live && reading ? `${reading.name}${reading.octave}` : "Tuner"}</span>
      <span className="lcd-l">{hint}</span>
    </button>
  );
}
