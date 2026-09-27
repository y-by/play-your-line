import { useState } from "react";
import type { Track } from "../../types/project";
import { useProjectStore } from "../../store/useProjectStore";
import { snapTo, stepSec } from "../../lib/grid";
import { ChannelInfo } from "./ChannelInfo";
import { ClipView } from "./ClipView";

interface Props {
  track: Track;
  number: number;
  style?: React.CSSProperties;
  onGripDown?: (e: React.PointerEvent) => void;
  pxPerSec: number;
  timelinePx: number;
}

export function ChannelLane({ track, number, style, onGripDown, pxPerSec, timelinePx }: Props) {
  const project = useProjectStore((s) => s.project);
  const canEdit = useProjectStore((s) => s.canEditClips(track));
  const selectedClip = useProjectStore((s) => s.selectedClip);
  const selectClip = useProjectStore((s) => s.selectClip);
  const recordingTrackId = useProjectStore((s) => s.recordingTrackId);
  const importAudioFile = useProjectStore((s) => s.importAudioFile);
  const importing = useProjectStore((s) => s.importingTrackId === track.id);
  const [dragOver, setDragOver] = useState(false);
  if (!project) return null;

  // Lower z first so the newest clip is drawn on top.
  const clips = [...track.clips].sort((a, b) => a.z - b.z);
  const hint = importing
    ? "Adding your file…"
    : clips.length > 0
      ? null
      : track.assignedUserId
        ? canEdit
          ? "Press record, or drop an audio file, to add your first part"
          : "No recordings yet"
        : "Waiting for a player to join this channel";

  // Drop an audio file onto the grid: it lands at the drop position, snapped
  // to the grid the same way dragging a clip does (Alt for free placement).
  const dropAt = (e: React.DragEvent<HTMLDivElement>): number => {
    const rect = e.currentTarget.getBoundingClientRect();
    const raw = Math.max(0, (e.clientX - rect.left) / pxPerSec);
    const { snapEnabled, snapResolution } = useProjectStore.getState();
    if (!snapEnabled || e.altKey) return raw;
    return snapTo(raw, stepSec(project.bpm, snapResolution));
  };

  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!canEdit || !!recordingTrackId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDragOver(true);
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    setDragOver(false);
    if (!canEdit || !!recordingTrackId) return;
    const file = e.dataTransfer.files[0];
    if (!file) return;
    e.preventDefault();
    void importAudioFile(track.id, file, dropAt(e));
  };

  return (
    <div className="arr-row lane" style={{ "--track-color": track.color, ...style } as React.CSSProperties}>
      <ChannelInfo track={track} number={number} onGripDown={onGripDown} />
      <div
        className={["arr-lane", recordingTrackId === track.id && "recording", dragOver && "drop-target"].filter(Boolean).join(" ")}
        style={{ width: timelinePx }}
        onPointerDown={() => selectClip(null)}
        onDragOver={onDragOver}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        {hint && <span className="lane-hint">{hint}</span>}
        {clips.map((clip) => (
          <ClipView
            key={clip.id}
            track={track}
            clip={clip}
            take={project.takes[clip.takeId]}
            canEdit={canEdit}
            selected={selectedClip?.clipId === clip.id}
            pxPerSec={pxPerSec}
          />
        ))}
      </div>
    </div>
  );
}
