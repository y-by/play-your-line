import { useState } from "react";
import { useProjectStore } from "../store/useProjectStore";

/**
 * Shown when a loop is dropped on a channel and its tempo differs from the song's: fit it to the song (keeping the
 * pitch), leave it as it is, or (the Owner, before anything is recorded) set the song to the loop's tempo.
 */
export function LoopTempoPrompt() {
  const prompt = useProjectStore((s) => s.loopTempoPrompt);
  const confirm = useProjectStore((s) => s.confirmLoopTempo);
  const cancel = useProjectStore((s) => s.cancelLoopTempo);
  const canSetSong = useProjectStore((s) => s.isInitiator() && !s.tempoLocked());
  const [typed, setTyped] = useState<string | null>(null);
  if (!prompt) return null;
  const loopBpm = Number(typed ?? prompt.bpm);
  const valid = Number.isFinite(loopBpm) && loopBpm >= 40 && loopBpm <= 300;
  const done = () => setTyped(null);

  return (
    <div className="settings-backdrop" onClick={() => (cancel(), done())}>
      <div className="settings-panel plugin-skin loop-tempo" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Loop tempo">
        <div className="settings-header">
          <h2>Loop tempo</h2>
        </div>
        <section className="settings-section">
          <p className="settings-note">
            <b>{prompt.fileName}</b> {prompt.source === "filename" ? "says it is" : "sounds like"} about <b>{prompt.bpm}</b> BPM. The song is at <b>{prompt.projectBpm}</b> BPM.
          </p>
          <div className="settings-row">
            <span>This loop's tempo</span>
            <input className="latency-input" type="number" min={40} max={300} step={0.1} value={typed ?? String(prompt.bpm)} onChange={(e) => setTyped(e.target.value)} aria-label="The loop's tempo in BPM" />
            <span className="settings-value">BPM</span>
          </div>
          <div className="loop-tempo-actions">
            <button
              className="settings-toggle active"
              disabled={!valid}
              onClick={() => {
                void confirm({ mode: "match", bpm: loopBpm });
                done();
              }}
              title="Make the loop play at the song's tempo. The pitch stays the same."
            >
              Fit to {prompt.projectBpm} BPM
            </button>
            <button
              className="settings-toggle"
              onClick={() => {
                void confirm({ mode: "keep", bpm: loopBpm });
                done();
              }}
              title="Add the loop exactly as it is"
            >
              Keep as it is
            </button>
            {canSetSong && (
              <button
                className="settings-toggle"
                disabled={!valid}
                onClick={() => {
                  void confirm({ mode: "project", bpm: loopBpm });
                  done();
                }}
                title="Set the song to the loop's tempo (only possible before anything is recorded)"
              >
                Set the song to {Math.round(loopBpm)} BPM
              </button>
            )}
            <button className="settings-toggle" onClick={() => (cancel(), done())}>
              Cancel
            </button>
          </div>
          <p className="settings-note">Fitting changes the speed without changing the pitch. It works best on loops; very large changes can sound a little rough.</p>
        </section>
      </div>
    </div>
  );
}
