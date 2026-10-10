import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useProjectStore } from "../../store/useProjectStore";
import { MASTER_LEFT, MASTER_RIGHT } from "../../lib/audioEngine";
import { dbToGain, gainToDb, MAX_DB, MIN_DB, peakToDb } from "../../lib/dbFader";
import { canAnchor } from "../../lib/anchor";
import { Column } from "./ChannelMeter";
import { FaderScale } from "./FaderScale";
import { MasterTools } from "./MasterTools";
import { MasterWave } from "./MasterWave";

/**
 * The master channel, pinned under the last channel: a fader, a left and right level meter with a clip light,
 * mute, and the Tools button (EQ, Compressor, Limiter on the whole song). The Owner and the Mixer change it;
 * everyone hears it but only they see it. The fader only turns the song down.
 */
export function MasterStrip({ timelinePx, pxPerSec }: { timelinePx: number; pxPerSec: number }) {
  const master = useProjectStore((s) => s.project?.master);
  const muted = useProjectStore((s) => s.masterMuted);
  const canMix = useProjectStore((s) => s.canMix());
  const setVolume = useProjectStore((s) => s.setMasterVolume);
  const toggleMute = useProjectStore((s) => s.toggleMasterMute);
  const peakL = useProjectStore((s) => s.trackPeaks[MASTER_LEFT] ?? 0);
  const peakR = useProjectStore((s) => s.trackPeaks[MASTER_RIGHT] ?? 0);
  const outOfDate = useProjectStore((s) => s.isInitiator() && !!s.project?.previewPath && !!s.project?.previewStale);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  const [clipped, setClipped] = useState(false);
  const toolsBtn = useRef<HTMLButtonElement>(null);

  // The clip light stays on until it is clicked, so a short peak is not missed.
  useEffect(
    () =>
      useProjectStore.subscribe((s) => {
        if (Math.max(s.trackPeaks[MASTER_LEFT] ?? 0, s.trackPeaks[MASTER_RIGHT] ?? 0) >= 0.995) setClipped(true);
      }),
    []
  );

  // Only the Owner and the Mixer see the master; everyone else just hears it.
  if (!master || !canMix) return null;
  const db = Math.round(gainToDb(master.volume));
  const fxLive = master.fx.fxOn;

  return (
    <div className="arr-row master-row">
      <div className="arr-info master-info">
        <div className="master-head">
          <b>Master</b>
          {outOfDate && (
            <span className="master-stale" title="The master changed after the listening copy was made. Update the copy from the project list (the refresh button on the card) so Published Projects plays the latest mix.">
              copy out of date
            </span>
          )}
          <span className="master-db">{master.volume <= 0.0011 ? "−∞" : `${db} dB`}</span>
          <button className={clipped ? "master-clip on" : "master-clip"} onClick={() => setClipped(false)} title={clipped ? "The master reached its limit (clip). Click to clear." : "Lights up if the master reaches its limit"} aria-label="Clip light">
            clip
          </button>
        </div>
        <div className="master-controls">
          <div className="chan-meter-v split master-meter" title="The whole song's level, left and right (red = about to clip)">
            <div className="chan-meter-side">
              <Column db={peakToDb(peakL)} />
            </div>
            <div className="chan-meter-side">
              <Column db={peakToDb(peakR)} />
            </div>
          </div>
          <button
            className={muted ? "strip-btn mute on" : "strip-btn mute"}
            disabled={!canMix}
            onClick={toggleMute}
            title={muted ? "Master mute is on: you hear nothing. Only you: nobody else is affected. Click to hear again." : "Master mute: silence the whole song for you only (not saved, not in an export)"}
            aria-pressed={muted}
            aria-label="Master mute"
          >
            M
          </button>
          <div className="fader master-fader">
            <input
              className="volume-slider info-volume"
              type="range"
              min={MIN_DB}
              max={MAX_DB}
              step={1}
              value={Math.min(0, db)}
              disabled={!canMix}
              // Same travel and scale as a channel fader, so 0 dB is in the same place; the master stops there: it only turns the song down.
              onChange={(e) => setVolume(dbToGain(Math.min(0, Number(e.target.value))))}
              aria-label="Master volume in decibels"
              title={canMix ? `${db} dB — the master only turns the whole song down (0 dB is the top)` : `${db} dB — only the Owner and the Mixer can change the master`}
            />
            <FaderScale />
          </div>
          <button
            ref={toolsBtn}
            className={`fx-toggle${anchor ? " on" : ""}${fxLive ? " live" : ""}`}
            style={canAnchor() ? ({ anchorName: "--fx-master" } as React.CSSProperties) : undefined}
            onClick={() => {
              if (anchor) {
                setAnchor(null);
                return;
              }
              const r = toolsBtn.current?.getBoundingClientRect();
              if (r) setAnchor({ top: Math.max(8, r.top - 340), left: Math.max(8, Math.min(r.left - 120, window.innerWidth - 340)) });
            }}
            title={fxLive ? "Tools — the master effects are on (EQ, Compressor, Limiter)" : "Tools — the master effects are off (EQ, Compressor, Limiter)"}
            aria-pressed={!!anchor}
            aria-label="Master tools"
          >
            Tools
          </button>
        </div>
      </div>
      <div className="arr-lane master-lane" style={{ width: timelinePx }}>
        <MasterWave pxPerSec={pxPerSec} />
      </div>
      {anchor && createPortal(<MasterTools initialAnchor={anchor} onClose={() => setAnchor(null)} />, document.body)}
    </div>
  );
}
