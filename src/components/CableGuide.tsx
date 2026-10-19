import { useEffect, useRef, useState } from "react";
import { useProjectStore } from "../store/useProjectStore";
import { cableSteps, guideState, osOf, safeOutput, CABLE_INSTALL, type GuideKey } from "../lib/cableCheck";
import { InputLevelMeter } from "./InputLevelMeter";
import { RouteDiagram } from "./RouteDiagram";

const HEARD_LEVEL = 0.03; // of the meter's scaled range
const HEARD_FOR_MS = 6000;
const STUCK_AFTER_MS = 12000;

type System = "mac" | "win";
const HOW: Record<System, { title: string; text: string }[]> = {
  mac: [
    { title: "Install the cable", text: "BlackHole 2ch, free. Restart the Mac when the installer says so." },
    { title: "Make a Multi-Output Device", text: "Open Audio MIDI Setup, press + at the bottom left and choose Create Multi-Output Device. Tick your headphones (or interface) and BlackHole 2ch. Turn Drift Correction on for BlackHole only, and give everything the same sample rate." },
    { title: "Set your DAW's output", text: "Choose Multi-Output Device in the DAW's audio settings. You hear the DAW, and the cable gets it too." },
    { title: "Set Play Your Line", text: "Input = BlackHole 2ch, Output = your real headphones, never the Multi-Output Device." },
  ],
  win: [
    { title: "Install the cable", text: "VB-Audio Virtual Cable, free. Restart the PC." },
    { title: "Set your DAW's output", text: "Choose CABLE Input in the DAW's audio settings." },
    { title: "Hear it too", text: "Sound settings, More sound settings, Recording, double-click CABLE Output, Listen, tick Listen to this device and pick your headphones." },
    { title: "Set Play Your Line", text: "Input = CABLE Output, Output = your real headphones, never the cable." },
  ],
};

/**
 * Settings > Audio: a guide for recording another app (a DAW, a synth) through a virtual cable. It watches the setup and
 * shows only the next thing to do, with a button for the parts the app can do itself, and turns green when sound arrives.
 * It reads only what the browser shows; the DAW and the system sound settings it can only describe.
 */
