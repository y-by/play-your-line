import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Track } from "../../types/project";
import { useProjectStore } from "../../store/useProjectStore";
import { estimateTakeMb, hiddenTakes } from "../../lib/retakes";
import { formatTime } from "../../lib/format";

/**
 * The takes of a channel that are covered by a newer one (retakes, and every lap of a loop recording): hear each one on its own,
 * bring one to the top so it is the one heard in the song, or delete it. The take on top is listed first, to compare with.
 */
export function OlderTakes({ track, onClose }: { track: Track; onClose: () => void }) {
  const engine = useProjectStore((s) => s.engine);
  const takes = useProjectStore((s) => s.project?.takes ?? {});
  const bringTakeToFront = useProjectStore((s) => s.bringTakeToFront);
  const deleteHiddenTake = useProjectStore((s) => s.deleteHiddenTake);
  const clearHiddenTakes = useProjectStore((s) => s.clearHiddenTakes);
  const [hearing, setHearing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      engine.stopPreview();
    };
  }, [engine, onClose]);

  const hidden = hiddenTakes(track.clips); // oldest first
  const topTakeId = [...track.clips].sort((a, b) => b.z - a.z)[0]?.takeId ?? null;
  const rows = [...(topTakeId ? [{ takeId: topTakeId, onTop: true }] : []), ...[...hidden].reverse().map((h) => ({ takeId: h.takeId, onTop: false }))];
  const totalMb = Math.round(hidden.reduce((sum, h) => sum + estimateTakeMb(takes[h.takeId]?.durationSec ?? 0, track.stereo), 0));

  const hear = async (takeId: string) => {
    if (hearing === takeId) {
      engine.stopPreview();
      setHearing(null);
      return;
    }
    const clip = track.clips.find((c) => c.takeId === takeId);
    setHearing(takeId);
    const ok = await engine.previewTake(takeId, clip?.sourceStartSec ?? 0, clip?.durationSec, () => setHearing((h) => (h === takeId ? null : h)));
    if (!ok) setHearing(null);
  };

  const act = async (work: () => Promise<unknown>) => {
    engine.stopPreview();
    setHearing(null);
    setBusy(true);
    await work();
    setBusy(false);
  };

  return createPortal(
    <div className="zip-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="zip-panel fb-panel" role="dialog" aria-label={`Takes of ${track.instrument}`}>
        <h3>Takes: {track.instrument}</h3>
        <p className="zip-lead">
          Everything recorded in the same place stays here. Only the take on top is heard in the song. Hear any of them on its own, and bring the best one to the top.
        </p>
        <ul className="ot-list">
          {rows.map(({ takeId, onTop }) => {
            const take = takes[takeId];
            return (
              <li key={takeId} className={onTop ? "ot-row top" : "ot-row"}>
                <div className="ot-info">
                  <b>{onTop ? "On top: heard in the song" : "Under the top"}</b>
                  <span>
                    {take ? `recorded ${new Date(take.createdAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })} · ${formatTime(take.durationSec)}` : "…"}
                  </span>
                </div>
                <div className="ot-actions">
                  <button className="fb-attach" onClick={() => void hear(takeId)} disabled={busy}>
                    {hearing === takeId ? "Stop" : "Hear"}
                  </button>
                  {!onTop && (
                    <>
                      <button className="fb-attach" onClick={() => void act(() => bringTakeToFront(track.id, takeId))} disabled={busy}>
                        Use this one
                      </button>
                      <button className="zip-cancel sec-delete" onClick={() => { if (confirm("Delete this take? It cannot be brought back.")) void act(() => deleteHiddenTake(track.id, takeId)); }} disabled={busy}>
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        <div className="fb-row">
          {hidden.length > 1 && (
            <button
              className="zip-cancel sec-delete"
              disabled={busy}
              onClick={() => { if (confirm(`Delete all ${hidden.length} takes under the top one? They use about ${totalMb} MB and cannot be brought back.`)) void act(() => clearHiddenTakes(track.id)); }}
            >
              Delete all under the top
            </button>
          )}
          <button className="fb-send" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
