import { useRef, useState } from "react";
import type { Group, Track } from "../../types/project";
import { useProjectStore } from "../../store/useProjectStore";
import { snapTo, stepSec } from "../../lib/grid";
import { ChannelInfo } from "./ChannelInfo";
import { ClipView } from "./ClipView";
import { LiveRecordingClip } from "./LiveRecordingClip";
import { ChordStrip } from "./ChordStrip";

interface Props {
  track: Track;
  /** The group this channel is shown under (null = not in a group). */
  group?: Group | null;
  number: number;
  style?: React.CSSProperties;
  onGripDown?: (e: React.PointerEvent) => void;
  pxPerSec: number;
  timelinePx: number;
}

export function ChannelLane({ track, group, number, style, onGripDown, pxPerSec, timelinePx }: Props) {
  const project = useProjectStore((s) => s.project);
  const canEdit = useProjectStore((s) => s.canEditClips(track));
  const selectedClip = useProjectStore((s) => s.selectedClip);
  const selectClip = useProjectStore((s) => s.selectClip);
  const extraSelected = useProjectStore((s) => s.extraSelected);
  const recordingTrackId = useProjectStore((s) => s.recordingTrackId);
  const importAudioFile = useProjectStore((s) => s.importAudioFile);
  const importing = useProjectStore((s) => s.importingTrackId === track.id);
  const laneScale = useProjectStore((s) => s.laneScales[track.id] ?? 1);
  const [dragOver, setDragOver] = useState(false);
  const selectClips = useProjectStore((s) => s.selectClips);
  // Dragging across empty space draws a rectangle; the clips of this channel it touches get selected.
  const [marquee, setMarquee] = useState<{ x0: number; x1: number } | null>(null);
  const marqueeStart = useRef<{ x: number; left: number; add: boolean; moved: boolean } | null>(null);
  if (!project) return null;

  // Lower z first so the newest clip is drawn on top.
  const clips = [...track.clips].sort((a, b) => a.z - b.z);
  const hint = importing
    ? "Adding your file…"
    : recordingTrackId === track.id || clips.length > 0
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
    return snapTo(raw, stepSec(project.bpm, snapResolution, project.beatsPerBar));
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
    <div className={group ? "arr-row lane in-group" : "arr-row lane"} data-lane-id={track.id} style={{ "--track-color": track.color, "--lane-scale": laneScale, ...(group ? { "--group-color": group.color } : {}), ...style } as React.CSSProperties}>
      <ChannelInfo track={track} number={number} onGripDown={onGripDown} />
      <div
        className={["arr-lane", recordingTrackId === track.id && "recording", dragOver && "drop-target"].filter(Boolean).join(" ")}
        style={{ width: timelinePx }}
        onPointerDown={(e) => {
          // A mouse or pen drag on empty space selects clips; a touch, or someone who cannot edit here, just clears the selection.
          if (e.pointerType === "touch" || !canEdit || e.button !== 0) {
            selectClip(null);
            return;
          }
          const left = e.currentTarget.getBoundingClientRect().left;
          marqueeStart.current = { x: e.clientX - left, left, add: e.shiftKey || e.metaKey || e.ctrlKey, moved: false };
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // the rectangle still follows while the pointer stays over the channel
          }
        }}
        onPointerMove={(e) => {
          const m = marqueeStart.current;
          if (!m) return;
          const x = e.clientX - m.left;
          if (!m.moved && Math.abs(x - m.x) < 4) return;
          m.moved = true;
          setMarquee({ x0: Math.min(m.x, x), x1: Math.max(m.x, x) });
        }}
        onPointerUp={(e) => {
          const m = marqueeStart.current;
          marqueeStart.current = null;
          setMarquee(null);
          if (!m) return;
          if (!m.moved) {
            if (!m.add) selectClip(null);
            return;
          }
          const x = e.clientX - m.left;
          const from = Math.min(m.x, x) / pxPerSec;
          const to = Math.max(m.x, x) / pxPerSec;
          const hit = track.clips.filter((c) => c.startSec < to && c.startSec + c.durationSec > from).map((c) => c.id);
          selectClips(track.id, hit, m.add);
        }}
        onPointerCancel={() => {
          marqueeStart.current = null;
          setMarquee(null);
        }}
        onDragOver={onDragOver}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        {hint && <span className="lane-hint">{hint}</span>}
        {marquee && <div className="lane-marquee" style={{ left: marquee.x0, width: marquee.x1 - marquee.x0 }} />}
        {clips.map((clip) => (
          <ClipView
            key={clip.id}
            track={track}
            clip={clip}
            take={project.takes[clip.takeId]}
            canEdit={canEdit}
            selected={selectedClip?.clipId === clip.id || (selectedClip?.trackId === track.id && extraSelected.includes(clip.id))}
            pxPerSec={pxPerSec}
          />
        ))}
        <LiveRecordingClip track={track} pxPerSec={pxPerSec} />
        <ChordStrip track={track} pxPerSec={pxPerSec} />
      </div>
    </div>
  );
}
