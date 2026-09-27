import { useProjectStore } from "../store/useProjectStore";
import { formatTime } from "../lib/format";
import { barAndBeat, BEATS_PER_BAR } from "../lib/grid";
import { BackToStartIcon, PlayIcon, PauseIcon, LoopIcon, MetronomeIcon, PlusCircleIcon, UserPlusIcon, SettingsSlidersIcon } from "./icons/Icons";
import { TempoControl } from "./TempoControl";
import { EditToolbar } from "./arrangement/EditToolbar";

export type SongPanel = "add" | "people" | null;

interface Props {
  panel: SongPanel;
  onPanel: (panel: SongPanel) => void;
}

/** Settings, people and add-channel buttons. */
function PanelButtons({ panel, onPanel, className }: Props & { className: string }) {
  const isInitiator = useProjectStore((s) => s.isInitiator());
  const openSettings = useProjectStore((s) => s.openSettings);
  return (
    <div className={`lg ${className}`}>
      <button className="lb" onClick={openSettings} title="Audio settings" aria-label="Audio settings">
        <SettingsSlidersIcon />
      </button>
      {isInitiator && (
        <>
          <button
            className={panel === "people" ? "lb on" : "lb"}
            onClick={() => onPanel(panel === "people" ? null : "people")}
            title="People: mixer and listeners"
            aria-label="People"
          >
            <UserPlusIcon size={16} />
          </button>
          <button
            className={panel === "add" ? "lb on" : "lb"}
            onClick={() => onPanel(panel === "add" ? null : "add")}
            title="Add a channel, invite players"
            aria-label="Add a channel"
          >
            <PlusCircleIcon size={16} />
          </button>
        </>
      )}
    </div>
  );
}

/** Loop, count-in, metronome and clear-solo. */
function ModeButtons({ className }: { className: string }) {
  const loop = useProjectStore((s) => s.loop);
  const loopEnabled = useProjectStore((s) => s.loopEnabled);
  const toggleLoop = useProjectStore((s) => s.toggleLoop);
  const countInEnabled = useProjectStore((s) => s.countInEnabled);
  const setCountInEnabled = useProjectStore((s) => s.setCountInEnabled);
  const metronomeEnabled = useProjectStore((s) => s.metronomeEnabled);
  const toggleMetronome = useProjectStore((s) => s.toggleMetronome);
  const anySolo = useProjectStore((s) => Object.values(s.localSolo).some(Boolean));
  const clearSolo = useProjectStore((s) => s.clearSolo);
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
      <button className={anySolo ? "lb solo-on" : "lb"} onClick={clearSolo} disabled={!anySolo} title="Turn off all solos" aria-label="Clear solos">
        S
      </button>
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

  const { bar, beat } = barAndBeat(positionSec, bpm);
  const recActive = !!recordingTrackId && recordingPhase !== "uploading";
  const busy = !!recordingTrackId;

  return (
    <div className="cbar">
      <div className="cb-row cb-main">
        <PanelButtons panel={panel} onPanel={onPanel} className="hide-m cb-panels" />

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

      <div className="cb-row cb-tools">
        <div className="tools-scroll">
          <PanelButtons panel={panel} onPanel={onPanel} className="only-m" />
          <ModeButtons className="only-m" />
          {hasChannels && <EditToolbar />}
        </div>
      </div>
    </div>
  );
}
