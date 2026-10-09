import { useEffect } from "react";
import { useProjectStore } from "../../store/useProjectStore";

/**
 * Whether the input device chosen in Settings has two or more inputs to choose between. How many a device has can
 * only be found by opening it, so that is done only when the browser has already been given the microphone
 * (otherwise it is found when Settings or the first arm opens the device).
 */
export function useHasInputChoice(): boolean {
  const refreshInputDevices = useProjectStore((s) => s.refreshInputDevices);
  const inputs = useProjectStore((s) => s.inputChannelCount);

  useEffect(() => {
    let alive = true;
    const look = () =>
      navigator.permissions
        ?.query({ name: "microphone" as PermissionName })
        .then((p) => alive && p.state === "granted" && void refreshInputDevices())
        .catch(() => undefined);
    void look();
    const devices = navigator.mediaDevices;
    devices?.addEventListener?.("devicechange", look);
    return () => {
      alive = false;
      devices?.removeEventListener?.("devicechange", look);
    };
  }, [refreshInputDevices]);

  return inputs >= 2;
}
