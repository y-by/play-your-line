import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useProjectStore } from "../../store/useProjectStore";
import { barSec, beatSec } from "../../lib/grid";
import { clipsEnd } from "../../lib/clips";
import { defaultOrder, orderTracks } from "../../lib/trackOrder";
import { ChannelLane } from "./ChannelLane";
import { Ruler } from "./Ruler";

const MIN_BARS = 16;

/** The whole timeline: shared ruler, one lane per channel, a playhead across all of them. */
export function Arrangement() {
  const project = useProjectStore((s) => s.project);
  const positionSec = useProjectStore((s) => s.positionSec);
  const followPlayhead = useProjectStore((s) => s.followPlayhead);
  const recordingTrackId = useProjectStore((s) => s.recordingTrackId);
  const pxPerBeat = useProjectStore((s) => s.pxPerBeat);
  const scrollRef = useRef<HTMLDivElement>(null);
  const personalOrder = useProjectStore((s) => s.personalOrder);
  const personalColors = useProjectStore((s) => s.personalColors);
  const loop = useProjectStore((s) => s.loop);
  const loopEnabled = useProjectStore((s) => s.loopEnabled);
  const pendingScroll = useRef<number | null>(null);
  const isInitiator = useProjectStore((s) => s.isInitiator());
  const moveTrack = useProjectStore((s) => s.moveTrack);
  const [drag, setDrag] = useState<{ id: string; from: number; to: number; dy: number } | null>(null);

  // The initiator's order is the song's default; everyone else sees their own arrangement on top of it.
  const tracks = project?.tracks;
  const ordered = useMemo(() => {
    if (!tracks) return [];
    // A player's own colour choice only changes how they see the channel.
    return orderTracks(tracks, isInitiator ? null : personalOrder).map((t) =>
      !isInitiator && personalColors[t.id] ? { ...t, color: personalColors[t.id] } : t
    );
  }, [tracks, isInitiator, personalOrder, personalColors]);
  // Channel numbers follow the default order, so "channel 3" means the same channel to everyone.
  const numbers = useMemo(() => new Map((tracks ? defaultOrder(tracks) : []).map((t, i) => [t.id, i + 1])), [tracks]);

  const startDrag = (e: React.PointerEvent, id: string, from: number) => {
    e.preventDefault();
    const laneEl = scrollRef.current?.querySelector(".lane");
    const laneH = laneEl?.getBoundingClientRect().height || 64;
    const startY = e.clientY;
    const last = ordered.length - 1;
    let to = from;
    setDrag({ id, from, to, dy: 0 });
    const move = (ev: PointerEvent) => {
      const dy = ev.clientY - startY;
      to = Math.max(0, Math.min(last, Math.round(from + dy / laneH)));
      setDrag({ id, from, to, dy });
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      setDrag(null);
      if (to !== from) void moveTrack(id, to);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };

  const laneStyle = (id: string, index: number): React.CSSProperties | undefined => {
    if (!drag) return undefined;
    if (drag.id === id) return { transform: `translateY(${drag.dy}px)`, zIndex: 5, boxShadow: "0 4px 18px rgba(0,0,0,0.5)", transition: "none" };
    if (drag.from < drag.to && index > drag.from && index <= drag.to) return { transform: `translateY(-100%)`, transition: "transform 0.12s" };
    if (drag.from > drag.to && index >= drag.to && index < drag.from) return { transform: `translateY(100%)`, transition: "transform 0.12s" };
    return { transition: "transform 0.12s" };
  };

  const bpm = project?.bpm ?? 120;
  const pxPerSec = pxPerBeat / beatSec(bpm);
  const beatsPerBar = useProjectStore((s) => s.project?.beatsPerBar ?? 4);
  const barPx = pxPerBeat * beatsPerBar;

  const songEnd = project ? project.tracks.reduce((m, t) => Math.max(m, clipsEnd(t.clips)), 0) : 0;
  // While recording, the grid keeps growing ahead of the playhead, so it never runs out under a long take.
  const reachSec = recordingTrackId ? Math.max(songEnd, positionSec) : songEnd;
  const totalBars = Math.max(MIN_BARS, Math.ceil(reachSec / barSec(bpm, beatsPerBar)) + 4);
  const timelinePx = totalBars * barPx;

  // With "follow playhead" on, the playhead stays in the middle of the timeline and the song moves under it
  // (until the start is reached: the view cannot scroll left of bar 1, so there the playhead walks to the middle first).
  // Switching it on glides the view to its place instead of cutting there.
  const centreTarget = (el: HTMLElement, sec: number, pps: number) => {
    const infoW = parseFloat(getComputedStyle(el).getPropertyValue("--info-w")) || 224;
    return Math.max(0, sec * pps - (el.clientWidth - infoW) / 2);
  };
  const live = useRef({ sec: positionSec, pps: pxPerSec });
  useEffect(() => {
    live.current = { sec: positionSec, pps: pxPerSec };
  }, [positionSec, pxPerSec]);
  const gliding = useRef(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !followPlayhead) return;
    const start = el.scrollLeft;
    let began = -1;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (still || Math.abs(centreTarget(el, live.current.sec, live.current.pps) - start) < 4) return;
    gliding.current = true;
    let frame = 0;
    const step = (now: number) => {
      if (began < 0) began = now;
      const t = Math.min(1, (now - began) / 450);
      const ease = 1 - Math.pow(1 - t, 3);
      const target = centreTarget(el, live.current.sec, live.current.pps);
      el.scrollLeft = start + (target - start) * ease;
      if (t < 1) frame = requestAnimationFrame(step);
      else gliding.current = false;
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      gliding.current = false;
    };
  }, [followPlayhead]);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !followPlayhead || gliding.current) return;
    el.scrollLeft = centreTarget(el, positionSec, pxPerSec);
  }, [positionSec, pxPerSec, followPlayhead]);

  // Pinch to zoom on a trackpad (and Ctrl + scroll wheel). The moment under
  // your fingers stays put while the timeline stretches around it.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const infoWidth = () => parseFloat(getComputedStyle(el).getPropertyValue("--info-w")) || 224;
    const zoomBy = (factor: number, clientX: number) => {
      const s = useProjectStore.getState();
      const secPerBeat = beatSec(s.project?.bpm ?? 120);
      const cursorX = clientX - el.getBoundingClientRect().left;
      const time = (el.scrollLeft + cursorX - infoWidth()) / (s.pxPerBeat / secPerBeat);
      s.setPxPerBeat(s.pxPerBeat * factor);
      const newPxPerSec = useProjectStore.getState().pxPerBeat / secPerBeat;
      pendingScroll.current = time * newPxPerSec + infoWidth() - cursorX;
    };
    // Chrome / Firefox report a trackpad pinch as a wheel event with Ctrl held.
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      zoomBy(Math.exp(-e.deltaY * 0.015), e.clientX);
    };
    // Safari reports it as gesture events instead.
    let lastScale = 1;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      lastScale = 1;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const g = e as Event & { scale: number; clientX: number };
      zoomBy(g.scale / lastScale, g.clientX);
      lastScale = g.scale;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("gesturestart", onGestureStart);
    el.addEventListener("gesturechange", onGestureChange);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", onGestureStart);
      el.removeEventListener("gesturechange", onGestureChange);
    };
  }, []);

  // After the timeline has been resized, put the scroll position where the zoom asked for.
  useLayoutEffect(() => {
    if (pendingScroll.current === null || !scrollRef.current) return;
    scrollRef.current.scrollLeft = Math.max(0, pendingScroll.current);
    pendingScroll.current = null;
  }, [pxPerBeat]);

  // Keyboard shortcuts (ignored while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        // Sliders are inputs but should not swallow Space.
        if (!(target instanceof HTMLInputElement && target.type === "range")) return;
      }
      const s = useProjectStore.getState();
      const meta = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (key === " ") {
        e.preventDefault();
        if (s.recordingTrackId) {
          void s.stopRecording();
          return;
        }
        if (s.isPlaying) s.pause();
        else s.play();
      } else if (key === "enter") {
        if (!s.recordingTrackId) {
          e.preventDefault();
          s.seek(0);
        }
      } else if (!meta && key === "r") {
        s.toggleRecord();
      } else if (meta && key === "z") {
        e.preventDefault();
        if (e.shiftKey) void s.redo();
        else void s.undo();
      } else if (meta && key === "d") {
        e.preventDefault();
        void s.duplicateSelected();
      } else if (!meta && key === "s") {
        void s.splitSelected();
      } else if (key === "delete" || key === "backspace") {
        if (s.selectedClip) {
          e.preventDefault();
          void s.deleteSelected();
        }
      } else if (key === "arrowleft" || key === "arrowright") {
        if (s.selectedClip) {
          e.preventDefault();
          void s.nudgeSelected(key === "arrowleft" ? -1 : 1, e.altKey);
        }
      } else if (key === "escape") {
        s.selectClip(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!project) return null;

  const gridStyle = {
    "--bar-px": `${barPx}px`,
    "--beat-px": `${pxPerBeat}px`,
    "--step-px": `${pxPerBeat / 4}px`,
    "--show-steps": pxPerBeat / 4 >= 10 ? 1 : 0,
  } as React.CSSProperties;

  return (
    <div className="arrangement">
      <div className="arr-scroll" ref={scrollRef}>
        <div className={pxPerBeat / 4 >= 10 ? "arr-inner fine-grid" : "arr-inner"} style={gridStyle}>
          <Ruler totalBars={totalBars} barPx={barPx} pxPerSec={pxPerSec} />
          {ordered.map((track, index) => (
            <ChannelLane
              key={track.id}
              track={track}
              number={numbers.get(track.id) ?? index + 1}
              style={laneStyle(track.id, index)}
              onGripDown={ordered.length > 1 ? (e) => startDrag(e, track.id, index) : undefined}
              pxPerSec={pxPerSec}
              timelinePx={timelinePx}
            />
          ))}
          {loop && (
            <div
              className={loopEnabled ? "arr-loop-band on" : "arr-loop-band"}
              style={{
                left: `calc(var(--info-w) + ${loop.startBeat * pxPerBeat}px)`,
                width: (loop.endBeat - loop.startBeat) * pxPerBeat,
              }}
            />
          )}
          <div className="arr-playhead" style={{ left: `calc(var(--info-w) + ${positionSec * pxPerSec}px)` }} />
        </div>
      </div>
    </div>
  );
}
