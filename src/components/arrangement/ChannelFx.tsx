import { useEffect, useRef, useState } from "react";
import { useProjectStore } from "../../store/useProjectStore";
import type { Track } from "../../types/project";
import { FX_PRESETS } from "../../lib/channelFx";
import { CloseIcon, LockIcon, UndoIcon } from "../icons/Icons";
import { Knob } from "./Knob";
import { EqCurve } from "./EqCurve";
import { TunerPanel } from "./TunerPanel";

type Tool = "eq" | "comp" | "delay" | "reverb" | "tuner";
const TOOLS: { id: Tool; label: string; name: string }[] = [
  { id: "eq", label: "EQ", name: "EQ" },
  { id: "comp", label: "Comp", name: "Compressor" },
  { id: "delay", label: "Delay", name: "Delay" },
  { id: "reverb", label: "Reverb", name: "Reverb" },
  { id: "tuner", label: "Tuner", name: "Tuner" },
];
const ON_FIELD = { eq: "eqOn", comp: "compOn", delay: "delayOn", reverb: "reverbOn" } as const;
/** The tuner is not an effect: it has no bypass and does not depend on the power switch. */
const isEffect = (tool: Tool): tool is keyof typeof ON_FIELD => tool !== "tuner";

/** A small on/off switch. */
function Switch({ on, onChange, label, disabled, title }: { on: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean; title?: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} title={title} disabled={disabled} className={on ? "fx-switch on" : "fx-switch"} onClick={() => onChange(!on)}>
      <span className="fx-switch-knob" />
    </button>
  );
}

/** A live level meter — real audio, not decoration. */
function VuMeter({ trackId }: { trackId: string }) {
  const level = useProjectStore((s) => Math.min(1, (s.trackLevels[trackId] ?? 0) * 3));
  const segments = 14;
  const lit = Math.round(level * segments);
  return (
    <div className="vu-meter" title="This channel's live level">
      {Array.from({ length: segments }, (_, i) => (
        <span key={i} className={i < lit ? `vu-seg on ${i >= segments - 3 ? "red" : i >= segments - 6 ? "amber" : "green"}` : "vu-seg"} />
      ))}
    </div>
  );
}

/** How much the compressor is turning the level down right now — it reads from the real compressor. */
function ReductionMeter({ trackId }: { trackId: string }) {
  const fill = useRef<HTMLSpanElement>(null);
  const text = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const db = Math.min(0, useProjectStore.getState().engine.getCompressorReduction(trackId));
      if (fill.current) fill.current.style.width = `${Math.min(100, (-db / 24) * 100)}%`;
      if (text.current) text.current.textContent = `${db.toFixed(1)} dB`;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [trackId]);
  return (
    <div className="gr-meter" title="Gain reduction: how many dB the compressor is turning the sound down">
      <span className="gr-label">reduction</span>
      <span className="gr-track">
        <span className="gr-fill" ref={fill} />
      </span>
      <span className="gr-read" ref={text}>
        0.0 dB
      </span>
    </div>
  );
}

/** A window you can drag by its header. */
function useDraggable(initial: { top: number; left: number }) {
  const [pos, setPos] = useState(initial);
  const drag = useRef<{ startX: number; startY: number; startTop: number; startLeft: number } | null>(null);
  const headerProps = {
    onPointerDown: (e: React.PointerEvent) => {
      if ((e.target as Element).closest("button, select, input, [role=switch]")) return;
      e.preventDefault();
      try {
        (e.target as Element).setPointerCapture(e.pointerId);
      } catch {
        // Capture is only a convenience; dragging still works while the pointer stays over the header.
      }
      drag.current = { startX: e.clientX, startY: e.clientY, startTop: pos.top, startLeft: pos.left };
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (!drag.current) return;
      const { startX, startY, startTop, startLeft } = drag.current;
      setPos({
        top: Math.max(0, startTop + (e.clientY - startY)),
        left: Math.max(0, Math.min(window.innerWidth - 60, startLeft + (e.clientX - startX))),
      });
    },
    onPointerUp: () => {
      drag.current = null;
    },
  };
  /** Carry on dragging this window with a pointer that is already down (a tab that was just pulled out). */
  const startWindowDrag = (clientX: number, clientY: number) => {
    const start = { x: clientX, y: clientY, top: pos.top, left: pos.left };
    const move = (e: PointerEvent) =>
      setPos({
        top: Math.max(0, start.top + (e.clientY - start.y)),
        left: Math.max(0, Math.min(window.innerWidth - 60, start.left + (e.clientX - start.x))),
      });
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };
  return { pos, headerProps, startWindowDrag };
}

