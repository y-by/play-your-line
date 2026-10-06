import { useEffect, useRef, useState } from "react";
import { useProjectStore } from "../../store/useProjectStore";
import { buildAudioConstraints, resolveInputDeviceId } from "../../lib/inputDevices";
import { centsFromTarget, detectPitch, INSTRUMENTS, noteFromHz, noteName, strobeSpeed, type TunerReading } from "../../lib/tuner";

const KEY = "pyl.tuner";
const IN_TUNE_CENTS = 3;
/** How much faster each strobe ring moves than the first: the outer rings show a small error larger, like a real strobe's upper bands. */
const BANDS = [
  { multiplier: 1, stripes: 12 },
  { multiplier: 2, stripes: 24 },
  { multiplier: 4, stripes: 48 },
  { multiplier: 8, stripes: 96 },
];

function readSaved(): { instrument: string; refA: number } {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    const refA = typeof parsed.refA === "number" ? Math.min(466, Math.max(415, Math.round(parsed.refA))) : 440;
    const instrument = INSTRUMENTS.some((i) => i.id === parsed.instrument) ? parsed.instrument : "chromatic";
    return { instrument, refA };
  } catch {
    return { instrument: "chromatic", refA: 440 };
  }
}

interface Live {
  reading: TunerReading | null;
  /** Sound level 0..1, for the little meter. */
  level: number;
  error: boolean;
}

/** Listens to the chosen input and works out the note. `target` fixes the note being tuned to (a string); null means nearest note. */
function useTuner(active: boolean, refA: number, targetMidi: number | null, centsRef: React.MutableRefObject<number | null>): Live {
  const [live, setLive] = useState<Live>({ reading: null, level: 0, error: false });
  const refs = useRef({ refA, targetMidi });
  useEffect(() => {
    refs.current = { refA, targetMidi };
  }, [refA, targetMidi]);

  useEffect(() => {
    if (!active) {
      centsRef.current = null;
      return;
    }
    let stopped = false;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let timer = 0;
    (async () => {
      try {
        const { inputDeviceId, inputChannelIndex } = useProjectStore.getState();
        const id = await resolveInputDeviceId(inputDeviceId);
        stream = await navigator.mediaDevices.getUserMedia({ audio: buildAudioConstraints(id, inputChannelIndex) });
        if (stopped) return stream.getTracks().forEach((t) => t.stop());
        ctx = new AudioContext();
        if (ctx.state === "suspended") await ctx.resume().catch(() => {});
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 8192;
        const channels = Math.max(1, source.channelCount);
        const wanted = inputChannelIndex != null && inputChannelIndex < channels ? inputChannelIndex : 0;
        if (channels > 1) {
          const splitter = ctx.createChannelSplitter(channels);
          source.connect(splitter);
          splitter.connect(analyser, wanted);
        } else {
          source.connect(analyser);
        }
        const buf = new Float32Array(analyser.fftSize);
        const recent: number[] = [];
        let quiet = 0;
        let held: TunerReading | null = null;
        timer = window.setInterval(() => {
          analyser.getFloatTimeDomainData(buf);
          let peak = 0;
          for (let i = 0; i < buf.length; i += 8) peak = Math.max(peak, Math.abs(buf[i]));
          const hz = detectPitch(buf, ctx!.sampleRate);
          if (hz) {
            recent.push(hz);
            if (recent.length > 5) recent.shift();
            const sorted = [...recent].sort((a, b) => a - b);
            const median = sorted[Math.floor(sorted.length / 2)];
            const { refA: a, targetMidi: target } = refs.current;
            if (target == null) {
              held = noteFromHz(median, a);
            } else {
              held = { ...noteName(target), midi: target, cents: centsFromTarget(median, target, a), hz: median };
            }
            quiet = 0;
            centsRef.current = held.cents;
          } else if (++quiet > 14) {
            held = null;
            recent.length = 0;
            centsRef.current = null;
          }
          setLive({ reading: held, level: Math.min(1, peak * 2.5), error: false });
        }, 50);
      } catch (err) {
        console.error("The tuner couldn't open the microphone:", err);
        if (!stopped) setLive({ reading: null, level: 0, error: true });
      }
    })();
    return () => {
      stopped = true;
      window.clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
      void ctx?.close();
      centsRef.current = null;
      setLive({ reading: null, level: 0, error: false });
    };
  }, [active, centsRef]);

  return live;
}

