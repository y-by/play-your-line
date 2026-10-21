export interface InputDevice {
  deviceId: string;
  label: string;
}

export const DEFAULT_DEVICE_ID = "default";

/**
 * Constraints for capturing an instrument/vocal signal, not a voice call.
 * Browsers turn echo cancellation, noise suppression and auto-gain control
 * ON by default — all three are speech-call processing that actively damage
 * music: AGC rides the gain and squashes dynamics, noise suppression is a
 * spectral gate that eats transients and low-level detail, and echo
 * cancellation filters frequency content assuming it's fighting speaker
 * bleed. They're disabled here explicitly rather than left to the browser's
 * default, which is what makes web-recorded instruments sound "processed."
 */
export function buildAudioConstraints(deviceId?: string | null, channelIndex?: number | null): MediaTrackConstraints {
  const constraints: MediaTrackConstraints = {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    // No sampleRate here on purpose: asking for 48 kHz made Chrome convert from the device's own
    // rate (e.g. a 44.1 kHz-only audio interface) and then again into the audio context's rate,
    // which left clicks in the recording. The microphone's native rate is used instead.
  };
  if (deviceId && deviceId !== DEFAULT_DEVICE_ID) constraints.deviceId = { exact: deviceId };
  if (channelIndex != null) constraints.channelCount = { ideal: Math.max(2, channelIndex + 1) };
  return constraints;
}

/**
 * Chrome's synthetic "default" device id asks it to pick the system default
 * itself — but that pick can be stale (bound to whatever was default when
 * the page first got permission, not what's default now, e.g. after
 * switching inputs in System Settings). Whenever a concrete device is known
 * — the same one "default" is labelled after — resolving to its real id
 * sidesteps that alias entirely instead of trusting it to stay current.
 */
export async function resolveInputDeviceId(deviceId?: string | null): Promise<string | null> {
  if (deviceId && deviceId !== DEFAULT_DEVICE_ID) return deviceId;
  try {
    const devices = await listInputDevices();
    // The device the "default" entry is named after; only when that cannot be told, the first real one.
    const concrete = defaultDeviceFor(devices) ?? devices.find((d) => d.deviceId !== DEFAULT_DEVICE_ID && d.deviceId !== "communications");
    return concrete?.deviceId ?? deviceId ?? null;
  } catch {
    return deviceId ?? null;
  }
}

export async function listInputDevices(): Promise<InputDevice[]> {
  let devices = await navigator.mediaDevices.enumerateDevices();
  let inputs = devices.filter((d) => d.kind === "audioinput");

  // Labels are blank until permission has been granted at least once.
  if (inputs.length === 0 || inputs.every((d) => !d.label)) {
    try {
      const tempStream = await navigator.mediaDevices.getUserMedia({ audio: buildAudioConstraints() });
      tempStream.getTracks().forEach((t) => t.stop());
      devices = await navigator.mediaDevices.enumerateDevices();
      inputs = devices.filter((d) => d.kind === "audioinput");
    } catch {
      // Permission denied — return whatever (likely empty) list we have.
    }
  }

  return inputs.map((d, i) => ({
    deviceId: d.deviceId || DEFAULT_DEVICE_ID,
    label: d.label || `Microphone ${i + 1}`,
  }));
}

// Opens the device briefly to find out how many input channels it exposes
// (e.g. an audio interface with several line/mic inputs), then releases it.
export async function probeChannelCount(deviceId: string): Promise<number> {
  const constraints = buildAudioConstraints(deviceId);
  constraints.channelCount = { ideal: 8 };
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: constraints });
    const track = stream.getAudioTracks()[0];
    const settings = track.getSettings();
    const capabilities = track.getCapabilities?.();
    const count = settings.channelCount ?? capabilities?.channelCount?.max ?? 1;
    stream.getTracks().forEach((t) => t.stop());
    return count || 1;
  } catch {
    return 1;
  }
}

// ---- Remembering the chosen devices ---------------------------------------------------------------------

/** What the person chose last: the id, and the name (an id can change; the name is what they know). */
export interface SavedDevice {
  id: string;
  label: string;
}

const savedKey = (kind: "input" | "output") => `pyl.device.${kind}`;

export function readSavedDevice(kind: "input" | "output"): SavedDevice | null {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(savedKey(kind)) ?? "null");
    if (parsed && typeof parsed === "object" && typeof (parsed as SavedDevice).id === "string") {
      return { id: (parsed as SavedDevice).id, label: String((parsed as SavedDevice).label ?? "") };
    }
  } catch {
    // storage unavailable or unreadable: nothing is remembered
  }
  return null;
}

export function saveDevice(kind: "input" | "output", device: SavedDevice): void {
  try {
    localStorage.setItem(savedKey(kind), JSON.stringify(device));
  } catch {
    // storage unavailable: the choice just won't be remembered
  }
}

/** "Default - Audient EVO4" -> "Audient EVO4". */
const plainName = (label: string) => label.replace(/^(default|communications)\s*-\s*/i, "").trim();
const isAlias = (id: string) => id === DEFAULT_DEVICE_ID || id === "communications";

/**
 * The real device the browser's "default" entry stands for. Chrome lists "Default - <name>" next to the device called
 * <name>; using that device's own id sidesteps the "default" alias, which can stay stuck on a device that is not the
 * system's default any more (or does not work).
 */
export function defaultDeviceFor(list: InputDevice[]): InputDevice | null {
  const alias = list.find((d) => d.deviceId === DEFAULT_DEVICE_ID);
  if (!alias) return null;
  const name = plainName(alias.label);
  return list.find((d) => !isAlias(d.deviceId) && plainName(d.label) === name) ?? null;
}

/**
 * Which device to use: the one the person chose last time if it is connected (found by id, else by name); if it is
 * not, or they chose "default", or never chose, the system's default device as a real device.
 */
export function chooseDevice(list: InputDevice[], saved: SavedDevice | null): string {
  if (saved && saved.id !== DEFAULT_DEVICE_ID) {
    const byId = list.find((d) => d.deviceId === saved.id);
    if (byId) return byId.deviceId;
    const name = plainName(saved.label);
    const byName = name ? list.find((d) => !isAlias(d.deviceId) && plainName(d.label) === name) : undefined;
    if (byName) return byName.deviceId;
  }
  return defaultDeviceFor(list)?.deviceId ?? list.find((d) => d.deviceId === DEFAULT_DEVICE_ID)?.deviceId ?? list[0]?.deviceId ?? DEFAULT_DEVICE_ID;
}
