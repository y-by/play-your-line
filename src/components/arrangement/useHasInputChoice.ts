import { useEffect, useState } from "react";
import { useProjectStore } from "../../store/useProjectStore";

/**
 * Whether there is anything to choose between: more than one input device connected, or a device with two or
 * more inputs. Devices are counted without asking for the microphone. How many inputs a device has can only be
 * found by opening it, so that is done only when the browser has already been given the microphone.
 */
export function useHasInputChoice(): boolean {
  const refreshInputDevices = useProjectStore((s) => s.refreshInputDevices);
  const known = useProjectStore((s) => s.availableInputs.length);
  const manyChannels = useProjectStore((s) => s.inputChannelCount >= 2 || Object.values(s.deviceChannelCounts).some((n) => n >= 2));
  const [found, setFound] = useState(0);

  useEffect(() => {
    const devices = navigator.mediaDevices;
    if (!devices?.enumerateDevices) return;
    let alive = true;
    const count = () =>
      devices
        .enumerateDevices()
        .then((list) => alive && setFound(list.filter((d) => d.kind === "audioinput" && d.deviceId !== "default" && d.deviceId !== "communications").length))
        .catch(() => undefined);
    const look = () => {
      void count();
      navigator.permissions
        ?.query({ name: "microphone" as PermissionName })
        .then((p) => alive && p.state === "granted" && void refreshInputDevices())
        .catch(() => undefined);
    };
    look();
    devices.addEventListener?.("devicechange", look);
    return () => {
      alive = false;
      devices.removeEventListener?.("devicechange", look);
    };
  }, [refreshInputDevices]);

  return Math.max(known, found) > 1 || manyChannels;
}
