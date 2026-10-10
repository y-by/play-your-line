import { useEffect, useMemo, useRef } from "react";
import { useProjectStore } from "../../store/useProjectStore";
import { barSec } from "../../lib/grid";

const HEIGHT = 18;

/**
 * A slim map of the whole song above the ruler, over the full width of the screen (from the far left, above the channel controls): every clip as a small block (a row for each channel), the loop, the
 * playhead, and a window that shows which part the timeline is showing. It replaces the scroll bar: drag the window
 * (or click anywhere on the map) to scroll sideways, and see at a glance how long the song is and where you are.
 */
export function TimelineOverview({ scrollRef, timelinePx, pxPerSec }: { scrollRef: React.RefObject<HTMLDivElement | null>; timelinePx: number; pxPerSec: number }) {
  const project = useProjectStore((s) => s.project);
  const positionSec = useProjectStore((s) => s.positionSec);
  const loop = useProjectStore((s) => s.loop);
  const loopEnabled = useProjectStore((s) => s.loopEnabled);
  const box = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLDivElement>(null);
  const bpm = project?.bpm ?? 120;
  const beatsPerBar = project?.beatsPerBar ?? 4;
  const totalSec = timelinePx / pxPerSec;

  // Where the window sits: follows the timeline's own scrolling, its size and the zoom.
  useEffect(() => {
    const scroller = scrollRef.current;
    const el = thumb.current;
    const holder = box.current;
    if (!scroller || !el || !holder) return;
    const sync = () => {
      const infoW = parseFloat(getComputedStyle(scroller).getPropertyValue("--info-w")) || 224;
      const content = Math.max(1, scroller.scrollWidth - infoW);
      const visible = Math.max(1, scroller.clientWidth - infoW);
      const w = Math.min(1, visible / content);
      el.style.left = `${(scroller.scrollLeft / content) * 100}%`;
      el.style.width = `${w * 100}%`;
      holder.classList.toggle("whole", w >= 0.999);
      const firstBar = Math.floor(scroller.scrollLeft / (pxPerSec * barSec(bpm, beatsPerBar))) + 1;
      const lastBar = Math.ceil((scroller.scrollLeft + visible) / (pxPerSec * barSec(bpm, beatsPerBar)));
      el.title = `Showing bars ${firstBar} to ${lastBar}. Drag to scroll.`;
    };
    sync();
    scroller.addEventListener("scroll", sync, { passive: true });
    const observer = new ResizeObserver(sync);
    observer.observe(scroller);
    window.addEventListener("resize", sync);
    return () => {
      scroller.removeEventListener("scroll", sync);
      observer.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, [scrollRef, timelinePx, pxPerSec, bpm, beatsPerBar]);

  // Drag the window, or click the map to bring that place to the middle of the view.
  const onPointerDown = (e: React.PointerEvent) => {
    const scroller = scrollRef.current;
    const holder = box.current;
    if (!scroller || !holder) return;
    e.preventDefault();
    holder.setPointerCapture(e.pointerId);
    const rect = holder.getBoundingClientRect();
    const infoW = parseFloat(getComputedStyle(scroller).getPropertyValue("--info-w")) || 224;
    const content = Math.max(1, scroller.scrollWidth - infoW);
    const visible = Math.max(1, scroller.clientWidth - infoW);
    const target = thumb.current?.getBoundingClientRect();
    // Grabbing the window keeps your hold on it; anywhere else puts the window's middle where you pressed.
    const grab = target && e.clientX >= target.left && e.clientX <= target.right ? e.clientX - target.left : (target?.width ?? 0) / 2;
    const move = (clientX: number) => {
      const left = Math.min(rect.width, Math.max(0, clientX - rect.left - grab));
      scroller.scrollLeft = Math.min(content - visible, Math.max(0, (left / rect.width) * content));
    };
    move(e.clientX);
    const onMove = (ev: PointerEvent) => move(ev.clientX);
    const finish = () => {
      holder.removeEventListener("pointermove", onMove);
      holder.removeEventListener("pointerup", finish);
      holder.removeEventListener("pointercancel", finish);
    };
    holder.addEventListener("pointermove", onMove);
    holder.addEventListener("pointerup", finish);
    holder.addEventListener("pointercancel", finish);
  };

  // The clips as blocks: one thin row for each channel, in the channel's colour.
  const blocks = useMemo(() => {
    const tracks = project?.tracks ?? [];
    const rows = Math.max(1, tracks.length);
    const rowH = HEIGHT / rows;
    return tracks.flatMap((t, row) => t.clips.map((c) => <rect key={c.id} x={c.startSec} y={row * rowH + 0.5} width={Math.max(c.durationSec, totalSec / 600)} height={Math.max(1.5, rowH - 1)} fill={t.color} opacity="0.85" />));
  }, [project?.tracks, totalSec]);

  if (!project) return null;
  const pct = (sec: number) => `${Math.min(100, Math.max(0, (sec / totalSec) * 100))}%`;
  const beat = 60 / bpm;

  return (
    <div className="timeline-overview" ref={box} onPointerDown={onPointerDown} role="scrollbar" aria-orientation="horizontal" aria-label="Where you are in the song. Drag to scroll.">
      <svg viewBox={`0 0 ${totalSec} ${HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
        {loop && <rect x={loop.startBeat * beat} y={0} width={(loop.endBeat - loop.startBeat) * beat} height={HEIGHT} className={loopEnabled ? "ov-loop on" : "ov-loop"} />}
        {blocks}
      </svg>
      <div className="ov-playhead" style={{ left: pct(positionSec) }} />
      <div className="ov-thumb" ref={thumb} />
    </div>
  );
}
