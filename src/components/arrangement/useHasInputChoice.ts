import { useEffect } from "react";
import { useProjectStore } from "../../store/useProjectStore";

/**
 * Whether the input device chosen in Settings has two or more inputs to choose between. How many a device has can
 * only be found by opening it, so that is done only when the browser has already been given the microphone
 * (otherwise it is found when Settings or the first arm opens the device).
 */
export function useHasInputChoice(): boolean {
  const probeSettingsInput = useProjectStore((s) => s.probeSettingsInput);
  const inputs = useProjectStore((s) => s.inputChannelCount);

  useEffect(() => {
    let alive = true;
    // Every channel strip uses this hook, but the look-up is shared: it runs once, and never starts a level meter.
    const look = (forced = false) =>
      navigator.permissions
        ?.query({ name: "microphone" as PermissionName })
        .then((p) => alive && p.state === "granted" && void probeSettingsInput(forced))
        .catch(() => undefined);
    void look();
    const devices = navigator.mediaDevices;
    const onChange = () => void look(true);
    devices?.addEventListener?.("devicechange", onChange);
    return () => {
      alive = false;
      devices?.removeEventListener?.("devicechange", onChange);
    };
  }, [probeSettingsInput]);

  return inputs >= 2;
}
