import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useProjectStore } from "../store/useProjectStore";
import { errorMessage } from "../lib/errorMessage";
import { fetchCoverUrls } from "../lib/projectApi";
import { useAuthStore } from "../store/useAuthStore";
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
  const testMetronomeClick = useProjectStore((s) => s.testMetronomeClick);
  const countInEnabled = useProjectStore((s) => s.countInEnabled);
  const setCountInEnabled = useProjectStore((s) => s.setCountInEnabled);
  const countInBars = useProjectStore((s) => s.countInBars);
  const setCountInBars = useProjectStore((s) => s.setCountInBars);
  const latencyCompMs = useProjectStore((s) => s.latencyCompMs);
  const estimatedLatencyMs = useProjectStore((s) => s.estimatedLatencyMs);
  const calibrationState = useProjectStore((s) => s.calibrationState);
  const calibrationMessage = useProjectStore((s) => s.calibrationMessage);
  const setLatencyCompMs = useProjectStore((s) => s.setLatencyCompMs);
  const refreshEstimatedLatency = useProjectStore((s) => s.refreshEstimatedLatency);
  const calibrateLatency = useProjectStore((s) => s.calibrateLatency);
  const recordingTrackId = useProjectStore((s) => s.recordingTrackId);
  const displayName = useAuthStore((s) => s.profile?.displayName ?? "");
  const setDisplayName = useAuthStore((s) => s.setDisplayName);
  const tooltipsOn = useProjectStore((s) => s.tooltipsOn);
  const setTooltipsOn = useProjectStore((s) => s.setTooltipsOn);
  const [tab, setTab] = useState<"general" | "audio" | "click" | "project">("general");
  const navigate = useNavigate();
  const projectTitle = useProjectStore((s) => s.project?.title ?? null);
  const isOwner = useProjectStore((s) => s.isInitiator());
  const tabList = (
    [
      ["general", "General"],
      ["audio", "Audio"],
      ["click", "Click"],
      ...(isOwner && projectTitle !== null ? [["project", "Project"]] : []),
    ] as ["general" | "audio" | "click" | "project", string][]
  );
  const deleteProject = useProjectStore((s) => s.deleteProject);
  const coverPath = useProjectStore((s) => s.project?.coverPath ?? null);
  const projectId = useProjectStore((s) => s.project?.id ?? null);
  const setProjectCover = useProjectStore((s) => s.setProjectCover);
  const [coverBusy, setCoverBusy] = useState(false);
  const [coverError, setCoverError] = useState<string | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!open || !coverPath || !projectId) return;
    let cancelled = false;
    fetchCoverUrls([{ id: projectId, coverPath }])
      .then((urls) => !cancelled && setCoverPreview(urls[projectId] ?? null))
      .catch(() => !cancelled && setCoverPreview(null));
    return () => {
      cancelled = true;
    };
  }, [open, coverPath, projectId]);
  const changeCover = async (file: File | null) => {
    setCoverBusy(true);
    setCoverError(null);
    try {
      await setProjectCover(file);
    } catch (err) {
      console.error("Failed to change the cover:", err);
      setCoverError(`Couldn't change the cover: ${errorMessage(err, "try another image")}`);
    } finally {
      setCoverBusy(false);
    }
  };
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const handleDelete = async () => {
    if (
      !confirm(
        `DELETE "${projectTitle}" FOREVER?\n\nThis permanently deletes the project, every channel, and every recording in it — including the recordings other people made. Everyone loses access immediately.\n\nThis cannot be undone.`
      )
    )
      return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteProject();
      closeSettings();
      navigate("/");
    } catch (err) {
      console.error("Failed to delete the project:", err);
      const detail = err && typeof err === "object" && "message" in err ? ` (${String((err as { message: unknown }).message)})` : "";
      setDeleteError(`Couldn't finish deleting the project${detail}. Try again — some recordings may already be gone.`);
      setDeleting(false);
    }
  };
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const saveName = async () => {
    const draft = nameDraft;
    setNameDraft(null);
    if (draft === null || !draft.trim()) return;
    try {
      await setDisplayName(draft);
      setNameError(null);
    } catch (err) {
      console.error("Failed to save the name:", err);
      setNameError("Couldn't save your name — try again.");
    }
  };

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
      <div className="settings-panel plugin-skin" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Settings">
        <div className="settings-header">
          <h2>Settings</h2>
          <button className="plugin-close" onClick={closeSettings} aria-label="Close settings">
            <CloseIcon />
          </button>
        </div>

        <div className="settings-tabs" role="tablist">
          {tabList.map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>

        {tab === "general" && (
          <>
        <section className="settings-section">
          <h3>Your name</h3>
          <div className="settings-row">
            <input
              className="settings-select"
              value={nameDraft ?? displayName}
              placeholder="Name or stage name"
              maxLength={40}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={saveName}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              aria-label="Your display name"
            />
          </div>
          {nameError && <p className="assign-error">{nameError}</p>}
          <p className="settings-note">
            What other people see on your channels and on project cards. Starts as your Google name; change it to a stage
            name if you like. Others see the change next time they open the project.
          </p>
        </section>

        <section className="settings-section">
          <h3>Hints</h3>
          <div className="settings-row">
            <span>Tooltips</span>
            <button
              className={tooltipsOn ? "settings-toggle active" : "settings-toggle"}
              onClick={() => setTooltipsOn(!tooltipsOn)}
              aria-pressed={tooltipsOn}
            >
              {tooltipsOn ? "On" : "Off"}
            </button>
          </div>
          <p className="settings-note">The little hints that appear when you point at a button. Switch them off once you know your way around.</p>
        </section>

        <section className="settings-section">
          <h3>Help</h3>
          <p className="settings-note">
            <a href="/help" target="_blank" rel="noreferrer">
              Questions and answers
            </a>{" "}
            about recording, effects, notes and sharing. It opens in a new tab, so your project stays as it is.
          </p>
        </section>

          </>
        )}

        {tab === "audio" && (
          <>
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

          </>
        )}

        {tab === "click" && (
          <>
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
          {countInEnabled && (
            <div className="settings-row">
              <span>Count-in length</span>
              <select className="settings-select" value={countInBars} onChange={(e) => setCountInBars(Number(e.target.value))}>
                <option value={1}>1 bar</option>
                <option value={2}>2 bars</option>
                <option value={3}>3 bars</option>
              </select>
            </div>
          )}
          <p className="settings-note">
            Before recording starts, plays 1, 2 or 3 bars of clicks (4 a bar in 4/4, 3 in 3/4) at the project tempo — even if the click track is off. Uses
            the click volume below.
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
            <button className="settings-toggle" onClick={testMetronomeClick} title="Play one click at this volume">
              Test
            </button>
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

          </>
        )}

        {tab === "project" && (
          <>
        {isOwner && projectTitle !== null && (
          <section className="settings-section">
            <h3>Cover image</h3>
            <div className="cover-setting">
              <div className="cover-setting-preview">
                {coverPath && coverPreview ? <img src={coverPreview} alt="Project cover" /> : <span>No image</span>}
              </div>
              <div className="cover-setting-actions">
                <label className={coverBusy ? "settings-toggle disabled" : "settings-toggle"}>
                  {coverBusy ? "Working…" : coverPath ? "Replace image" : "Add image"}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    hidden
                    disabled={coverBusy}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (file) void changeCover(file);
                    }}
                  />
                </label>
                {coverPath && (
                  <button className="settings-toggle" disabled={coverBusy} onClick={() => changeCover(null)}>
                    Remove
                  </button>
                )}
              </div>
            </div>
            {coverError && <p className="assign-error">{coverError}</p>}
            <p className="settings-note">
              Shown on this project's card, fitted inside the square so nothing is cut off. Without one, the card gets
              generated artwork. The image is shrunk before it's saved.
            </p>
          </section>
        )}

        {isOwner && projectTitle !== null && (
          <section className="settings-section danger-zone">
            <h3>Danger zone</h3>
            <p className="settings-note">
              Deleting this project removes it, all of its channels and every recording in it for everyone, permanently.
              There is no undo and no backup.
            </p>
            <button className="danger-btn" onClick={handleDelete} disabled={deleting || !!recordingTrackId}>
              {deleting ? "Deleting…" : "Delete this project…"}
            </button>
            {deleteError && <p className="assign-error">{deleteError}</p>}
          </section>
        )}
          </>
        )}

      </div>
    </div>
  );
}
