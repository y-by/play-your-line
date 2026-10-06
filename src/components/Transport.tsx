import { useEffect } from "react";
import { useAuthStore } from "../store/useAuthStore";
import { useProjectStore } from "../store/useProjectStore";
import { formatTime } from "../lib/format";
import { barAndBeat, BEATS_PER_BAR } from "../lib/grid";
import { BackToStartIcon, PlayIcon, PauseIcon, StopIcon, LoopIcon, MetronomeIcon, PlusCircleIcon, UserPlusIcon, GearIcon } from "./icons/Icons";
import { TempoControl } from "./TempoControl";
import { EditToolbar } from "./arrangement/EditToolbar";
import { AddChannelPanel } from "./AddChannelPanel";
import { PeoplePanel } from "./PeoplePanel";
import { ProjectName, ProjectStatus } from "./ProjectBar";
import { CloseIcon, NoteIcon } from "./icons/Icons";

export type SongPanel = "add" | "people" | null;

interface Props {
  panel: SongPanel;
  onPanel: (panel: SongPanel) => void;
}

/** Settings, people and add-channel buttons. */
function PanelButtons({ panel, onPanel, className }: Props & { className: string }) {
  const isInitiator = useProjectStore((s) => s.isInitiator());
  const isParticipant = useProjectStore((s) => s.isParticipant());
  const openSettings = useProjectStore((s) => s.openSettings);
  const notesVisible = useProjectStore((s) => s.notesVisible);
  const setNotesVisible = useProjectStore((s) => s.setNotesVisible);
  const openNotes = useProjectStore((s) => s.notes.filter((n) => !n.done).length);
  const uid = useAuthStore((s) => s.userId);
  const forMe = useProjectStore((s) => (uid ? s.notes.filter((n) => !n.done && n.mentions.includes(uid)).length : 0));
  const hasNotesToShow = useProjectStore((s) => s.canWriteNotes() || s.notes.length > 0);
  return (
    <div className={`lg ${className}`}>
      <button className="lb" onClick={openSettings} title="Audio settings" aria-label="Audio settings">
        <GearIcon size={16} />
      </button>
      {isInitiator && (
        <button
          className={panel === "people" ? "lb on" : "lb"}
          onClick={() => onPanel(panel === "people" ? null : "people")}
          title="People: mixer and listeners"
          aria-label="People"
        >
          <UserPlusIcon size={16} />
        </button>
      )}
      {hasNotesToShow && (
        <button
          className={notesVisible ? "lb on notes-btn" : "lb notes-btn"}
          onClick={() => setNotesVisible(!notesVisible)}
          title={notesVisible ? "Notes are showing — click to hide the notes tray, cards and flags" : "Notes are hidden — click to show them"}
          aria-pressed={notesVisible}
          aria-label="Notes"
        >
          <NoteIcon size={16} />
          {forMe > 0 ? (
            <span className="notes-btn-dot for-me" title={`${forMe} open note${forMe === 1 ? "" : "s"} tagging you`}>@{forMe > 9 ? "9+" : forMe}</span>
          ) : (
            openNotes > 0 && <span className="notes-btn-dot">{openNotes > 9 ? "9+" : openNotes}</span>
          )}
        </button>
      )}
      {isParticipant && (
        <button
          className={panel === "add" ? "lb on" : "lb"}
          onClick={() => onPanel(panel === "add" ? null : "add")}
          title={isInitiator ? "Add a channel, invite players" : "Add a channel"}
          aria-label="Add a channel"
        >
          <PlusCircleIcon size={16} />
        </button>
      )}
    </div>
  );
}

/** Loop, count-in and metronome. (Master solo and mute sit above the channels, in the ruler's corner.) */
function ModeButtons({ className }: { className: string }) {
  const loop = useProjectStore((s) => s.loop);
  const loopEnabled = useProjectStore((s) => s.loopEnabled);
  const toggleLoop = useProjectStore((s) => s.toggleLoop);
  const countInEnabled = useProjectStore((s) => s.countInEnabled);
  const setCountInEnabled = useProjectStore((s) => s.setCountInEnabled);
  const metronomeEnabled = useProjectStore((s) => s.metronomeEnabled);
  const toggleMetronome = useProjectStore((s) => s.toggleMetronome);
  const metronomeVolume = useProjectStore((s) => s.metronomeVolume);
  const setMetronomeVolume = useProjectStore((s) => s.setMetronomeVolume);
  return (
    <div className={`lg ${className}`}>
      <button
        className={loop && loopEnabled ? "lb on" : "lb"}
        onClick={toggleLoop}
        title="Loop: repeat a highlighted part (drag on the strip under the bar numbers to choose it)"
        aria-pressed={!!loop && loopEnabled}
        aria-label="Loop"
      >
        <LoopIcon />
      </button>
      <button
        className={countInEnabled ? "lb wide brand" : "lb wide"}
        onClick={() => setCountInEnabled(!countInEnabled)}
        title="Count in 4 clicks before recording"
        aria-pressed={countInEnabled}
      >
        1234
      </button>
      <button
        className={metronomeEnabled ? "lb on" : "lb"}
        onClick={toggleMetronome}
        title={metronomeEnabled ? "Click on — turn it off" : "Click off — turn it on"}
        aria-pressed={metronomeEnabled}
        aria-label="Click"
      >
        <MetronomeIcon size={16} />
      </button>
      <input
        className="volume-slider lb-volume"
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={metronomeVolume}
        onChange={(e) => setMetronomeVolume(Number(e.target.value))}
        title="Click volume"
        aria-label="Click volume"
      />
    </div>
  );
}