export function CableGuide() {
  const inputs = useProjectStore((s) => s.availableInputs);
  const inputId = useProjectStore((s) => s.inputDeviceId);
  const outputs = useProjectStore((s) => s.availableOutputs);
  const outputId = useProjectStore((s) => s.outputDeviceId);
  const outputRoutable = useProjectStore((s) => s.masterOutputRoutingSupported);
  const setInputDevice = useProjectStore((s) => s.setInputDevice);
  const setOutputDevice = useProjectStore((s) => s.setOutputDevice);
  const watch = useProjectStore((s) => s.watchInputLevel);
  const [open, setOpen] = useState(false);
  const [heardAt, setHeardAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [openedAt, setOpenedAt] = useState(0);
  const [copied, setCopied] = useState(false);
  const os = osOf(typeof navigator === "undefined" ? "" : navigator.userAgent);
  const [system, setSystem] = useState<System>(os === "win" ? "win" : "mac");
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open !== wasOpen.current) {
      wasOpen.current = open;
      watch(open);
    }
    return () => {
      if (wasOpen.current) watch(false);
    };
  }, [open, watch]);

  // The input level is read as it changes (an outside source), and a clock decides when "sound arriving" has gone quiet.
  useEffect(() => {
    if (!open) return;
    const stop = useProjectStore.subscribe((state) => {
      if (state.inputLevel * 3.5 > HEARD_LEVEL) setHeardAt(Date.now());
    });
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      stop();
      clearInterval(t);
    };
  }, [open]);

  const steps = cableSteps({ inputs, inputId, outputs, outputId, outputRoutable });
  const hearing = heardAt > 0 && now - heardAt < HEARD_FOR_MS;
  const { key, step } = guideState(steps, hearing);
  const inputStep = steps.find((s) => s.id === "input");
  const alt = safeOutput(outputs);
  const stuck = key === "quiet" && openedAt > 0 && now - openedAt > STUCK_AFTER_MS;
  const install = os === "win" ? CABLE_INSTALL.win : CABLE_INSTALL.mac;

  const copy = (text: string) => {
    try {
      void navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      });
    } catch {
      // the command stays visible to select by hand
    }
  };

  const CARD: Record<GuideKey, { cls: string; title: string; text: string }> = {
    nocable: { cls: "todo", title: "Step 1 of 4: install a virtual cable", text: "No cable found on this computer. A cable carries another app's sound into Play Your Line. It is free and takes about five minutes. Restart your computer when it is installed, then come back here." },
    notinput: { cls: "info", title: "Step 2 of 4: use the cable as your input", text: "The cable is installed, but Play Your Line is still listening to a different input." },
    echo: { cls: "warn", title: "Step 3 of 4: change the output", text: "Your output feeds the cable, so the song would be recorded together with your DAW. Choose your real headphones or speakers." },
    quiet: { cls: "info", title: "Step 4 of 4: play something in your DAW", text: "Everything is set. Waiting for sound from the cable…" },
    works: { cls: "ok", title: "All set. Sound is arriving.", text: "Arm a channel and record. The sound is recorded as one (mono) channel." },
  };
  const card = CARD[key];

  return (
    <details
      className="cable-guide"
      onToggle={(e) => {
        const isOpen = (e.currentTarget as HTMLDetailsElement).open;
        setOpen(isOpen);
        if (isOpen) setOpenedAt(Date.now());
      }}
    >
      <summary>Record another app (DAW or synth)</summary>
      <div className="cable-dots" aria-label={`Step ${Math.min(step, 4)} of 4`}>
        {[1, 2, 3, 4].map((n) => (
          <i key={n} className={n < step ? "ok" : n === step ? "on" : ""} />
        ))}
      </div>
      <div className={`cable-card ${card.cls}`} aria-live="polite">
        <h4>{card.title}</h4>
        <p>{card.text}</p>
        {key === "nocable" && (
          <div className="cable-actions">
            {install.command && (
              <button className="settings-toggle active" onClick={() => copy(install.command!)}>
                {copied ? "Copied" : "Copy install command"}
              </button>
            )}
            <a className="settings-toggle" href={install.url} target="_blank" rel="noreferrer">
              {install.command ? "Open the download page" : `Get ${install.name}`}
            </a>
          </div>
        )}
        {key === "nocable" && install.command && <p className="cable-cmd">Paste it in the Terminal app: <code>{install.command}</code></p>}
        {key === "notinput" && inputStep?.useInput && (
          <div className="cable-actions">
            <button className="settings-toggle active" onClick={() => void setInputDevice(inputStep.useInput!.deviceId)}>
              Use {inputStep.useInput.label}
            </button>
          </div>
        )}
        {key === "echo" && alt && (
          <div className="cable-actions">
            <button className="settings-toggle active" onClick={() => void setOutputDevice(alt.deviceId)}>
              Choose {alt.label}
            </button>
          </div>
        )}
        {(key === "quiet" || key === "works") && <InputLevelMeter />}
        {stuck && (
          <p className="cable-stuck">
            Still nothing? Check that your DAW is playing and that its output is {os === "win" ? "CABLE Input" : "the Multi-Output Device"}.
          </p>
        )}
      </div>
      {steps.find((s) => s.id === "output")?.state === "info" && <p className="settings-note">{steps.find((s) => s.id === "output")!.text}</p>}
      <details className="cable-how">
        <summary>Show me how, with pictures</summary>
        <RouteDiagram />
        <div className="cable-seg" role="group" aria-label="Computer">
          <button className={system === "mac" ? "on" : ""} aria-pressed={system === "mac"} onClick={() => setSystem("mac")}>Mac</button>
          <button className={system === "win" ? "on" : ""} aria-pressed={system === "win"} onClick={() => setSystem("win")}>Windows</button>
        </div>
        <ol className="cable-how-steps">
          {HOW[system].map((h) => (
            <li key={h.title}>
              <b>{h.title}.</b> {h.text}
            </li>
          ))}
        </ol>
        {system === "mac" && (
          <figure className="help-figure">
            <img src="/help/shot-mac-multi-output.png" alt="Audio MIDI Setup: a Multi-Output Device with the interface and BlackHole 2ch ticked, Drift Correction on for BlackHole" loading="lazy" />
            <figcaption>Audio MIDI Setup: the Multi-Output Device. Interface and BlackHole 2ch ticked, Drift Correction on for BlackHole only.</figcaption>
          </figure>
        )}
        <p className="settings-note">
          Have an interface with a loopback (Audient EVO, Focusrite Scarlett)? Its loopback inputs can replace the cable: pick them on the channel's Input button, and keep Play Your Line's output off that interface.{" "}
          <a href="/help#record-other-app" target="_blank" rel="noreferrer">More in Help</a>
        </p>
      </details>
    </details>
  );
}
