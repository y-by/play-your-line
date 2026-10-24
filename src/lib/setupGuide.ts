// The "Set up your sound" guide: the words, and the small rules behind it (is the level good, does the test take sound
// right, when to offer the guide again). Pure, so it is tested with plain numbers. The screen is components/SetupGuide.tsx.
//
// PICTURES AND VIDEO: every step has a `media` list that is empty today. To add a picture or a short video, put the file in
// public/help/setup/ and add { kind: "image" | "video", src: "/help/setup/<file>", alt: "what it shows" } to that step's
// `media` below. The guide shows it under the step's text; nothing else needs to change. docs/SETUP-GUIDE-MEDIA.md lists
// what each step would like.

import type { OsKind } from "./cableCheck";

export type SetupState = "new" | "done" | "later" | "never";
export interface SetupMemory {
  state: SetupState;
  /** When "later" was chosen (ms), so the guide can be offered again a few days on. */
  at: number;
}

const KEY = "pyl.setup.v1";
const OFFER_AGAIN_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

export function readSetupMemory(): SetupMemory {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (parsed && typeof parsed === "object") {
      const { state, at } = parsed as Partial<SetupMemory>;
      if (state === "done" || state === "later" || state === "never") return { state, at: typeof at === "number" ? at : 0 };
    }
  } catch {
    // storage unavailable or unreadable: the guide is simply offered
  }
  return { state: "new", at: 0 };
}

export function writeSetupMemory(state: SetupState, now = Date.now()): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ state, at: now }));
  } catch {
    // storage unavailable: the guide may be offered again, that is all
  }
}

/** Whether to offer the guide now: never done yet, or put off ("later") for more than three days. */
export function shouldOfferSetup(memory: SetupMemory, now = Date.now()): boolean {
  if (memory.state === "new") return true;
  if (memory.state === "later") return now - memory.at > OFFER_AGAIN_AFTER_MS;
  return false;
}

// ---- The level ------------------------------------------------------------------------------------------------------------

/** A peak (0 to 1, 1 = full scale) in decibels below full scale. Silence is -Infinity, shown as null. */
export function peakToDb(peak: number): number | null {
  return peak > 0 ? 20 * Math.log10(peak) : null;
}

export type LevelKind = "none" | "quiet" | "low" | "good" | "hot" | "clip";
export interface LevelAdvice {
  kind: LevelKind;
  title: string;
  text: string;
}

/**
 * What to tell a person whose loudest moment so far reached `peakDb` (dB below full scale, null = nothing heard).
 * A good recording level peaks between about -18 and -3 dB: plenty of signal, room to spare before it distorts.
 */
export function levelAdvice(peakDb: number | null): LevelAdvice {
  if (peakDb === null || peakDb < -60) {
    return {
      kind: "none",
      title: "I hear nothing yet",
      text: "Make some sound, as loud as you will play. If the bar still does not move: check that the right input is chosen above, that your microphone or instrument is plugged in and not muted, and that your browser allows the microphone.",
    };
  }
  if (peakDb < -30) return { kind: "quiet", title: "Too quiet", text: "The signal is very weak. Turn up the gain knob on your interface or microphone, or move the microphone closer. Do not fix it with the computer's volume." };
  if (peakDb < -18) return { kind: "low", title: "A little quiet", text: "Almost there. Turn the gain up a little, or play closer to the microphone, until the bar gets about two thirds across." };
  if (peakDb <= -3) return { kind: "good", title: "Good level", text: "This is a good level: strong, with room to spare. Keep it like this." };
  if (peakDb <= -0.5) return { kind: "hot", title: "Close to the top", text: "That is loud. Turn the gain down a little so your loudest notes stay in the yellow, never the red." };
  return { kind: "clip", title: "Too loud: it distorts", text: "The signal hit the top, and a recording that hit the top is damaged for good. Turn the gain down, or move the microphone further away, then play your loudest part again." };
}

// ---- The test recording ---------------------------------------------------------------------------------------------------

export interface TakeJudgement {
  ok: boolean;
  title: string;
  text: string;
}

/** What the five-second test recording measured: its loudest point and its average level, both in dB below full scale. */
export function judgeTestTake(m: { peakDb: number | null; rmsDb: number | null }): TakeJudgement {
  if (m.peakDb === null || m.peakDb < -60) {
    return {
      ok: false,
      title: "Nothing was recorded",
      text: "The test recording is silent. Go back one step: pick the right input, make sure the instrument or microphone is on and plugged in, and that the level bar moves when you play.",
    };
  }
  if (m.peakDb >= -0.5) {
    return { ok: false, title: "Too loud", text: "The test recording hit the top and is distorted. Go back to the level step and turn the gain down." };
  }
  if (m.peakDb < -30) {
    return { ok: false, title: "Too quiet", text: "The test recording is very quiet. Go back to the level step and turn the gain up, or play closer." };
  }
  return { ok: true, title: "That recorded well", text: "There is a healthy signal. Press play and listen: it should sound like you, clean, with no crackle." };
}

// ---- Sample rates ---------------------------------------------------------------------------------------------------------

/**
 * What to do when the microphone and the browser's audio run at different rates (for example 48000 and 44100 Hz).
 * The browser then converts between them, which can leave clicks or crackle in a take. Returns numbered steps for the
 * person's system, or null when the rates match.
 */
