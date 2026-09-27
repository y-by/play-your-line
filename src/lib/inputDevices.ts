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
    sampleRate: { ideal: 48000 },
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
    const concrete = devices.find((d) => d.deviceId !== DEFAULT_DEVICE_ID && d.deviceId !== "communications");
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
