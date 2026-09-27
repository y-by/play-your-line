import { useState } from "react";
import type { Track } from "../../types/project";
import { TRACK_COLORS } from "../../lib/trackColors";
import { gainToDb, dbToGain, MIN_DB, MAX_DB } from "../../lib/dbFader";
import { ChannelMeter } from "./ChannelMeter";
import { useProjectStore } from "../../store/useProjectStore";
import { XmarkCircleIcon, MicIcon } from "../icons/Icons";

/** The left-hand column of a lane: who plays it, record, mute/solo, volume. */
export function ChannelInfo({ track, number, onGripDown }: { track: Track; number: number; onGripDown?: (e: React.PointerEvent) => void }) {
  const removeTrack = useProjectStore((s) => s.removeTrack);
  const claimChannel = useProjectStore((s) => s.claimChannel);
  const setChannelVolume = useProjectStore((s) => s.setChannelVolume);
  const toggleChannelMute = useProjectStore((s) => s.toggleChannelMute);
  const toggleChannelSolo = useProjectStore((s) => s.toggleChannelSolo);
  const recordingTrackId = useProjectStore((s) => s.recordingTrackId);
  const recordingPhase = useProjectStore((s) => s.recordingPhase);
  const canEdit = useProjectStore((s) => s.canEditClips(track));
  const isInitiator = useProjectStore((s) => s.isInitiator());
  const canAdjustMix = useProjectStore((s) => s.canAdjustMix());
  const setTrackColor = useProjectStore((s) => s.setTrackColor);
  const online = useProjectStore((s) => !!track.assignedUserId && s.presentUsers.some((u) => u.userId === track.assignedUserId));
  const [pickingColor, setPickingColor] = useState(false);
  const armTrack = useProjectStore((s) => s.armTrack);
  const armed = useProjectStore((s) => canEdit && s.effectiveArmedId() === track.id);
  // Subscribing to these makes the sliders follow the right mix (saved / monitor); effectiveMix does the choosing.
  useProjectStore((s) => s.monitor);
  useProjectStore((s) => s.localSolo);
  useProjectStore((s) => s.listeningMode);
  const mix = useProjectStore.getState().effectiveMix(track);

  const isThisTrack = recordingTrackId === track.id;
  const isConnecting = isThisTrack && recordingPhase === "requesting-mic";
  const isCountingIn = isThisTrack && recordingPhase === "count-in";
  const isRecording = isThisTrack && recordingPhase === "recording";
  const isUploading = isThisTrack && recordingPhase === "uploading";

  const status = isConnecting
    ? "Connecting to microphone…"
    : isCountingIn
      ? "Count-in… get ready"
      : isRecording
        ? "Recording…"
        : isUploading
          ? "Saving take…"
          : null;

  const playerName = track.assignedPlayerName ?? (track.assignedUserId ? "Player" : "Unclaimed");

  return (
    <div className="arr-info" style={{ "--track-color": track.color } as React.CSSProperties}>
      <div className="info-number">
        <button className="info-number-btn" onClick={() => setPickingColor((v) => !v)} title="Change colour" aria-label="Change colour">
          {number}
        </button>
        {onGripDown && (
          <span className="info-grip" onPointerDown={onGripDown} title="Drag to reorder" aria-label="Drag to reorder">
            ⋮⋮
          </span>
        )}
      </div>
      {pickingColor ? (
        <div className="info-main color-picker" role="group" aria-label="Pick a colour">
          {TRACK_COLORS.map((c) => (
            <button
              key={c}
              className={c === track.color ? "swatch selected" : "swatch"}
              style={{ background: c }}
              onClick={() => {
                void setTrackColor(track.id, c);
                setPickingColor(false);
              }}
              aria-label={`Colour ${c}`}
            />
          ))}
          <button className="swatch-close" onClick={() => setPickingColor(false)} aria-label="Cancel">
            ✕
          </button>
        </div>
      ) : (
      <div className="info-main">
        <div className="info-top">
          <span className="info-instrument">{track.instrument}</span>
          <span className={track.assignedUserId ? "info-name" : "info-name unclaimed"}>
            {online && <span className="online-dot" title={`${playerName} is here`} />}
            {playerName}
          </span>
          <span className="info-actions">
            {isInitiator && !track.assignedUserId && (
              <button className="info-chip" onClick={() => claimChannel(track.id)} title="Take this channel and play it yourself">
                <MicIcon size={12} />
                <span className="chip-label">Play it</span>
              </button>
            )}
            {isInitiator && track.clips.length === 0 && (
              <button className="remove-btn" onClick={() => removeTrack(track.id)} title="Remove channel" aria-label="Remove channel">
                <XmarkCircleIcon size={16} />
              </button>
            )}
          </span>
        </div>

        <div className="info-controls">
          {canEdit && (
            <button
              className={armed ? "arm-btn on" : "arm-btn"}
              onClick={() => armTrack(track.id)}
              disabled={!!recordingTrackId}
              title={
                recordingTrackId
                  ? "Can't change while a recording is in progress"
                  : armed
                    ? "Record goes to this channel"
                    : "Choose this channel for Record"
              }
              aria-pressed={armed}
              aria-label="Arm for recording"
            >
              <span className="arm-dot" />
            </button>
          )}
          <button
            className={mix.muted ? "strip-btn mute on" : "strip-btn mute"}
            disabled={!canAdjustMix}
            onClick={() => toggleChannelMute(track.id)}
            title="Mute"
            aria-label="Mute"
            aria-pressed={mix.muted}
          >
            M
          </button>
          <button
            className={mix.solo ? "strip-btn solo on" : "strip-btn solo"}
            onClick={() => toggleChannelSolo(track.id)}
            title="Solo (only you hear this — never saved)"
            aria-label="Solo"
            aria-pressed={mix.solo}
          >
            S
          </button>
          <input
            className="volume-slider info-volume"
            type="range"
            min={MIN_DB}
            max={MAX_DB}
            step={1}
            value={Math.round(gainToDb(mix.volume))}
            disabled={!canAdjustMix}
            onChange={(e) => setChannelVolume(track.id, dbToGain(Number(e.target.value)))}
            aria-label="Volume in decibels"
            title={`${Math.round(gainToDb(mix.volume))} dB — 0 dB is unity, resting near the top of the fader`}
          />
        </div>
        <ChannelMeter trackId={track.id} armed={armed} />
      </div>
      )}
      {status && <div className="info-status">{status}</div>}
    </div>
  );
}
