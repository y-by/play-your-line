// The setup check for recording another app (a DAW or a synth) through a virtual audio cable.
// Pure rules about device names, so they are testable. Device names only show once the browser has allowed the microphone.

const CABLE = /blackhole|vb-?audio|vb-?cable|cable (input|output)|loopback|voicemeeter|soundflower|virtual cable/i;
// An output that feeds a cable: the song would be recorded along with the other app.
const FEEDS_CABLE = /blackhole|vb-?audio|vb-?cable|cable (input|output)|loopback|voicemeeter|soundflower|virtual cable|multi-output|aggregate/i;

export const looksLikeCable = (label: string) => CABLE.test(label);
export const outputFeedsCable = (label: string) => FEEDS_CABLE.test(label);

export type StepState = "ok" | "todo" | "warn" | "info";
export interface CheckStep {
  id: "cable" | "input" | "output" | "signal";
  state: StepState;
  text: string;
  /** A button that fixes the step: the device to choose as the input. */
  useInput?: { deviceId: string; label: string };
}

export interface Device {
  deviceId: string;
  label: string;
}

/** The first three steps, from what is connected and chosen now. The fourth (sound arriving) is live and added by the screen. */
export function cableSteps(opts: { inputs: Device[]; inputId: string; outputs: Device[]; outputId: string; outputRoutable: boolean }): CheckStep[] {
  const cables = opts.inputs.filter((d) => looksLikeCable(d.label));
  const chosenInput = opts.inputs.find((d) => d.deviceId === opts.inputId);
  const inputIsCable = !!chosenInput && looksLikeCable(chosenInput.label);
  const steps: CheckStep[] = [];

  if (cables.length === 0) {
    steps.push({ id: "cable", state: "todo", text: "No virtual cable found. Install BlackHole 2ch (Mac) or VB-Cable (Windows), then come back here." });
    return steps;
  }
  steps.push({ id: "cable", state: "ok", text: `Cable found: ${cables[0].label}.` });

  if (inputIsCable) steps.push({ id: "input", state: "ok", text: `Input is ${chosenInput!.label}.` });
  else steps.push({ id: "input", state: "todo", text: "The input is not the cable yet.", useInput: { deviceId: cables[0].deviceId, label: cables[0].label } });

  if (opts.outputRoutable) {
    const out = opts.outputs.find((d) => d.deviceId === opts.outputId);
    if (out && outputFeedsCable(out.label)) {
      steps.push({ id: "output", state: "warn", text: `Output is ${out.label}: the song would be recorded too. Choose your headphones or speakers.` });
    } else {
      steps.push({ id: "output", state: "ok", text: `Output is ${out ? out.label : "your computer's sound"}, not the cable.` });
    }
  } else {
    steps.push({ id: "output", state: "info", text: "This browser cannot show the output. Make sure your computer's sound output is not the cable." });
  }
  return steps;
}

export type GuideKey = "nocable" | "notinput" | "echo" | "quiet" | "works";

/** Which single screen the guide shows: the first thing that is not right yet, or whether sound is arriving. `step` is 1 to 4 (5 = done). */
export function guideState(steps: CheckStep[], hearing: boolean): { key: GuideKey; step: number } {
  const by = (id: CheckStep["id"]) => steps.find((x) => x.id === id);
  if (by("cable")?.state === "todo") return { key: "nocable", step: 1 };
  if (by("input")?.state === "todo") return { key: "notinput", step: 2 };
  if (by("output")?.state === "warn") return { key: "echo", step: 3 };
  return hearing ? { key: "works", step: 5 } : { key: "quiet", step: 4 };
}

export type OsKind = "mac" | "win" | "other";
export function osOf(userAgent: string): OsKind {
  if (/Macintosh|Mac OS X/i.test(userAgent)) return "mac";
  if (/Windows/i.test(userAgent)) return "win";
  return "other";
}

/** The official places to get a virtual cable (BlackHole for Mac, VB-Cable for Windows). */
export const CABLE_INSTALL = {
  mac: { command: "brew install --cask blackhole-2ch", url: "https://existential.audio/blackhole/", name: "BlackHole 2ch" },
  win: { command: null, url: "https://vb-audio.com/Cable/", name: "VB-Cable" },
} as const;

/** The first output that would not feed the cable, to offer as the replacement. */
export function safeOutput(outputs: Device[]): Device | null {
  return outputs.find((d) => !outputFeedsCable(d.label)) ?? null;
}