/** The strobe: rings of stripes that drift left when the note is flat, right when sharp, and stand still when it is in tune. */
function Strobe({ centsRef, inTune }: { centsRef: React.MutableRefObject<number | null>; inTune: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const tuned = useRef(inTune);
  useEffect(() => {
    tuned.current = inTune;
  }, [inTune]);

  useEffect(() => {
    const el = canvas.current;
    const g = el?.getContext("2d");
    if (!el || !g) return;
    const W = 252;
    const H = 132;
    const dpr = window.devicePixelRatio || 1;
    el.width = W * dpr;
    el.height = H * dpr;
    g.scale(dpr, dpr);
    const css = getComputedStyle(document.documentElement);
    const lit = css.getPropertyValue("--pl-accent").trim() || "#52c7d6";
    const inset = css.getPropertyValue("--pl-inset").trim() || "#0a0d11";
    const cx = W / 2;
    const cy = H - 6;
    const r0 = 30;
    const R = H - 12;
    const bandH = (R - r0) / BANDS.length;
    const phases = BANDS.map(() => 0);
    let last = performance.now();
    let frame = 0;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const cents = centsRef.current;
      g.clearRect(0, 0, W, H);
      BANDS.forEach((b, i) => {
        const speed = reduce ? 0 : cents === null ? 0.15 * (i % 2 ? -1 : 1) : strobeSpeed(cents, b.multiplier);
        phases[i] = (phases[i] + speed * dt) % 1;
        const rIn = r0 + i * bandH + 1;
        const rOut = r0 + (i + 1) * bandH - 1;
        const cycle = Math.PI / b.stripes;
        g.beginPath();
        for (let k = -1; k <= b.stripes; k++) {
          const a0 = Math.PI + (k + phases[i]) * cycle;
          const a1 = a0 + cycle / 2;
          const s0 = Math.max(Math.PI, a0);
          const s1 = Math.min(2 * Math.PI, a1);
          if (s1 <= s0) continue;
          g.moveTo(cx + rIn * Math.cos(s0), cy + rIn * Math.sin(s0));
          g.arc(cx, cy, rOut, s0, s1);
          g.arc(cx, cy, rIn, s1, s0, true);
          g.closePath();
        }
        g.fillStyle = cents === null ? "rgba(143,163,184,0.25)" : tuned.current ? "#5fe08a" : lit;
        g.fill();
      });
      // The still mark at the top: where a stripe should rest when the note is in tune.
      g.strokeStyle = cents !== null && tuned.current ? "#5fe08a" : "rgba(255,255,255,0.55)";
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(cx, cy - r0 + 6);
      g.lineTo(cx, cy - R - 3);
      g.stroke();
      g.fillStyle = inset;
      g.beginPath();
      g.arc(cx, cy, r0 - 4, Math.PI, 2 * Math.PI);
      g.fill();
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [centsRef]);

  return (
    <div className="strobe">
      <span className="strobe-side flat" title="Stripes drifting left mean the note is flat: tune up">♭</span>
      <canvas ref={canvas} style={{ width: 252, height: 132 }} aria-label="Strobe tuning display" />
      <span className="strobe-side sharp" title="Stripes drifting right mean the note is sharp: tune down">♯</span>
    </div>
  );
}

/** The Tuner tab: a strobe display in the spirit of a Peterson strobe tuner. Works for bass as well as guitar. */
export function TunerPanel() {
  const [saved] = useState(readSaved);
  const [instrumentId, setInstrumentId] = useState(saved.instrument);
  const [refA, setRefA] = useState(saved.refA);
  const [targetMidi, setTargetMidi] = useState<number | null>(null);
  const recording = useProjectStore((s) => !!s.recordingTrackId);
  const centsRef = useRef<number | null>(null);
  const live = useTuner(!recording, refA, targetMidi, centsRef);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ instrument: instrumentId, refA }));
    } catch {
      // storage unavailable — the choice just won't be remembered
    }
  }, [instrumentId, refA]);

  const instrument = INSTRUMENTS.find((i) => i.id === instrumentId) ?? INSTRUMENTS[0];
  const r = live.reading;
  const inTune = !!r && Math.abs(r.cents) <= IN_TUNE_CENTS;
  const shownCents = r ? Math.max(-50, Math.min(50, r.cents)) : 0;
  const far = !!r && Math.abs(r.cents) > 50;
  const hint = recording
    ? "The tuner rests while you record."
    : live.error
      ? "Can't reach the microphone. Allow it in the browser, and check your input in Settings."
      : r
        ? inTune
          ? "In tune"
          : r.cents < 0
            ? far ? "Way flat: tune up" : `${-r.cents}¢ flat: tune up`
            : far ? "Way sharp: tune down" : `${r.cents}¢ sharp: tune down`
        : "Play a note";

  return (
    <div className="fx-section fx-section-tuner">
      <div className="tuner-top">
        <select
          className="fx-preset"
          value={instrumentId}
          onChange={(e) => {
            setInstrumentId(e.target.value);
            setTargetMidi(null);
          }}
          aria-label="What are you tuning"
        >
          {INSTRUMENTS.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>
        <span className="tuner-ref" title="The pitch that A is tuned to. 440 is the standard.">
          <button className="fx-tool-btn" onClick={() => setRefA((a) => Math.max(415, a - 1))} aria-label="Lower the reference pitch">
            −
          </button>
          <span>A {refA}</span>
          <button className="fx-tool-btn" onClick={() => setRefA((a) => Math.min(466, a + 1))} aria-label="Raise the reference pitch">
            +
          </button>
        </span>
      </div>

      <div className={inTune ? "tuner-note ok" : r ? "tuner-note" : "tuner-note idle"} aria-live="polite">
        <span className="tuner-name">{r ? r.name : "–"}</span>
        {r && <sub className="tuner-octave">{r.octave}</sub>}
      </div>
      <div className={inTune ? "tuner-cents ok" : "tuner-cents"}>{r ? (inTune ? "0¢" : `${r.cents > 0 ? "+" : ""}${r.cents}¢`) : "¢"}</div>

      <Strobe centsRef={centsRef} inTune={inTune} />

      <div className="tuner-gauge" aria-hidden="true">
        <span className="tuner-gauge-mid" />
        {r && <span className={inTune ? "tuner-needle ok" : "tuner-needle"} style={{ left: `${50 + shownCents}%` }} />}
      </div>
      <div className="tuner-scale">
        <span>−50</span>
        <span>0</span>
        <span>+50</span>
      </div>

      {instrument.strings.length > 0 && (
        <div className="tuner-strings" role="group" aria-label="Strings">
          {instrument.strings.map((st) => {
            const on = targetMidi === st.midi;
            const near = !on && targetMidi === null && r?.midi === st.midi;
            const o = noteName(st.midi).octave;
            return (
              <button
                key={st.midi}
                className={on ? "tuner-string on" : near ? "tuner-string near" : "tuner-string"}
                onClick={() => setTargetMidi(on ? null : st.midi)}
                aria-pressed={on}
                title={on ? "Tuning to this string. Click to go back to any note." : "Tune to this string"}
              >
                {st.label}
                <sub>{o}</sub>
              </button>
            );
          })}
        </div>
      )}

      <div className="tuner-level" title="How loud the input is">
        <span style={{ width: `${Math.round(live.level * 100)}%` }} />
      </div>
      <p className={inTune ? "fx-hint ok" : "fx-hint"}>{hint}</p>
    </div>
  );
}
