import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Group, Track } from "../../types/project";
import { useProjectStore } from "../../store/useProjectStore";
import { groupLevelKey } from "../../lib/audioEngine";
import { dbToGain, gainToDb, MAX_DB, MIN_DB, peakToDb } from "../../lib/dbFader";
import { canAnchor } from "../../lib/anchor";
import { Column } from "./ChannelMeter";
import { FaderScale } from "./FaderScale";
import { PanKnob } from "./PanKnob";
import { GroupTools } from "./GroupTools";

/**
 * A group channel's row, above the channels in it: a fold arrow, its name, a level meter, mute and solo, a fader, a
 * pan knob and a Tools button. The Owner makes and renames groups; the Owner and the Mixer set the mix; everyone
 * hears it (anyone can fold a group and solo it for themselves). A folded group shows only this row.
 */
export function GroupRow({ group, members, timelinePx }: { group: Group; members: Track[]; timelinePx: number }) {
  const canMix = useProjectStore((s) => s.canMix());
  const isOwner = useProjectStore((s) => s.isInitiator());
  const folded = useProjectStore((s) => !!s.collapsedGroups[group.id]);
  const solo = useProjectStore((s) => !!s.localSolo[group.id]);
  const peak = useProjectStore((s) => s.trackPeaks[groupLevelKey(group.id)] ?? 0);
  const toggleFold = useProjectStore((s) => s.toggleGroupCollapsed);
  const toggleMute = useProjectStore((s) => s.toggleGroupMute);
  const toggleSolo = useProjectStore((s) => s.toggleGroupSolo);
  const setVolume = useProjectStore((s) => s.setGroupVolume);
  const setPan = useProjectStore((s) => s.setGroupPan);
  const rename = useProjectStore((s) => s.renameGroup);
  const remove = useProjectStore((s) => s.deleteGroup);
  const [editing, setEditing] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  const toolsBtn = useRef<HTMLButtonElement>(null);
  const db = Math.round(gainToDb(group.volume));
  const names = members.map((m) => m.instrument).join(", ");

  return (
    <div className="arr-row group-row" style={{ "--group-color": group.color } as React.CSSProperties}>
      <div className="arr-info group-info">
        <div className="group-head">
          <button className="group-fold" onClick={() => toggleFold(group.id)} aria-expanded={!folded} title={folded ? "Show the channels in this group" : "Fold the group: show only this row"} aria-label={folded ? "Unfold the group" : "Fold the group"}>
            {folded ? "▸" : "▾"}
          </button>
          {editing ? (
            <input
              autoFocus
              className="info-instrument-input"
              defaultValue={group.name}
              maxLength={40}
              onBlur={(e) => {
                void rename(group.id, e.target.value);
                setEditing(false);
              }}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            />
          ) : (
            <button className={isOwner ? "group-name" : "group-name readonly"} onClick={() => isOwner && setEditing(true)} title={isOwner ? "Rename this group" : names || group.name}>
              {group.name}
            </button>
          )}
          <span className="group-count" title={names}>
            {members.length} {members.length === 1 ? "channel" : "channels"}
          </span>
          {isOwner && (
            <button
              className="group-delete"
              onClick={() => {
                if (confirm(`Delete the group "${group.name}"?\n\nIts ${members.length === 1 ? "channel stays" : `${members.length} channels stay`} and play straight to the master. Nothing is lost.`)) void remove(group.id);
              }}
              title="Delete this group (its channels stay)"
              aria-label="Delete the group"
            >
              ✕
            </button>
          )}
        </div>
        <div className="group-controls">
          <div className="chan-meter-v master-meter" title="This group's level (red = about to clip)">
            <Column db={peakToDb(peak)} />
          </div>
          <button className={group.muted ? "strip-btn mute on" : "strip-btn mute"} disabled={!canMix} onClick={() => toggleMute(group.id)} title={group.muted ? "Group muted: nothing in it plays (unless something in it is soloed)" : "Mute this group"} aria-pressed={group.muted} aria-label="Mute the group">
            M
          </button>
          <button className={solo ? "strip-btn solo on" : "strip-btn solo"} onClick={() => toggleSolo(group.id)} title="Solo: hear only this group. Only you hear this — it is never saved." aria-pressed={solo} aria-label="Solo the group">
            S
          </button>
          {canMix && (
            <>
              <div className="fader master-fader">
                <input
                  className="volume-slider info-volume"
                  type="range"
                  min={MIN_DB}
                  max={MAX_DB}
                  step={1}
                  value={db}
                  onChange={(e) => setVolume(group.id, dbToGain(Number(e.target.value)))}
                  aria-label="Group volume in decibels"
                  title={`${db} dB — 0 dB is unity`}
                />
                <FaderScale />
              </div>
              <PanKnob value={group.pan} disabled={false} onChange={(v) => setPan(group.id, v)} />
              <button
                ref={toolsBtn}
                className={`fx-toggle${anchor ? " on" : ""}${group.fx.fxOn ? " live" : ""}`}
                style={canAnchor() ? ({ anchorName: `--fx-${group.id}` } as React.CSSProperties) : undefined}
                onClick={() => {
                  if (anchor) {
                    setAnchor(null);
                    return;
                  }
                  const r = toolsBtn.current?.getBoundingClientRect();
                  if (r) setAnchor({ top: Math.max(8, r.bottom + 4), left: Math.max(8, Math.min(r.left - 120, window.innerWidth - 340)) });
                }}
                title={group.fx.fxOn ? "Tools — this group's effects are on" : "Tools — this group's effects are off"}
                aria-pressed={!!anchor}
                aria-label="Group tools"
              >
                Tools
              </button>
            </>
          )}
        </div>
      </div>
      <div className="arr-lane group-lane" style={{ width: timelinePx }}>
        <span className="lane-hint">{names ? `${group.name}: ${names}` : "No channels in this group yet"}</span>
      </div>
      {anchor && createPortal(<GroupTools groupId={group.id} initialAnchor={anchor} onClose={() => setAnchor(null)} />, document.body)}
    </div>
  );
}
