import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useProjectStore } from "../store/useProjectStore";
import { useSetupStore } from "../store/useSetupStore";
import { AudioEngine } from "../lib/audioEngine";
import { DEFAULT_DEVICE_ID, defaultDeviceFor, resolveInputDeviceId } from "../lib/inputDevices";
import { osOf } from "../lib/cableCheck";
import { errorMessage } from "../lib/errorMessage";
import {
  CRACKLE_CAUSES,
  SETUP_STEPS,
  judgeTestTake,
  levelAdvice,
  peakToDb,
  rateAdvice,
  readSetupMemory,
  writeSetupMemory,
  type SetupStep,
  type TakeJudgement,
} from "../lib/setupGuide";
import { InputSourceSelector } from "./InputSourceSelector";
import { InputLevelMeter } from "./InputLevelMeter";

const TEST_SECONDS = 5;

interface TestResult {
  url: string;
  judgement: TakeJudgement;
  mismatch: { inputHz: number; contextHz: number } | null;
}

type Heard = "clean" | "crackle" | "level" | "echo" | null;

const dbOf = (x: number) => (x > 0 ? 20 * Math.log10(x) : null);

/** The text of a step: what to do, what you should see, what to try if it does not work, and its pictures or video when there are any. */
function StepText({ step }: { step: SetupStep }) {
  return (
    <>
      <ol className="sg-do">
        {step.do.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ol>
      {step.media.map((m) =>
        m.kind === "video" ? (
          <video key={m.src} className="sg-media" src={m.src} controls muted playsInline aria-label={m.alt} />
        ) : (
          <img key={m.src} className="sg-media" src={m.src} alt={m.alt} loading="lazy" />
        )
      )}
      <p className="sg-expect">
        <b>What you should see.</b> {step.expect}
      </p>
      {step.ifNot.length > 0 && (
        <details className="sg-ifnot">
          <summary>If it does not work</summary>
          <ul>
            {step.ifNot.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

/**
 * "Set up your sound": a five-step guide (welcome, microphone, level, headphones, test recording) shown the first time a
 * person who can record opens a project, and any time from Settings > Input. It uses the app's own input and output
 * choices, and makes its test recording with a separate audio engine, so no project is touched.
 */
export function SetupGuide() {
  const open = useSetupStore((s) => s.open);
  const closeGuide = useSetupStore((s) => s.closeGuide);
  const outputs = useProjectStore((s) => s.availableOutputs);
  const outputId = useProjectStore((s) => s.outputDeviceId);
  const outputRoutable = useProjectStore((s) => s.masterOutputRoutingSupported);
  const inputs = useProjectStore((s) => s.availableInputs);
  const inputId = useProjectStore((s) => s.inputDeviceId);
  const inputChannel = useProjectStore((s) => s.inputChannelIndex);
  const setOutputDevice = useProjectStore((s) => s.setOutputDevice);
  const refreshInputDevices = useProjectStore((s) => s.refreshInputDevices);
  const refreshOutputDevices = useProjectStore((s) => s.refreshOutputDevices);
  const watch = useProjectStore((s) => s.watchInputLevel);
  const testClick = useProjectStore((s) => s.testMetronomeClick);

  const [index, setIndex] = useState(0);
  const [heldPeak, setHeldPeak] = useState(0);
  const [phase, setPhase] = useState<"idle" | "recording" | "working">("idle");
  const [secondsLeft, setSecondsLeft] = useState(TEST_SECONDS);
  const [test, setTest] = useState<TestResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [heard, setHeard] = useState<Heard>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const step = SETUP_STEPS[index];
  const os = osOf(typeof navigator === "undefined" ? "" : navigator.userAgent);

  // The loudest the input has been since the level step opened (read as it changes, from outside React).
  useEffect(() => {
    if (!open) return;
    return useProjectStore.subscribe((state) => {
      setHeldPeak((held) => Math.max(held, state.inputPeak));
    });
  }, [open]);

  // The level meter runs on the microphone and level steps only (and not while the test records on its own).
  useEffect(() => {
    if (!open) return;
    const wantsMeter = (step.id === "mic" || step.id === "level" || step.id === "test") && phase === "idle";
    watch(wantsMeter);
    return () => watch(false);
  }, [open, step.id, phase, watch]);

  useEffect(() => {
    if (open) void refreshOutputDevices();
  }, [open, refreshOutputDevices]);

  // The test take plays through the chosen output (Chrome and Edge can pick one).
  const sinkId = outputId === DEFAULT_DEVICE_ID ? (defaultDeviceFor(outputs)?.deviceId ?? outputId) : outputId;
  useEffect(() => {
    const el = audioRef.current as (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (el?.setSinkId && sinkId && sinkId !== DEFAULT_DEVICE_ID) el.setSinkId(sinkId).catch(() => undefined);
  }, [test, sinkId]);

  useEffect(() => {
    return () => {
      if (test) URL.revokeObjectURL(test.url);
    };
  }, [test]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") leave();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const advice = useMemo(() => levelAdvice(peakToDb(heldPeak)), [heldPeak]);

  if (!open) return null;

  function leave() {
    if (readSetupMemory().state === "new") writeSetupMemory("later");
    closeGuide();
    setIndex(0);
    setHeldPeak(0);
    setTest(null);
    setHeard(null);
    setTestError(null);
  }

  const go = (to: number) => {
    const next = Math.max(0, Math.min(SETUP_STEPS.length - 1, to));
    if (SETUP_STEPS[next].id === "level") setHeldPeak(0);
    if (SETUP_STEPS[next].id === "done") writeSetupMemory("done");
    setIndex(next);
  };

  const recordTest = async () => {
    if (phase !== "idle") return;
    setTestError(null);
    setHeard(null);
    setTest(null);
    setPhase("recording");
    setSecondsLeft(TEST_SECONDS);
    const tick = window.setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    const engine = new AudioEngine();
    try {
      await engine.resume();
      await engine.startRecording(await resolveInputDeviceId(inputId), inputChannel);
      const mismatch = engine.getCaptureRateMismatch();
      await new Promise((r) => setTimeout(r, TEST_SECONDS * 1000));
      setPhase("working");
      const result = await engine.stopRecording();
      if (result.blob.size === 0) throw new Error("Nothing was recorded. Check that the microphone is allowed and chosen, then try again.");
      const ctx = new AudioContext();
      const decoded = await ctx.decodeAudioData(await result.blob.arrayBuffer());
      await ctx.close();
      let peak = 0;
      let sumSquares = 0;
      let count = 0;
      for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
        const data = decoded.getChannelData(ch);
        for (let i = 0; i < data.length; i++) {
          const v = Math.abs(data[i]);
          if (v > peak) peak = v;
          sumSquares += v * v;
        }
        count += data.length;
      }
      const judgement = judgeTestTake({ peakDb: dbOf(peak), rmsDb: dbOf(Math.sqrt(sumSquares / Math.max(1, count))) });
      setTest({ url: URL.createObjectURL(result.blob), judgement, mismatch });
    } catch (err) {
      console.error("The test recording failed:", err);
      setTestError(errorMessage(err, "The test recording did not work. Check that the browser allows the microphone."));
    } finally {
      window.clearInterval(tick);
      engine.destroy();
      setPhase("idle");
    }
  };

  const outputName = outputs.find((d) => d.deviceId === outputId)?.label ?? "your computer's output";
  const inputName = inputs.find((d) => d.deviceId === inputId)?.label ?? "your computer's input";
  const canNext = step.id === "mic" ? inputs.length > 0 : step.id === "test" ? heard === "clean" : true;
  const fix = test && heard === "crackle" ? rateAdvice(os, test.mismatch) : null;

  return createPortal(
    <div className="zip-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) leave(); }}>
      <div className="zip-panel sg-panel" role="dialog" aria-label="Set up your sound">
        <div className="sg-top">
          <ol className="sg-dots" aria-label="Steps">
            {SETUP_STEPS.map((s, i) => (
              <li key={s.id} className={i === index ? "now" : i < index ? "past" : ""}>
                <button onClick={() => go(i)} aria-current={i === index ? "step" : undefined}>
                  {s.label}
                </button>
              </li>
            ))}
          </ol>
          <button className="sg-close" onClick={leave} aria-label="Close the guide">
            Close
          </button>
        </div>

        <h3>{step.title}</h3>
        <StepText step={step} />

        {step.id === "mic" && (
          <div className="sg-block">
            <InputSourceSelector />
            <button className="fb-attach" onClick={() => void refreshInputDevices()}>
              Allow microphone / refresh the list
            </button>
            {inputs.length === 0 && <p className="fb-warn">No microphone found yet. Press the button, and choose Allow when the browser asks.</p>}
          </div>
        )}

        {step.id === "level" && (
          <div className="sg-block">
            <div className="sg-meter">
              <InputLevelMeter />
            </div>
            <div className={`sg-advice ${advice.kind}`} role="status">
              <b>{advice.title}.</b> {advice.text}
            </div>
            <button className="fb-attach" onClick={() => setHeldPeak(0)}>
              Start the check again
            </button>
          </div>
        )}

        {step.id === "output" && (
          <div className="sg-block">
            {outputRoutable ? (
              <select className="settings-select" aria-label="Output" value={outputId} onChange={(e) => void setOutputDevice(e.target.value)}>
                {outputs.length === 0 && <option value={DEFAULT_DEVICE_ID}>System Default</option>}
                {outputs.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label}
                  </option>
                ))}
              </select>
            ) : (
              <p className="settings-note">This browser cannot choose an output. It plays through your computer's main output.</p>
            )}
            <button className="fb-attach" onClick={testClick}>
              Play a click
            </button>
          </div>
        )}

        {step.id === "test" && (
          <div className="sg-block">
            <button className="fb-send" onClick={() => void recordTest()} disabled={phase !== "idle"}>
              {phase === "recording" ? `Recording… ${secondsLeft}` : phase === "working" ? "Working…" : test ? "Record again" : "Record 5 seconds"}
            </button>
            {testError && <p className="fb-warn" role="alert">{testError}</p>}
            {test && (
              <>
                <div className={`sg-advice ${test.judgement.ok ? "good" : "quiet"}`} role="status">
                  <b>{test.judgement.title}.</b> {test.judgement.text}
                </div>
                <audio ref={audioRef} controls src={test.url} className="sg-audio" />
                <p className="sg-q">Listen to it. Does it sound clean?</p>
                <div className="sg-answers">
                  <button className={heard === "clean" ? "on" : ""} onClick={() => setHeard("clean")}>Yes, it sounds clean</button>
                  <button className={heard === "crackle" ? "on" : ""} onClick={() => setHeard("crackle")}>Clicks, crackle or noise</button>
                  <button className={heard === "level" ? "on" : ""} onClick={() => setHeard("level")}>Too quiet or too loud</button>
                  <button className={heard === "echo" ? "on" : ""} onClick={() => setHeard("echo")}>I hear an echo</button>
                </div>
                {heard === "level" && (
                  <p className="sg-advice quiet">
                    Go back to the level step and set it again. <button className="linkish" onClick={() => go(SETUP_STEPS.findIndex((s) => s.id === "level"))}>Go to the level step</button>
                  </p>
                )}
                {heard === "echo" && <p className="sg-advice quiet">The microphone is hearing your speakers. Put on wired headphones, choose them in the headphones step, and record the test again.</p>}
                {heard === "crackle" && (
                  <div className="sg-advice quiet">
                    {fix ? (
                      <>
                        <p>{fix.title}</p>
                        <ol>
                          {fix.steps.map((t) => (
                            <li key={t}>{t}</li>
                          ))}
                        </ol>
                      </>
                    ) : (
                      <p>Your microphone and the browser run at the same rate, so it is something else. Try these:</p>
                    )}
                    <ul>
                      {CRACKLE_CAUSES.map((t) => (
                        <li key={t}>{t}</li>
                      ))}
                    </ul>
                    <p>Still stuck? Close this guide, open Settings, press Send feedback, and say what you hear.</p>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {step.id === "done" && (
          <div className="sg-block">
            <p className="sg-summary">
              <b>Microphone:</b> {inputName}
              <br />
              <b>You hear through:</b> {outputName}
            </p>
          </div>
        )}

        <div className="fb-row sg-nav">
          {index > 0 && step.id !== "done" ? (
            <button className="zip-cancel" onClick={() => go(index - 1)}>
              Back
            </button>
          ) : (
            <span />
          )}
          {step.id === "done" ? (
            <button className="fb-send" onClick={leave}>
              Finish
            </button>
          ) : (
            <button className="fb-send" onClick={() => go(index + 1)} disabled={!canNext}>
              {step.id === "welcome" ? "Start" : "Next"}
            </button>
          )}
        </div>
        {step.id === "test" && !canNext && (
          <button className="linkish sg-skip" onClick={() => go(index + 1)}>
            Skip the test
          </button>
        )}
      </div>
    </div>,
    document.body
  );
}
