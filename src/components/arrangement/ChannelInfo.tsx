import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Track } from "../../types/project";
import { TRACK_COLORS } from "../../lib/trackColors";
import { gainToDb, dbToGain, MIN_DB, MAX_DB } from "../../lib/dbFader";
import { ChannelMeter } from "./ChannelMeter";
import { FaderScale } from "./FaderScale";
import { ChannelFx } from "./ChannelFx";
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
  const isParticipant = useProjectStore((s) => s.isParticipant());
  const canAdjustMix = useProjectStore((s) => s.canAdjustMix());
  const setTrackColor = useProjectStore((s) => s.setTrackColor);
  const renameTrack = useProjectStore((s) => s.renameTrack);
  const [editingInstrument, setEditingInstrument] = useState(false);
  const online = useProjectStore((s) => !!track.assignedUserId && s.presentUsers.some((u) => u.userId === track.assignedUserId));
  const [pickingColor, setPickingColor] = useState(false);
  const [fxAnchor, setFxAnchor] = useState<{ top: number; left: number } | null>(null);
  const fxButtonRef = useRef<HTMLButtonElement>(null);
  const canUseFx = useProjectStore((s) => s.canUseFx(track));
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
      {!pickingColor && <ChannelMeter trackId={track.id} armed={armed} />}
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
          {editingInstrument ? (
            <input
              autoFocus
              className="info-instrument-input"
              defaultValue={track.instrument}
              onBlur={(e) => {
                void renameTrack(track.id, e.target.value);
                setEditingInstrument(false);
              }}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <button
              className={isParticipant ? "info-instrument" : "info-instrument readonly"}
              onClick={() => isParticipant && setEditingInstrument(true)}
              title={isParticipant ? "Rename this channel" : undefined}
            >
              {track.instrument}
            </button>
          )}
          <span className={status ? "info-name status" : track.assignedUserId ? "info-name" : "info-name unclaimed"}>
            {online && !status && <span className="online-dot" title={`${playerName} is here`} />}
            {status ?? playerName}
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
          <div className="fader">
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
            <FaderScale />
          </div>
          {canUseFx && (
            <button
              ref={fxButtonRef}
              className={fxAnchor ? "fx-toggle on" : "fx-toggle"}
              onClick={() => {
                if (fxAnchor) {
                  setFxAnchor(null);
                  return;
                }
                // Rendered in a portal (see below) — the lanes scroll inside a
                // container with overflow-y:hidden, which would otherwise clip
                // a panel taller than one channel strip right off the screen.
                const rect = fxButtonRef.current?.getBoundingClientRect();
                if (rect) setFxAnchor({ top: rect.bottom + 4, left: rect.left });
              }}
              title="EQ, Compressor, Delay and Reverb"
              aria-pressed={!!fxAnchor}
              aria-label="Channel effects"
            >
              FX
            </button>
          )}
        </div>
        {fxAnchor && createPortal(<ChannelFx track={track} initialAnchor={fxAnchor} onClose={() => setFxAnchor(null)} />, document.body)}
      </div>
      )}
    </div>
  );
}
