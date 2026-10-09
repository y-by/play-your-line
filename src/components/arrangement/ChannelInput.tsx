import { useEffect, useRef, useState } from "react";
import { probeChannelCount } from "../../lib/inputDevices";
import { createPortal } from "react-dom";
import { useProjectStore } from "../../store/useProjectStore";
import type { Track } from "../../types/project";

/**
 * Which audio input one channel records from: a list of the inputs that are connected right now (an audio
 * interface's inputs one by one, microphones). Channels without a pick use the input chosen in Settings.
 * The pick is kept on this device.
 */
export function ChannelInput({ track }: { track: Track }) {
  const availableInputs = useProjectStore((s) => s.availableInputs);
  const refreshInputDevices = useProjectStore((s) => s.refreshInputDevices);
  const pick = useProjectStore((s) => s.channelInputs[track.id]);
  const counts = useProjectStore((s) => s.deviceChannelCounts);
  const settingsDeviceId = useProjectStore((s) => s.inputDeviceId);
  const settingsChannel = useProjectStore((s) => s.inputChannelIndex);
  const setChannelInput = useProjectStore((s) => s.setChannelInput);
  const setDeviceChannelCount = useProjectStore((s) => s.setDeviceChannelCount);
  const settingsCount = useProjectStore((s) => s.inputChannelCount);
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

  // Opening the list finds out how many inputs each device has (this briefly opens each one).
  useEffect(() => {
    if (!at) return;
    let alive = true;
    void (async () => {
      for (const d of availableInputs) {
        if (!alive) return;
        if (useProjectStore.getState().deviceChannelCounts[d.deviceId] === undefined) setDeviceChannelCount(d.deviceId, await probeChannelCount(d.deviceId));
      }
    })();
    return () => {
      alive = false;
    };
  }, [at, availableInputs, setDeviceChannelCount]);

  const current = pick && availableInputs.some((d) => d.deviceId === pick.deviceId) ? pick : { deviceId: settingsDeviceId, channelIndex: settingsChannel };
  const countOf = (id: string) => counts[id] ?? (id === settingsDeviceId ? settingsCount : 1);
  const choices: { value: string; label: string; input: { deviceId: string; channelIndex: number | null } }[] = [];
  for (const d of availableInputs) {
    const n = countOf(d.deviceId);
    if (n < 2) {
      choices.push({ value: `${d.deviceId}|mix`, label: d.label, input: { deviceId: d.deviceId, channelIndex: null } });
      continue;
    }
    choices.push({ value: `${d.deviceId}|mix`, label: `${d.label} — all inputs`, input: { deviceId: d.deviceId, channelIndex: null } });
    for (let i = 0; i < n; i++) choices.push({ value: `${d.deviceId}|${i}`, label: `${d.label} — input ${i + 1}`, input: { deviceId: d.deviceId, channelIndex: i } });
  }
  const value = `${current.deviceId}|${current.channelIndex ?? "mix"}`;

  return (
    <>
      <button
        ref={btn}
        className={`fx-toggle${pick ? " live" : ""}${at ? " on" : ""}`}
        onClick={() => {
          if (at) return setAt(null);
          void refreshInputDevices();
          const r = btn.current?.getBoundingClientRect();
          if (r) setAt({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - 268)) });
        }}
        title={pick ? "This channel has its own input — click to change" : "Choose the input this channel records from"}
        aria-label="Choose this channel's input"
        aria-pressed={!!at}
      >
        Input
      </button>
      {at &&
        createPortal(
          <div ref={pop} className="channel-input-pop plugin-skin" style={{ top: at.top, left: at.left }} role="dialog" aria-label="Channel input">
            <label>
              <span>Input for {track.instrument}</span>
              <select
                className="input-select"
                value={value}
                disabled={busy}
                onChange={(e) => {
                  const choice = choices.find((c) => c.value === e.target.value);
                  if (choice) void setChannelInput(track.id, choice.input);
                }}
              >
                {!choices.some((c) => c.value === value) && <option value={value}>Current input</option>}
                {choices.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
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
