import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useProjectStore } from "../../store/useProjectStore";
import { barSec, beatSec } from "../../lib/grid";
import { clipsEnd } from "../../lib/clips";
import { defaultOrder, orderTracks } from "../../lib/trackOrder";
import { ChannelLane } from "./ChannelLane";
import { MasterStrip } from "./MasterStrip";
import { GroupRow } from "./GroupRow";
import { buildRows, visibleLanes } from "../../lib/groups";
import { Ruler } from "./Ruler";

const MIN_BARS = 16;
const INFO_SCALE_KEY = "pyl.infoScale";
/** The channel control column can be made up to half as wide again as its normal width. */
const MAX_INFO_SCALE = 1.5;
/** A channel can be made taller than normal, up to twice (the master can also be a little lower). */
const MIN_LANE_SCALE = 1;
const MAX_LANE_SCALE = 2;
const MIN_MASTER_SCALE = 0.7;

function readInfoScale(): number {
  try {
    const v = Number(localStorage.getItem(INFO_SCALE_KEY));
    return v >= 1 && v <= MAX_INFO_SCALE ? v : 1;
  } catch {
    return 1;
  }
}

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
  const [infoScale, setInfoScale] = useState(readInfoScale);
  const setLaneScale = useProjectStore((s) => s.setLaneScale);

  // The control column's width: its normal width for this screen (the style sheet decides) times the chosen scale.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const apply = () => {
      el.style.removeProperty("--info-w");
      if (infoScale === 1) return;
      const base = parseFloat(getComputedStyle(el).getPropertyValue("--info-w"));
      if (base) el.style.setProperty("--info-w", `${Math.round(base * infoScale)}px`);
    };
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, [infoScale, project?.id]);

  // Drag the bottom edge of a channel (or of the master) to make that channel taller; double-click the edge for normal height.
  const onLaneEdgeDown = (e: React.PointerEvent): boolean => {
    const row = (e.target as HTMLElement).closest<HTMLElement>("[data-lane-id]");
    if (!row) return false;
    const r = row.getBoundingClientRect();
    if (e.clientY < r.bottom - 7) return false;
    e.preventDefault();
    e.stopPropagation();
    const id = row.dataset.laneId as string;
    const min = id === "master" ? MIN_MASTER_SCALE : MIN_LANE_SCALE;
    const startY = e.clientY;
    const startH = r.height;
    const startScale = parseFloat(row.style.getPropertyValue("--lane-scale")) || 1;
    const base = startH / startScale;
    let latest = startScale;
    document.body.style.cursor = "row-resize";
    const move = (ev: PointerEvent) => {
      latest = Math.min(MAX_LANE_SCALE, Math.max(min, (startH + ev.clientY - startY) / base));
      row.style.setProperty("--lane-scale", String(latest));
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      document.body.style.cursor = "";
      setLaneScale(id, latest);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    return true;
  };

  // Drag the right edge of the control column (any row) to make it wider; double-click the edge for normal width.
  const onInfoEdgeDown = (e: React.PointerEvent) => {
    if (onLaneEdgeDown(e)) return;
    const info = (e.target as HTMLElement).closest(".arr-info");
    const el = scrollRef.current;
    if (!info || !el) return;
    const r = info.getBoundingClientRect();
    if (e.clientX < r.right - 10) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = r.width;
    const base = startW / infoScale;
    let latest = infoScale;
    document.body.style.cursor = "col-resize";
    const move = (ev: PointerEvent) => {
      latest = Math.min(MAX_INFO_SCALE, Math.max(1, (startW + ev.clientX - startX) / base));
      el.style.setProperty("--info-w", `${Math.round(base * latest)}px`);
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      document.body.style.cursor = "";
      const rounded = Math.round(latest * 100) / 100;
      try {
        if (rounded === 1) localStorage.removeItem(INFO_SCALE_KEY);
        else localStorage.setItem(INFO_SCALE_KEY, String(rounded));
      } catch {
        // storage unavailable — the width just won't be remembered
      }
      setInfoScale(rounded);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };
  const onInfoEdgeDouble = (e: React.MouseEvent) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>("[data-lane-id]");
    if (row && e.clientY >= row.getBoundingClientRect().bottom - 7) {
      setLaneScale(row.dataset.laneId as string, 1);
      return;
    }
    const info = (e.target as HTMLElement).closest(".arr-info");
    if (!info || e.clientX < info.getBoundingClientRect().right - 10) return;
    try {
      localStorage.removeItem(INFO_SCALE_KEY);
    } catch {
      // nothing stored to clear
    }
    setInfoScale(1);
  };
  const isInitiator = useProjectStore((s) => s.isInitiator());
  const moveTrackNear = useProjectStore((s) => s.moveTrackNear);
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
  // The rows on screen: a group's header, then its channels (kept together); a folded group shows only its header.
  const groups = project?.groups;
  const collapsed = useProjectStore((s) => s.collapsedGroups);
  const rows = useMemo(() => buildRows(ordered, groups ?? [], new Set(Object.keys(collapsed).filter((k) => collapsed[k]))), [ordered, groups, collapsed]);
  const lanes = useMemo(() => visibleLanes(rows), [rows]);
  const laneIndex = useMemo(() => new Map(lanes.map((t, i) => [t.id, i])), [lanes]);
  const numbers = useMemo(() => new Map((tracks ? defaultOrder(tracks) : []).map((t, i) => [t.id, i + 1])), [tracks]);

  const startDrag = (e: React.PointerEvent, id: string, from: number) => {
    e.preventDefault();
    const laneEl = scrollRef.current?.querySelector(".lane");
    const laneH = laneEl?.getBoundingClientRect().height || 64;
    const startY = e.clientY;
    const last = lanes.length - 1;
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
      // Dropped next to the channel now at that place on screen: after it when moving down, before it when moving up.
      const target = lanes[to];
      if (to !== from && target) void moveTrackNear(id, target.id, to > from);
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
      <div className="arr-scroll" ref={scrollRef} onPointerDownCapture={onInfoEdgeDown} onDoubleClick={onInfoEdgeDouble}>
        <div className={pxPerBeat / 4 >= 10 ? "arr-inner fine-grid" : "arr-inner"} style={gridStyle}>
          <Ruler totalBars={totalBars} barPx={barPx} pxPerSec={pxPerSec} />
          {rows.map((row) =>
            row.kind === "group" ? (
              <GroupRow key={`group-${row.group.id}`} group={row.group} members={row.members} timelinePx={timelinePx} />
            ) : (
              <ChannelLane
                key={row.track.id}
                track={row.track}
                group={row.group}
                number={numbers.get(row.track.id) ?? (laneIndex.get(row.track.id) ?? 0) + 1}
                style={laneStyle(row.track.id, laneIndex.get(row.track.id) ?? 0)}
                onGripDown={lanes.length > 1 ? (e) => startDrag(e, row.track.id, laneIndex.get(row.track.id) ?? 0) : undefined}
                pxPerSec={pxPerSec}
                timelinePx={timelinePx}
              />
            )
          )}
          <MasterStrip timelinePx={timelinePx} pxPerSec={pxPerSec} />
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