const SCALE_KEY = "pyl.fxScale";
const MAX_SCALE = 2;

/** Grow a window by dragging its bottom-right corner, up to double its size (less on a narrow screen). */
function useResizable(remember: boolean) {
  const [scale, setScale] = useState(() => {
    if (!remember) return 1;
    try {
      const v = Number(localStorage.getItem(SCALE_KEY));
      return v >= 1 && v <= MAX_SCALE ? v : 1;
    } catch {
      return 1;
    }
  });
  const box = useRef<HTMLDivElement>(null);
  const grip = {
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const el = box.current;
      if (!el) return;
      const baseW = el.offsetWidth;
      const baseH = el.offsetHeight;
      const startX = e.clientX;
      const startY = e.clientY;
      const startScale = scale;
      const max = Math.max(1, Math.min(MAX_SCALE, (window.innerWidth - 12) / baseW));
      let latest = startScale;
      const move = (ev: PointerEvent) => {
        // The corner follows the pointer: a drag across the window's own size doubles it.
        latest = Math.min(max, Math.max(1, startScale + (ev.clientX - startX + ev.clientY - startY) / (baseW + baseH)));
        setScale(latest);
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        if (remember) {
          try {
            localStorage.setItem(SCALE_KEY, String(Math.round(latest * 100) / 100));
          } catch {
            // storage unavailable — the size just won't be remembered
          }
        }
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    },
    onDoubleClick: () => setScale(1),
  };
  const style = scale === 1 ? {} : { transform: `scale(${scale})`, transformOrigin: "top left" };
  return { box, grip, style };
}

/** The corner you drag to make a window bigger (double-click it to go back to normal size). */
function Grip({ grip }: { grip: ReturnType<typeof useResizable>["grip"] }) {
  return <span className="fx-grip" {...grip} title="Drag to make this bigger, up to double. Double-click for normal size." role="separator" aria-label="Resize" />;
}

/** The controls of one effect. */
function ToolBody({ track, tool, canUse }: { track: Track; tool: Tool; canUse: boolean }) {
  const setChannelFx = useProjectStore((s) => s.setChannelFx);
  if (tool === "tuner") return <TunerPanel />;
  const fx = track.fx;
  const set = (patch: Parameters<typeof setChannelFx>[1]) => setChannelFx(track.id, patch);
  const pct = (field: "delayMix" | "reverbMix") => (v: number) => set({ [field]: v / 100 });
  if (tool === "eq") {
    return (
      <div className="fx-section fx-section-eq">
        <EqCurve trackId={track.id} eqLow={fx.eqLow} eqMid={fx.eqMid} eqHigh={fx.eqHigh} />
        <div className="fx-knob-row">
          <Knob label="low" value={fx.eqLow} unit="dB" min={-12} max={12} sensitivity={0.15} defaultValue={0} disabled={!canUse} size={56} onChange={(v) => set({ eqLow: v })} />
          <Knob label="mid" value={fx.eqMid} unit="dB" min={-12} max={12} sensitivity={0.15} defaultValue={0} disabled={!canUse} size={56} onChange={(v) => set({ eqMid: v })} />
          <Knob label="high" value={fx.eqHigh} unit="dB" min={-12} max={12} sensitivity={0.15} defaultValue={0} disabled={!canUse} size={56} onChange={(v) => set({ eqHigh: v })} />
        </div>
      </div>
    );
  }
  if (tool === "comp") {
    return (
      <div className="fx-section fx-section-comp">
        <VuMeter trackId={track.id} />
        <ReductionMeter trackId={track.id} />
        <div className="fx-knob-row wrap">
          <Knob label="threshold" value={fx.compThresholdDb} unit="dB" min={-60} max={0} sensitivity={0.4} defaultValue={0} disabled={!canUse} size={52} onChange={(v) => set({ compThresholdDb: v })} />
          <Knob label="ratio" value={fx.compRatio} unit=":1" min={1} max={20} sensitivity={0.1} defaultValue={1} decimals={1} disabled={!canUse} size={52} onChange={(v) => set({ compRatio: v })} />
          <Knob label="makeup" value={fx.compMakeupDb} unit="dB" min={0} max={24} sensitivity={0.2} defaultValue={0} disabled={!canUse} size={52} onChange={(v) => set({ compMakeupDb: v })} />
        </div>
        <div className="fx-knob-row wrap">
          <Knob label="attack" value={fx.compAttackMs} unit="ms" min={0} max={200} sensitivity={1} defaultValue={10} disabled={!canUse} size={52} onChange={(v) => set({ compAttackMs: v })} />
          <Knob label="release" value={fx.compReleaseMs} unit="ms" min={10} max={1500} sensitivity={8} defaultValue={150} disabled={!canUse} size={52} onChange={(v) => set({ compReleaseMs: v })} />
        </div>
        <p className="fx-hint">Squeezes the loud parts closer to the quiet parts. Lower the threshold and raise the ratio to squeeze more; use makeup to bring the level back up.</p>
      </div>
    );
  }
  if (tool === "delay") {
    return (
      <div className="fx-section">
        <div className="fx-knob-row">
          <Knob label="time" value={fx.delayTimeMs} unit="ms" min={0} max={1000} sensitivity={4} defaultValue={300} disabled={!canUse} size={64} onChange={(v) => set({ delayTimeMs: v })} />
          <Knob label="mix" value={fx.delayMix * 100} unit="%" min={0} max={100} sensitivity={0.6} defaultValue={0} disabled={!canUse} size={64} onChange={pct("delayMix")} />
        </div>
      </div>
    );
  }
  return (
    <div className="fx-section">
      <div className="fx-knob-row">
        <Knob label="mix" value={fx.reverbMix * 100} unit="%" min={0} max={100} sensitivity={0.6} defaultValue={0} disabled={!canUse} size={72} onChange={pct("reverbMix")} />
      </div>
    </div>
  );
}

