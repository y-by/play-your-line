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
 * The master channel, pinned to the bottom of the screen above the notes bar, so nothing covers it: a fader, a left and right level meter with a clip light,
 * mute, and the Tools button (EQ, Compressor, Limiter on the whole song). The Owner and the Mixer change it;
 * everyone hears it but only they see it. The fader only turns the song down.
 */
export function MasterStrip({
  scrollRef,
  timelinePx,
  pxPerSec,
  onPointerDownCapture,
  onDoubleClick,
}: {
  /** The timeline the master's track follows sideways. */
  scrollRef: React.RefObject<HTMLDivElement | null>;
  timelinePx: number;
  pxPerSec: number;
  onPointerDownCapture: (e: React.PointerEvent) => void;
  onDoubleClick: (e: React.MouseEvent) => void;
}) {
  const master = useProjectStore((s) => s.project?.master);
  const muted = useProjectStore((s) => s.masterMuted);
  const laneScale = useProjectStore((s) => s.laneScales.master ?? 1);
  const canMix = useProjectStore((s) => s.canMix());
  const setVolume = useProjectStore((s) => s.setMasterVolume);
  const toggleMute = useProjectStore((s) => s.toggleMasterMute);
  const peakL = useProjectStore((s) => s.trackPeaks[MASTER_LEFT] ?? 0);
  const peakR = useProjectStore((s) => s.trackPeaks[MASTER_RIGHT] ?? 0);
  const outOfDate = useProjectStore((s) => s.isInitiator() && !!s.project?.previewPath && !!s.project?.previewStale);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  const [clipped, setClipped] = useState(false);
  const toolsBtn = useRef<HTMLButtonElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const playhead = useProjectStore((s) => s.positionSec);
  const visible = !!master && canMix;

  // The strip sits at the bottom of the screen, over the width of the timeline; its track slides sideways with the timeline.
  useEffect(() => {
    const scroller = scrollRef.current;
    const el = dock.current;
    if (!visible || !scroller || !el) return;
    const place = () => {
      const r = scroller.getBoundingClientRect();
      el.style.left = `${r.left}px`;
      el.style.width = `${r.width}px`;
      // Room under the channels, so the last one is not hidden behind the strip.
      document.documentElement.style.setProperty("--master-dock-h", `${el.getBoundingClientRect().height}px`);
    };
    const follow = () => {
      if (track.current) track.current.style.transform = `translateX(${-scroller.scrollLeft}px)`;
    };
    place();
    follow();
    scroller.addEventListener("scroll", follow, { passive: true });
    window.addEventListener("resize", place);
    const observer = new ResizeObserver(place);
    observer.observe(scroller);
    observer.observe(el);
    return () => {
      scroller.removeEventListener("scroll", follow);
      window.removeEventListener("resize", place);
      observer.disconnect();
      document.documentElement.style.removeProperty("--master-dock-h");
    };
  }, [visible, scrollRef]);

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
    <div ref={dock} className="master-dock" onPointerDownCapture={onPointerDownCapture} onDoubleClick={onDoubleClick}>
    <div className="arr-row master-row" data-lane-id="master" style={{ "--lane-scale": laneScale } as React.CSSProperties}>
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
      <div className="master-track">
        <div ref={track} className="arr-lane master-lane" style={{ width: timelinePx }}>
          <MasterWave pxPerSec={pxPerSec} />
          <div className="master-playhead" style={{ left: playhead * pxPerSec }} />
        </div>
      </div>
      {anchor && createPortal(<MasterTools initialAnchor={anchor} onClose={() => setAnchor(null)} />, document.body)}
    </div>
    </div>
  );
}
