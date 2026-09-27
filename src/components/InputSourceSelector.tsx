import { useEffect } from "react";
import { useProjectStore } from "../store/useProjectStore";
import { DEFAULT_DEVICE_ID } from "../lib/inputDevices";
import { MicIcon } from "./icons/Icons";
import { InputLevelMeter } from "./InputLevelMeter";

export function InputSourceSelector() {
  const availableInputs = useProjectStore((s) => s.availableInputs);
  const inputDeviceId = useProjectStore((s) => s.inputDeviceId);
  const inputChannelCount = useProjectStore((s) => s.inputChannelCount);
  const inputChannelIndex = useProjectStore((s) => s.inputChannelIndex);
  const loadingInputs = useProjectStore((s) => s.loadingInputs);
  const refreshInputDevices = useProjectStore((s) => s.refreshInputDevices);
  const setInputDevice = useProjectStore((s) => s.setInputDevice);
  const setInputChannel = useProjectStore((s) => s.setInputChannel);
  const recordingTrackId = useProjectStore((s) => s.recordingTrackId);

  useEffect(() => {
    refreshInputDevices();
    const onChange = () => refreshInputDevices();
    navigator.mediaDevices?.addEventListener?.("devicechange", onChange);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", onChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isMultiChannel = inputChannelCount > 2;
  const disabled = !!recordingTrackId;

  return (
    <div className="input-source">
      <span className="input-source-icon">
        <MicIcon size={14} />
      </span>
      <span className="input-source-label">Input</span>

      <select
        className="input-select"
        value={inputDeviceId}
        disabled={disabled || loadingInputs}
        onChange={(e) => setInputDevice(e.target.value)}
      >
        {availableInputs.length === 0 && <option value={DEFAULT_DEVICE_ID}>System Default</option>}
        {availableInputs.map((d) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label}
          </option>
        ))}
      </select>

      {isMultiChannel && (
        <select
          className="input-select channel-select"
          value={inputChannelIndex ?? "mix"}
          disabled={disabled}
          onChange={(e) => setInputChannel(e.target.value === "mix" ? null : Number(e.target.value))}
        >
          <option value="mix">All Channels</option>
          {Array.from({ length: inputChannelCount }, (_, i) => (
            <option key={i} value={i}>
              Ch {i + 1}
            </option>
          ))}
        </select>
      )}

      <InputLevelMeter />
    </div>
  );
}
