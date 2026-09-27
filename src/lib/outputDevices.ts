import { DEFAULT_DEVICE_ID } from "./inputDevices";

export interface OutputDevice {
  deviceId: string;
  label: string;
}

export async function listOutputDevices(): Promise<OutputDevice[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const outputs = devices.filter((d) => d.kind === "audiooutput");
  return outputs.map((d, i) => ({
    deviceId: d.deviceId || DEFAULT_DEVICE_ID,
    label: d.label || `Speaker ${i + 1}`,
  }));
}