export function rateAdvice(os: OsKind, mismatch: { inputHz: number; contextHz: number } | null): { title: string; steps: string[] } | null {
  if (!mismatch) return null;
  const { inputHz, contextHz } = mismatch;
  const title = `Your microphone runs at ${inputHz} Hz and the browser at ${contextHz} Hz. The browser has to convert between them, which can cause clicks and crackle.`;
  if (os === "mac") {
    return {
      title,
      steps: [
        "Open Audio MIDI Setup (press Cmd+Space, type Audio MIDI Setup, press Enter).",
        `Click your microphone or interface in the list on the left. Next to Format, choose ${contextHz} Hz.`,
        `Click your headphones or speakers in the list and give them the same: ${contextHz} Hz.`,
        "Close it, reload this page, and make the test recording again.",
      ],
    };
  }
  if (os === "win") {
    return {
      title,
      steps: [
        "Right-click the speaker icon next to the clock, choose Sound settings, then More sound settings.",
        `On the Recording tab double-click your microphone, open Advanced, and set Default Format to ${contextHz} Hz. Untick "Allow applications to take exclusive control".`,
        "On the Playback tab do the same for your headphones or speakers, with the same Hz.",
        "Reload this page and make the test recording again.",
      ],
    };
  }
  return {
    title,
    steps: [`In your computer's sound settings give your microphone and your headphones or speakers the same sample rate: ${contextHz} Hz.`, "Reload this page and make the test recording again."],
  };
}

/** Other things that cause clicks or crackle, for when the rates match but the take still sounds bad. */
export const CRACKLE_CAUSES: string[] = [
  "Bluetooth headphones or a Bluetooth microphone: use wired ones. Bluetooth adds delay and lowers the quality.",
  "A USB hub or a long cable: plug the interface straight into the computer.",
  "Too much running at once: close other tabs and heavy apps, and try the test again.",
  "A different browser: Chrome is the one this app is tested with.",
];

// ---- The steps ------------------------------------------------------------------------------------------------------------

export interface SetupMedia {
  kind: "image" | "video";
  src: string;
  alt: string;
}

export type SetupStepId = "welcome" | "mic" | "level" | "output" | "test" | "done";

export interface SetupStep {
  id: SetupStepId;
  /** The short name on the progress dots. */
  label: string;
  title: string;
  /** What to do, in order. */
  do: string[];
  /** What the person should see when it is working. */
  expect: string;
  /** If it is not working. */
  ifNot: string[];
  media: SetupMedia[];
}

export const SETUP_STEPS: SetupStep[] = [
  {
    id: "welcome",
    label: "Start",
    title: "Let's get your sound working",
    do: [
      "This takes about two minutes, and you only do it once on each computer.",
      "You will allow your microphone, set your level, choose where you hear things, and make a five-second test recording.",
      "Use headphones if you can. Without them the microphone hears the speakers and you get an echo.",
      "Record on a computer, in Chrome. A phone is fine for listening and reading notes.",
    ],
    expect: "When you finish, you will know your microphone works, your level is right, and a recording sounds clean.",
    ifNot: ["You can stop at any step and come back later from Settings, in the Input section."],
    media: [],
  },
  {
    id: "mic",
    label: "Microphone",
    title: "Choose your microphone",
    do: [
      "Press Allow microphone. Your browser asks for permission: choose Allow.",
      "Pick your microphone from the list. If you use an audio interface (for example an Audient or an Avid Mbox), pick it by its name.",
      "If your interface has several inputs, pick the one your instrument or microphone is plugged into. Ch 1 is the first socket.",
    ],
    expect: "Your microphone's name is in the list, and the level bar moves when you make a sound.",
    ifNot: [
      "No list or no name: your browser has not allowed the microphone. Click the small lock next to the page address, set Microphone to Allow, and reload.",
      "Your interface is missing: unplug it, plug it back in, and press Refresh the list.",
      "It is there but silent: check it is switched on, not muted, and chosen as an input in your computer's sound settings.",
    ],
    media: [],
  },
  {
    id: "level",
    label: "Level",
    title: "Set your level",
    do: [
      "Play or sing as loud as you will in the song, for a few seconds.",
      "Watch the bar. You want your loudest notes to get about two thirds of the way across, and never into the red.",
      "Change the level on your interface or microphone (the gain knob), not with the computer's volume.",
    ],
    expect: "The message below the bar says Good level.",
    ifNot: [
      "On a laptop with no interface, move closer to the microphone or sing a little louder instead.",
      "A bar that never moves usually means the wrong input is chosen. Go back one step.",
    ],
    media: [],
  },
  {
    id: "output",
    label: "Headphones",
    title: "Choose where you hear",
    do: [
      "Choose your headphones in the Output list.",
      "Wired headphones are best. Bluetooth headphones add a delay of a quarter of a second or more, which is too much for recording.",
      "If there is no Output list, your browser uses the computer's main output. Change it in your computer's sound settings.",
    ],
    expect: "You hear a click when you press Play a click.",
    ifNot: ["No sound: check the volume on the headphones and on the computer, and that the right output is chosen."],
    media: [],
  },
  {
    id: "test",
    label: "Test",
    title: "Make a test recording",
    do: [
      "Press Record. It records for five seconds: play or sing something you would normally record.",
      "Then press play on the little player and listen, with your headphones on.",
      "Answer honestly: does it sound clean?",
    ],
    expect: "It sounds like you: clear, at a comfortable volume, with no crackle or clicks.",
    ifNot: ["Choose what you hear below and follow the fix. Then record the test again."],
    media: [],
  },
  {
    id: "done",
    label: "Done",
    title: "You are ready",
    do: [
      "Your microphone, level and headphones are set, and they are remembered on this computer.",
      "To record: arm a channel with the red dot on its strip, press Record, and play.",
      "To record another app (a DAW or a synth) through a virtual cable, open Settings, Input, and use the cable guide.",
    ],
    expect: "Your first take sounds as good as the test did.",
    ifNot: ["Anything strange? Settings has Send feedback. Tell the owner what happened and attach a screenshot."],
    media: [],
  },
];
