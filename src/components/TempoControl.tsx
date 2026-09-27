import { useProjectStore } from "../store/useProjectStore";
import { LockIcon } from "./icons/Icons";

/** The tempo cell of the display: − 90 + and a lock when the tempo can't change. */
export function TempoControl() {
  const project = useProjectStore((s) => s.project);
  const isInitiator = useProjectStore((s) => s.isInitiator());
  const setTempo = useProjectStore((s) => s.setTempo);
  const recordingTrackId = useProjectStore((s) => s.recordingTrackId);
  const tempoLocked = useProjectStore((s) => s.tempoLocked());

  if (!project) return null;

  const disabled = !isInitiator || !!recordingTrackId || tempoLocked;

  return (
    <div
      className={isInitiator && !tempoLocked ? "tempo-control" : "tempo-control locked"}
      title={
        tempoLocked
          ? "Tempo is locked because recordings exist (delete all clips to change it)"
          : isInitiator
            ? "You're the owner — you set the tempo for everyone"
            : "Only the owner can change the tempo"
      }
    >
      <button className="tempo-step" disabled={disabled} onClick={() => setTempo(project.bpm - 1)} aria-label="Decrease tempo">
        −
      </button>
      <input
        className="tempo-value"
        type="number"
        min={20}
        max={300}
        value={project.bpm}
        disabled={disabled}
        onChange={(e) => setTempo(Number(e.target.value))}
        aria-label="Tempo in beats per minute"
      />
      <button className="tempo-step" disabled={disabled} onClick={() => setTempo(project.bpm + 1)} aria-label="Increase tempo">
        +
      </button>
      {(!isInitiator || tempoLocked) && (
        <span className="tempo-lock">
          <LockIcon size={11} />
        </span>
      )}
    </div>
  );
}