/** One effect pulled out of the main window into a window of its own. */
function DetachedTool({ track, tool, canUse, start, grab, onDock }: { track: Track; tool: Tool; canUse: boolean; start: { top: number; left: number }; grab?: { x: number; y: number }; onDock: () => void }) {
  const setChannelFx = useProjectStore((s) => s.setChannelFx);
  const { pos, headerProps, startWindowDrag } = useDraggable(start);
  const { box: sizeBox, grip: sizeGrip, style: sizeStyle } = useResizable(false);
  const grabbed = useRef(false);
  useEffect(() => {
    // Pulled out by dragging its tab: keep following the pointer until it is let go.
    if (grab && !grabbed.current) {
      grabbed.current = true;
      startWindowDrag(grab.x, grab.y);
    }
  });
  const info = TOOLS.find((t) => t.id === tool)!;
  const field = isEffect(tool) ? ON_FIELD[tool] : null;
  const live = !field || (track.fx.fxOn && track.fx[field]);
  return (
    <div ref={sizeBox} className={live ? "channel-fx-plugin detached" : "channel-fx-plugin detached off"} style={{ top: pos.top, left: pos.left, ...sizeStyle }} onPointerDown={(e) => e.stopPropagation()}>
      <div className="fx-plugin-header" {...headerProps}>
        <span className="fx-plugin-title">
          {track.instrument} — {info.name}
        </span>
        <span className="fx-header-tools">
          {field && <Switch on={track.fx[field]} disabled={!canUse} label={`${info.name} on`} title={track.fx[field] ? `${info.name} is on — click to bypass it` : `${info.name} is bypassed — click to turn it on`} onChange={(on) => setChannelFx(track.id, { [field]: on }, { checkpoint: true })} />}
          <button className="fx-dock" onClick={onDock} title="Put this back in the main FX window" aria-label={`Dock ${info.name}`}>
            Dock
          </button>
        </span>
      </div>
      {field && !track.fx.fxOn && <p className="fx-offnote">FX is off for this channel — switch it on in the main window to hear this.</p>}
      <ToolBody track={track} tool={tool} canUse={canUse} />
      <Grip grip={sizeGrip} />
    </div>
  );
}

