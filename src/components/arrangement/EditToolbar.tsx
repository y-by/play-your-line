import { useProjectStore } from "../../store/useProjectStore";
import { SNAP_OPTIONS, type SnapResolution } from "../../lib/grid";
import { UndoIcon, CutIcon, DuplicateIcon, TrashIcon, MagnetIcon } from "../icons/Icons";

export function EditToolbar() {
  const pxPerBeat = useProjectStore((s) => s.pxPerBeat);
  const setPxPerBeat = useProjectStore((s) => s.setPxPerBeat);
  const project = useProjectStore((s) => s.project);
  const selectedClip = useProjectStore((s) => s.selectedClip);
  const historyCounts = useProjectStore((s) => s.historyCounts);
  const snapEnabled = useProjectStore((s) => s.snapEnabled);
  const snapResolution = useProjectStore((s) => s.snapResolution);
  const setSnapEnabled = useProjectStore((s) => s.setSnapEnabled);
  const setSnapResolution = useProjectStore((s) => s.setSnapResolution);
  const listeningMode = useProjectStore((s) => s.listeningMode);
  const setListeningMode = useProjectStore((s) => s.setListeningMode);
  const isInitiator = useProjectStore((s) => s.isInitiator());
  const canMix = useProjectStore((s) => s.canMix());
  const personalOrder = useProjectStore((s) => s.personalOrder);
  const resetOrder = useProjectStore((s) => s.resetOrder);
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);
  const splitSelected = useProjectStore((s) => s.splitSelected);
  const duplicateSelected = useProjectStore((s) => s.duplicateSelected);
  const deleteSelected = useProjectStore((s) => s.deleteSelected);
  const recording = useProjectStore((s) => s.recordingTrackId !== null);
  const canEditSelection = useProjectStore((s) => {
    const sel = s.selectedClip;
    const track = sel && s.project?.tracks.find((t) => t.id === sel.trackId);
    return !!track && s.canEditClips(track);
  });
  if (!project) return null;

  const canEditAny = project.tracks.some((t) => useProjectStore.getState().canEditClips(t));
  const clipTools = canEditSelection && !!selectedClip && !recording;

  return (
    <div className="edit-toolbar">
      {canEditAny && (
        <>
          <div className="lg">
            <button className="lb" onClick={undo} disabled={historyCounts.undo === 0 || recording} title="Undo (⌘Z)" aria-label="Undo">
              <UndoIcon size={14} />
            </button>
            <button
              className="lb flip"
              onClick={redo}
              disabled={historyCounts.redo === 0 || recording}
              title="Redo (⇧⌘Z)"
              aria-label="Redo"
            >
              <UndoIcon size={14} />
            </button>
          </div>
          <div className="lg">
            <button className="lb" onClick={splitSelected} disabled={!clipTools} title="Split at playhead (S)" aria-label="Split">
              <CutIcon size={14} />
            </button>
            <button className="lb" onClick={duplicateSelected} disabled={!clipTools} title="Duplicate (⌘D)" aria-label="Duplicate">
              <DuplicateIcon size={14} />
            </button>
            <button className="lb" onClick={deleteSelected} disabled={!clipTools} title="Delete (⌫)" aria-label="Delete">
              <TrashIcon size={14} />
            </button>
          </div>
          <div className="lg">
            <button
              className={snapEnabled ? "lb on" : "lb"}
              onClick={() => setSnapEnabled(!snapEnabled)}
              title={snapEnabled ? "Snap on — hold Alt to drag freely" : "Snap off"}
              aria-pressed={snapEnabled}
              aria-label="Snap to grid"
            >
              <MagnetIcon size={14} />
            </button>
            <select
              className="snap-select"
              value={snapResolution}
              disabled={!snapEnabled}
              onChange={(e) => setSnapResolution(e.target.value as SnapResolution)}
              aria-label="Snap resolution"
            >
              {SNAP_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </>
      )}

      {!canMix && (
        <div className="lg listen-mode" title="What you hear while you play">
          <button className={listeningMode === "monitor" ? "lb wide on" : "lb wide"} onClick={() => setListeningMode("monitor")}>
            My monitor
          </button>
          <button className={listeningMode === "final" ? "lb wide on" : "lb wide"} onClick={() => setListeningMode("final")}>
            Final mix
          </button>
        </div>
      )}

      {!isInitiator && personalOrder && (
        <button className="lb wide reset-order" onClick={resetOrder} title="Go back to the order the initiator set">
          Reset order
        </button>
      )}

      <div className="lg">
        <button className="lb" onClick={() => setPxPerBeat(pxPerBeat / 1.25)} aria-label="Zoom out" title="Zoom out">
          −
        </button>
        <button className="lb" onClick={() => setPxPerBeat(pxPerBeat * 1.25)} aria-label="Zoom in" title="Zoom in">
          +
        </button>
      </div>
    </div>
  );
}