/** The one control bar: panels, transport, the number display, modes, and the editing tools. */
export function Transport({ panel, onPanel }: Props) {
  const isPlaying = useProjectStore((s) => s.isPlaying);
  const positionSec = useProjectStore((s) => s.positionSec);
  const durationSec = useProjectStore((s) => s.durationSec);
  const play = useProjectStore((s) => s.play);
  const pause = useProjectStore((s) => s.pause);
  const seek = useProjectStore((s) => s.seek);
  const recordingTrackId = useProjectStore((s) => s.recordingTrackId);
  const recordingPhase = useProjectStore((s) => s.recordingPhase);
  const bpm = useProjectStore((s) => s.project?.bpm ?? 120);
  const hasChannels = useProjectStore((s) => (s.project?.tracks.length ?? 0) > 0);
  const armedId = useProjectStore((s) => s.effectiveArmedId());
  const armedName = useProjectStore((s) => s.project?.tracks.find((t) => t.id === s.effectiveArmedId())?.instrument ?? null);
  const toggleRecord = useProjectStore((s) => s.toggleRecord);
  const stopRecording = useProjectStore((s) => s.stopRecording);

  useEffect(() => {
    if (!panel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onPanel(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panel, onPanel]);

  const { bar, beat } = barAndBeat(positionSec, bpm);
  const recActive = !!recordingTrackId && recordingPhase !== "uploading";
  const busy = !!recordingTrackId;
  // Same action as the Space key: stop a recording if one's running, otherwise stop playback.
  const stop = () => (recordingTrackId ? void stopRecording() : pause());

  return (
    <div className="cbar">
      <div className="cb-row cb-main">
        <ProjectName />
        <div className="cb-center">
          <div className="lg cb-transport">
            <button className="lb" onClick={() => seek(0)} disabled={busy} title="Back to start" aria-label="Back to start">
              <BackToStartIcon />
            </button>
            <button
              className={isPlaying ? "lb on" : "lb"}
              onClick={() => (isPlaying ? pause() : play())}
              disabled={busy}
              title={isPlaying ? "Pause (Space)" : "Play (Space)"}
              aria-label={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? <PauseIcon /> : <PlayIcon />}
            </button>
            <button
              className="lb"
              onClick={stop}
              disabled={!isPlaying && !recordingTrackId}
              title="Stop (Space)"
              aria-label="Stop"
            >
              <StopIcon size={13} />
            </button>
            <button
              className={recActive ? "lb rec on" : "lb rec"}
              onClick={toggleRecord}
              disabled={!armedId || (busy && !recActive)}
              title={
                recActive ? "Stop recording (R)" : armedName ? `Record on ${armedName} (R)` : "You have no channel to record on"
              }
              aria-label={recActive ? "Stop recording" : "Record"}
            >
              <span className="rec-dot" />
            </button>
          </div>

          <div className="lcd2">
            <div className="lcd-cell">
              <span className="lcd-n">{bar}</span>
              <span className="lcd-l">bar</span>
            </div>
            <div className="lcd-cell">
              <span className="lcd-n">{beat}</span>
              <span className="lcd-l">beat</span>
            </div>
            <div className="lcd-cell lcd-time">
              <span className="lcd-n s">{formatTime(positionSec)}</span>
              <span className="lcd-l">of {formatTime(durationSec)}</span>
            </div>
            <div className="lcd-cell">
              <TempoControl />
              <span className="lcd-l">bpm</span>
            </div>
            <div className="lcd-cell">
              <span className="lcd-n s">{BEATS_PER_BAR}/4</span>
              <span className="lcd-l">signature</span>
            </div>
          </div>

          <ModeButtons className="hide-m cb-modes" />
        </div>
        <ProjectStatus />
      </div>

      <div className="cb-row cb-tools">
        <div className="tools-scroll">
          <PanelButtons panel={panel} onPanel={onPanel} className="" />
          <ModeButtons className="only-m" />
          {hasChannels && <EditToolbar />}
        </div>
      </div>

      {panel && (
        <>
          <div className="cb-popup-catcher" onClick={() => onPanel(null)} />
          <div className="cb-popup plugin-skin" role="dialog" aria-label={panel === "add" ? "Channels" : "People"}>
            <header className="plugin-head">
              <h2>{panel === "add" ? "Channels" : "People"}</h2>
              <button className="plugin-close" onClick={() => onPanel(null)} aria-label="Close">
                <CloseIcon />
              </button>
            </header>
            {panel === "add" ? <AddChannelPanel /> : <PeoplePanel />}
          </div>
        </>
      )}
    </div>
  );
}