/**
 * Per-channel EQ / Compressor / Delay / Reverb, on the saved final mix.
 * The Owner and the Mixer always; the channel's own player until the channel is locked.
 * A power switch (off by default), a bypass for each effect, presets, undo, reset and a before/after Compare.
 * Each effect can be pulled out into a window of its own and docked back.
 */
export function ChannelFx({
  track,
  initialAnchor,
  mainOpen,
  onMainOpen,
  onClose,
}: {
  track: Track;
  initialAnchor: { top: number; left: number };
  /** Whether the main window is showing. Closing it leaves any tab that was dragged out where it is, on top. */
  mainOpen: boolean;
  onMainOpen: (open: boolean) => void;
  /** Called when nothing is left to show: the main window is closed and no tab is out on its own. */
  onClose: () => void;
}) {
  const canUse = useProjectStore((s) => s.canUseFx(track));
  const canLock = useProjectStore((s) => s.canMix());
  const setChannelFx = useProjectStore((s) => s.setChannelFx);
  const undo = useProjectStore((s) => s.undoChannelFx);
  const canUndo = useProjectStore((s) => (s.fxUndoCount[track.id] ?? 0) > 0);
  const reset = useProjectStore((s) => s.resetChannelFx);
  const applyPreset = useProjectStore((s) => s.applyFxPreset);
  const dry = useProjectStore((s) => !!s.fxCompare[track.id]);
  const setCompare = useProjectStore((s) => s.setFxCompare);
  const setLocked = useProjectStore((s) => s.setFxLocked);

  const [tool, setTool] = useState<Tool>("eq");
  const [detached, setDetached] = useState<Tool[]>([]);
  const [starts, setStarts] = useState<Partial<Record<Tool, { top: number; left: number }>>>({});
  const [grabs, setGrabs] = useState<Partial<Record<Tool, { x: number; y: number }>>>({});
  const justDragged = useRef(false);
  const { pos, headerProps } = useDraggable(initialAnchor);
  const { box: sizeBox, grip: sizeGrip, style: sizeStyle } = useResizable(true);

  // Hearing the channel dry is only for the moment: closing the window puts the effects back.
  useEffect(() => () => useProjectStore.getState().setFxCompare(track.id, false), [track.id]);

  const docked = TOOLS.filter((t) => !detached.includes(t.id));
  const shown = docked.some((t) => t.id === tool) ? tool : docked[0]?.id;
  /** Pulling a tab off the tab strip opens it as its own window, under the pointer. */
  const detach = (id: Tool, at: { x: number; y: number }) => {
    setStarts((st) => ({ ...st, [id]: { top: Math.max(0, at.y - 18), left: Math.max(0, Math.min(window.innerWidth - 280, at.x - 130)) } }));
    setGrabs((g) => ({ ...g, [id]: at }));
    setDetached((d) => [...d, id]);
  };
  const dock = (id: Tool) => {
    setDetached((d) => d.filter((x) => x !== id));
    setTool(id);
    onMainOpen(true); // docking puts it back in the main window, so that has to be showing
  };
  useEffect(() => {
    if (!mainOpen && detached.length === 0) onClose();
  }, [mainOpen, detached.length, onClose]);
  const fx = track.fx;
  const locked = track.fxLocked;

  return (
    <>
      {mainOpen && (
      <div ref={sizeBox} className={fx.fxOn ? "channel-fx-plugin" : "channel-fx-plugin off"} style={{ top: pos.top, left: pos.left, ...sizeStyle }} onPointerDown={(e) => e.stopPropagation()}>
        <div className="fx-plugin-header" {...headerProps}>
          <span className="fx-plugin-title">{track.instrument} — FX</span>
          <span className="fx-header-tools">
            <span className="fx-power-label">{fx.fxOn ? "On" : "Off"}</span>
            <Switch on={fx.fxOn} disabled={!canUse} label="Effects on" title={fx.fxOn ? "Effects are on — click to hear this channel dry" : "Effects are off — click to turn them on"} onChange={(on) => setChannelFx(track.id, { fxOn: on }, { checkpoint: true })} />
            <button className="fx-close" onClick={() => onMainOpen(false)} aria-label="Close">
              <CloseIcon size={14} />
            </button>
          </span>
        </div>

        <div className="fx-toolbar">
          <select
            className="fx-preset"
            value=""
            disabled={!canUse}
            onChange={(e) => {
              if (e.target.value) applyPreset(track.id, e.target.value);
            }}
            aria-label="Start from a preset"
            title="Start from a preset (switches effects on)"
          >
            <option value="">Preset…</option>
            {FX_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button className="fx-tool-btn" disabled={!canUse || !canUndo} onClick={() => undo(track.id)} title="Undo the last change to these effects" aria-label="Undo">
            <UndoIcon size={13} />
          </button>
          <button className="fx-tool-btn" disabled={!canUse} onClick={() => reset(track.id)} title="Put every effect back to neutral (you can undo this)">
            Reset
          </button>
          <button className={dry ? "fx-tool-btn on" : "fx-tool-btn"} onClick={() => setCompare(track.id, !dry)} aria-pressed={dry} title="Hear this channel without its effects, to compare. Only you hear this; it is never saved.">
            {dry ? "Dry" : "Compare"}
          </button>
          {canLock && (
            <button className={locked ? "fx-tool-btn on" : "fx-tool-btn"} onClick={() => setLocked(track.id, !locked)} aria-pressed={locked} title={locked ? "Locked: the player can't change these effects. Click to let them." : "Let the player change these effects. Click to lock them."}>
              <LockIcon size={11} />
            </button>
          )}
        </div>
        {!canUse && <p className="fx-offnote">{locked ? "The owner or mixer has locked this channel's effects." : "You can look, but not change these."}</p>}
        {canUse && !fx.fxOn && shown !== "tuner" && <p className="fx-offnote">Effects are off — switch them on (top right) to hear what you set.</p>}

        {docked.length > 0 ? (
          <>
            <div className="fx-tabs" role="tablist">
              {docked.map((t) => (
                <button
                  key={t.id}
                  className={shown === t.id ? "fx-tab on" : "fx-tab"}
                  onClick={() => {
                    if (justDragged.current) justDragged.current = false;
                    else setTool(t.id);
                  }}
                  onPointerDown={(e) => {
                    justDragged.current = false;
                    const startX = e.clientX;
                    const startY = e.clientY;
                    const move = (ev: PointerEvent) => {
                      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 16) {
                        stop();
                        justDragged.current = true;
                        detach(t.id, { x: ev.clientX, y: ev.clientY });
                      }
                    };
                    const stop = () => {
                      window.removeEventListener("pointermove", move);
                      window.removeEventListener("pointerup", stop);
                      window.removeEventListener("pointercancel", stop);
                    };
                    window.addEventListener("pointermove", move);
                    window.addEventListener("pointerup", stop);
                    window.addEventListener("pointercancel", stop);
                  }}
                  role="tab"
                  aria-selected={shown === t.id}
                  title="Click to open. Drag it out to open in its own window."
                >
                  {isEffect(t.id) && <span className={fx[ON_FIELD[t.id]] ? "fx-tab-dot on" : "fx-tab-dot"} />}
                  {t.label}
                </button>
              ))}
            </div>
            {shown && (
              <>
                <div className="fx-tool-head">
                  <span className="fx-section-label">{TOOLS.find((t) => t.id === shown)!.name}</span>
                  <span className="fx-header-tools">
                    {isEffect(shown) && <Switch on={fx[ON_FIELD[shown]]} disabled={!canUse} label={`${shown} on`} title={fx[ON_FIELD[shown]] ? "On — click to bypass just this effect" : "Bypassed — click to turn this effect on"} onChange={(on) => setChannelFx(track.id, { [ON_FIELD[shown]]: on }, { checkpoint: true })} />}
                  </span>
                </div>
                <ToolBody track={track} tool={shown} canUse={canUse} />
              </>
            )}
          </>
        ) : (
          <p className="fx-hint">Every tab is in its own window. Dock them back with their Dock buttons, or all at once:</p>
        )}
        {detached.length > 0 && (
          <button className="fx-dock all" onClick={() => setDetached([])}>
            Dock all tabs
          </button>
        )}
        <Grip grip={sizeGrip} />
      </div>
      )}
      {detached.map((id) => (
        <DetachedTool key={id} track={track} tool={id} canUse={canUse} start={starts[id] ?? { top: pos.top + 40, left: pos.left + 280 }} grab={grabs[id]} onDock={() => dock(id)} />
      ))}
    </>
  );
}
