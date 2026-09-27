import { useEffect } from "react";
import { useProjectStore } from "../store/useProjectStore";
import { CloseIcon } from "./icons/Icons";
import { InputSourceSelector } from "./InputSourceSelector";
import { DEFAULT_DEVICE_ID } from "../lib/inputDevices";

export function SettingsPanel() {
  const open = useProjectStore((s) => s.settingsOpen);
  const closeSettings = useProjectStore((s) => s.closeSettings);

  const availableOutputs = useProjectStore((s) => s.availableOutputs);
  const outputDeviceId = useProjectStore((s) => s.outputDeviceId);
  const setOutputDevice = useProjectStore((s) => s.setOutputDevice);
  const refreshOutputDevices = useProjectStore((s) => s.refreshOutputDevices);
  const masterOutputRoutingSupported = useProjectStore((s) => s.masterOutputRoutingSupported);
  const metronomeOutputRoutingSupported = useProjectStore((s) => s.metronomeOutputRoutingSupported);
  const metronomeOutputDeviceId = useProjectStore((s) => s.metronomeOutputDeviceId);
  const setMetronomeOutputDevice = useProjectStore((s) => s.setMetronomeOutputDevice);
  const metronomeEnabled = useProjectStore((s) => s.metronomeEnabled);
  const toggleMetronome = useProjectStore((s) => s.toggleMetronome);
  const metronomeVolume = useProjectStore((s) => s.metronomeVolume);
  const setMetronomeVolume = useProjectStore((s) => s.setMetronomeVolume);
  const countInEnabled = useProjectStore((s) => s.countInEnabled);
  const setCountInEnabled = useProjectStore((s) => s.setCountInEnabled);
  const latencyCompMs = useProjectStore((s) => s.latencyCompMs);
  const estimatedLatencyMs = useProjectStore((s) => s.estimatedLatencyMs);
  const calibrationState = useProjectStore((s) => s.calibrationState);
  const calibrationMessage = useProjectStore((s) => s.calibrationMessage);
  const setLatencyCompMs = useProjectStore((s) => s.setLatencyCompMs);
  const refreshEstimatedLatency = useProjectStore((s) => s.refreshEstimatedLatency);
  const calibrateLatency = useProjectStore((s) => s.calibrateLatency);
  const recordingTrackId = useProjectStore((s) => s.recordingTrackId);

  useEffect(() => {
    if (open) {
      refreshOutputDevices();
      refreshEstimatedLatency();
    }
  }, [open, refreshOutputDevices, refreshEstimatedLatency]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeSettings();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closeSettings]);

  if (!open) return null;

  return (
    <div className="settings-backdrop" onClick={closeSettings}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Audio settings">
        <div className="settings-header">
          <h2>Audio Settings</h2>
          <button className="settings-close" onClick={closeSettings} aria-label="Close settings">
            <CloseIcon />
          </button>
        </div>

        <section className="settings-section">
          <h3>Input</h3>
          <InputSourceSelector />
        </section>

        <section className="settings-section">
          <h3>Output</h3>
          {masterOutputRoutingSupported ? (
            <select className="settings-select" value={outputDeviceId} onChange={(e) => setOutputDevice(e.target.value)}>
              {availableOutputs.length === 0 && <option value={DEFAULT_DEVICE_ID}>System Default</option>}
              {availableOutputs.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </select>
          ) : (
            <p className="settings-note">
              Choosing an output device isn't supported in this browser (Chrome/Edge only) — audio plays through your
              system's default output.
            </p>
          )}
        </section>

        <section className="settings-section">
          <h3>Timing</h3>
          <p className="settings-note">
            Sound takes a moment to travel out to your speakers and back in through the mic. Recorded takes are shifted
            earlier by this delay so they land on the beat.
          </p>
          <div className="settings-row">
            <span>Delay</span>
            <div className="latency-controls">
              {latencyCompMs === null ? (
                <span className="settings-value">Auto · about {estimatedLatencyMs} ms</span>
              ) : (
                <>
                  <input
                    className="latency-input"
                    type="number"
                    min={0}
                    max={500}
                    value={latencyCompMs}
                    onChange={(e) => setLatencyCompMs(Number(e.target.value))}
                  />
                  <span className="settings-value">ms</span>
                  <button className="settings-toggle" onClick={() => setLatencyCompMs(null)}>
                    Use auto
                  </button>
                </>
              )}
            </div>
          </div>
          <div className="settings-row">
            <span>Measure it</span>
            <button
              className="settings-toggle"
              onClick={calibrateLatency}
              disabled={calibrationState === "running" || !!recordingTrackId}
            >
              {calibrationState === "running" ? "Listening…" : "Calibrate"}
            </button>
            {latencyCompMs === null && (
              <button className="settings-toggle" onClick={() => setLatencyCompMs(estimatedLatencyMs)}>
                Set by hand
              </button>
            )}
          </div>
          {calibrationMessage && (
            <p className={calibrationState === "failed" ? "settings-note settings-note-warn" : "settings-note"}>
              {calibrationMessage}
            </p>
          )}
          <p className="settings-note">
            Calibrate plays a few clicks and listens for them, so use speakers with the mic in the room. With headphones,
            enter the delay by hand.
          </p>
        </section>

        <section className="settings-section">
          <h3>Metronome</h3>
          <div className="settings-row">
            <span>Click track</span>
            <button
              className={metronomeEnabled ? "settings-toggle active" : "settings-toggle"}
              onClick={toggleMetronome}
              aria-pressed={metronomeEnabled}
            >
              {metronomeEnabled ? "On" : "Off"}
            </button>
          </div>
          <div className="settings-row">
            <span>Count-in</span>
            <button
              className={countInEnabled ? "settings-toggle active" : "settings-toggle"}
              onClick={() => setCountInEnabled(!countInEnabled)}
              aria-pressed={countInEnabled}
            >
              {countInEnabled ? "On" : "Off"}
            </button>
          </div>
          <p className="settings-note">
            Before recording starts, plays 4 clicks at the song tempo — even if the click track is off. Uses the click
            volume below.
          </p>
          <div className="settings-row">
            <span>Volume</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={metronomeVolume}
              onChange={(e) => setMetronomeVolume(Number(e.target.value))}
            />
          </div>
          <div className="settings-row">
            <span>Output</span>
            {metronomeOutputRoutingSupported ? (
              <select
                className="settings-select"
                value={metronomeOutputDeviceId ?? "same"}
                onChange={(e) => setMetronomeOutputDevice(e.target.value === "same" ? null : e.target.value)}
              >
                <option value="same">Same as main output</option>
                {availableOutputs.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label}
                  </option>
                ))}
              </select>
            ) : (
              <p className="settings-note">Not supported in this browser (Chrome/Edge only) — click plays through the main output.</p>
            )}
          </div>
          {metronomeOutputRoutingSupported && (
            <p className="settings-note">
              Keep “Same as main output” for the tightest sync. A separate output sends the click down a longer path that
              the browser can’t measure, so it may sit a few milliseconds off the channels.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
