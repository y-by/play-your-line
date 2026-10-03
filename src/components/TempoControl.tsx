import { useState } from "react";
import { useProjectStore } from "../store/useProjectStore";
import { LockIcon } from "./icons/Icons";

/** The tempo cell of the display: − 90 + and a lock when the tempo can't change. */
export function TempoControl() {
  const project = useProjectStore((s) => s.project);
  const isInitiator = useProjectStore((s) => s.isInitiator());
  const setTempo = useProjectStore((s) => s.setTempo);
  const recordingTrackId = useProjectStore((s) => s.recordingTrackId);
  const tempoLocked = useProjectStore((s) => s.tempoLocked());

  // Typing is held as text and only applied on Enter/blur — applying (and clamping to 20)
  // on every keystroke made it impossible to type a number like 95.
  const [typed, setTyped] = useState<{ forBpm: number | undefined; text: string } | null>(null);
  const draft = typed && typed.forBpm === project?.bpm ? typed.text : null; // a tempo change from elsewhere drops the draft
  const setDraft = (text: string | null) => setTyped(text === null ? null : { forBpm: project?.bpm, text });

  if (!project) return null;
  const commit = () => {
    const n = Number(draft);
    setDraft(null);
    if (draft !== null && draft.trim() !== "" && Number.isFinite(n)) setTempo(n);
  };

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
        value={draft ?? project.bpm}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
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
