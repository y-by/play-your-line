import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useProjectStore } from "../../store/useProjectStore";
import type { Track } from "../../types/project";

/**
 * Which input of the device chosen in Settings this channel records from (an audio interface with several
 * inputs: input 1, input 2, ...). The device itself is set in Settings; this lists only what that device has.
 * A channel without a pick records from every input, as set in Settings. The pick is kept on this device.
 */
export function ChannelInput({ track }: { track: Track }) {
  const deviceId = useProjectStore((s) => s.inputDeviceId);
  const deviceName = useProjectStore((s) => s.availableInputs.find((d) => d.deviceId === s.inputDeviceId)?.label ?? "your input");
  const count = useProjectStore((s) => s.inputChannelCount);
  const settingsChannel = useProjectStore((s) => s.inputChannelIndex);
  const own = useProjectStore((s) => s.channelInputs[track.id]);
  const setChannelInput = useProjectStore((s) => s.setChannelInput);
  const busy = useProjectStore((s) => s.recordingTrackId !== null);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!at) return;
    const away = (e: PointerEvent) => {
      if (pop.current?.contains(e.target as Node) || btn.current?.contains(e.target as Node)) return;
      setAt(null);
    };
    window.addEventListener("pointerdown", away);
    return () => window.removeEventListener("pointerdown", away);
  }, [at]);

  const pick = own && own.deviceId === deviceId ? own.channelIndex : settingsChannel;
  const value = pick === null ? "mix" : String(pick);

  return (
    <>
      <button
        ref={btn}
        className={`fx-toggle${own && own.deviceId === deviceId ? " live" : ""}${at ? " on" : ""}`}
        onClick={() => {
          if (at) return setAt(null);
          const r = btn.current?.getBoundingClientRect();
          if (r) setAt({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - 268)) });
        }}
        title="Choose which input of your device this channel records from"
        aria-label="Choose this channel's input"
        aria-pressed={!!at}
      >
        Input
      </button>
      {at &&
        createPortal(
          <div ref={pop} className="channel-input-pop plugin-skin" style={{ top: at.top, left: at.left }} role="dialog" aria-label="Channel input">
            <label>
              <span>
                Input for {track.instrument} · {deviceName}
              </span>
              <select
                className="input-select"
                value={value}
                disabled={busy}
                onChange={(e) => void setChannelInput(track.id, { deviceId, channelIndex: e.target.value === "mix" ? null : Number(e.target.value) })}
              >
                <option value="mix">All inputs</option>
                {Array.from({ length: count }, (_, i) => (
                  <option key={i} value={i}>
                    Input {i + 1}
                  </option>
                ))}
              </select>
            </label>
          </div>,
          document.body,
        )}
    </>
  );
}
