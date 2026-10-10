import { useEffect, useRef, useState } from "react";
import { useProjectStore } from "../../store/useProjectStore";
import type { ChannelFx as ChannelFxSettings, Track } from "../../types/project";
import { activeStages, EQ_FREQ_RANGE, FX_PRESETS, DEFAULT_CHANNEL_FX, formatHz, hzToPos, posToHz } from "../../lib/channelFx";
import { CloseIcon, LockIcon, TunerIcon, UndoIcon } from "../icons/Icons";
import { HelpHint } from "../HelpHint";
import { canAnchor, distrustAnchors, looksAnchored } from "../../lib/anchor";
import { Knob } from "./Knob";
import { usePlacement, useKeepOnScreen, useResizable, SCALE_KEY, TUNER_SCALE_KEY, readStoredScale, type Pos } from "./fxWindow";
import { EqCurve } from "./EqCurve";
import { TunerPanel } from "./TunerPanel";

type Tool = "eq" | "comp" | "delay" | "reverb";
const TOOLS: { id: Tool; label: string; name: string }[] = [
  { id: "eq", label: "EQ", name: "EQ" },
  { id: "comp", label: "Comp", name: "Compressor" },
  { id: "delay", label: "Delay", name: "Delay" },
  { id: "reverb", label: "Reverb", name: "Reverb" },
];
const ON_FIELD = { eq: "eqOn", comp: "compOn", delay: "delayOn", reverb: "reverbOn" } as const;

/** A small on/off switch. */
export function Switch({ on, onChange, label, disabled, title }: { on: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean; title?: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} title={title} disabled={disabled} className={on ? "fx-switch on" : "fx-switch"} onClick={() => onChange(!on)}>
      <span className="fx-switch-knob" />
    </button>
  );
}

/** A live level meter — real audio, not decoration. */
export function VuMeter({ levelKey, title = "This channel's live level" }: { levelKey: string; title?: string }) {
  const level = useProjectStore((s) => Math.min(1, (s.trackLevels[levelKey] ?? 0) * 3));
  const segments = 14;
  const lit = Math.round(level * segments);
  return (
    <div className="vu-meter" title={title}>
      {Array.from({ length: segments }, (_, i) => (
        <span key={i} className={i < lit ? `vu-seg on ${i >= segments - 3 ? "red" : i >= segments - 6 ? "amber" : "green"}` : "vu-seg"} />
      ))}
    </div>
  );
}

/** How much the compressor is turning the level down right now — it reads from the real compressor. */
export function ReductionMeter({ read, active, label = "reduction", title = "Gain reduction: how many dB the compressor is turning the sound down" }: { read: () => number; active: boolean; label?: string; title?: string }) {
  const fill = useRef<HTMLSpanElement>(null);
  const text = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      // A compressor that is out of the signal path is not working, whatever it last read.
      const db = active ? Math.min(0, read()) : 0;
      if (fill.current) fill.current.style.width = `${Math.min(100, (-db / 24) * 100)}%`;
      if (text.current) text.current.textContent = `${db.toFixed(1)} dB`;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [read, active]);
  return (
    <div className="gr-meter" title={title}>
      <span className="gr-label">{label}</span>
      <span className="gr-track">
        <span className="gr-fill" ref={fill} />
      </span>
      <span className="gr-read" ref={text}>
        0.0 dB
      </span>
    </div>
  );
}

/** The windows that always start at known coordinates. */
function useDraggable(initial: Pos) {
  const placement = usePlacement(initial);
  return { ...placement, pos: placement.pos ?? initial };
}

/** The corner you drag to make a window bigger (double-click it to go back to normal size). */
export function Grip({ grip }: { grip: ReturnType<typeof useResizable>["grip"] }) {
  return <span className="fx-grip" {...grip} title="Drag to make this bigger, up to double. Double-click for normal size." role="separator" aria-label="Resize" />;
}

/** The controls of one effect. */
export function ToolBody({
  fx,
  set,
  tool,
  canUse,
  levelKey,
  readReduction,
  compare,
}: {
  fx: ChannelFxSettings;
  set: (patch: Partial<ChannelFxSettings>) => void;
  tool: Tool;
  canUse: boolean;
  /** Which live level the compressor's meter shows (a channel's id, or the master's). */
  levelKey: string;
  readReduction: () => number;
  compare: boolean;
}) {
  const pct = (field: "delayMix" | "reverbMix") => (v: number) => set({ [field]: v / 100 });
  if (tool === "eq") {
    return (
      <div className="fx-section fx-section-eq">
        <EqCurve fx={fx} />
        <div className="eq-bands">
          <div className="eq-band eq-cut">
            <span className="eq-cut-spacer" aria-hidden="true" />
            <Knob
              label="low cut"
              value={hzToPos(fx.eqLowCutHz, EQ_FREQ_RANGE.cut[0], EQ_FREQ_RANGE.cut[1])}
              min={0}
              max={100}
              sensitivity={0.5}
              defaultValue={0}
              format={(pos) => (pos < 1 ? "Off" : `${formatHz(posToHz(pos, EQ_FREQ_RANGE.cut[0], EQ_FREQ_RANGE.cut[1]))}Hz`)}
              disabled={!canUse}
              size={44}
              onChange={(pos) => set({ eqLowCutHz: pos < 1 ? EQ_FREQ_RANGE.cut[0] : posToHz(pos, EQ_FREQ_RANGE.cut[0], EQ_FREQ_RANGE.cut[1]) })}
            />
          </div>
          {(
            [
              { id: "low", gain: fx.eqLow, gainKey: "eqLow", hz: fx.eqLowHz, hzKey: "eqLowHz", def: DEFAULT_CHANNEL_FX.eqLowHz, range: EQ_FREQ_RANGE.low },
              { id: "mid", gain: fx.eqMid, gainKey: "eqMid", hz: fx.eqMidHz, hzKey: "eqMidHz", def: DEFAULT_CHANNEL_FX.eqMidHz, range: EQ_FREQ_RANGE.mid },
              { id: "high", gain: fx.eqHigh, gainKey: "eqHigh", hz: fx.eqHighHz, hzKey: "eqHighHz", def: DEFAULT_CHANNEL_FX.eqHighHz, range: EQ_FREQ_RANGE.high },
            ] as const
          ).map((band) => (
            <div key={band.id} className="eq-band">
              <Knob label={band.id} value={band.gain} unit="dB" min={-12} max={12} sensitivity={0.15} defaultValue={0} disabled={!canUse} size={56} onChange={(v) => set({ [band.gainKey]: v })} />
              <Knob
                label="freq"
                value={hzToPos(band.hz, band.range[0], band.range[1])}
                min={0}
                max={100}
                sensitivity={0.5}
                defaultValue={hzToPos(band.def, band.range[0], band.range[1])}
                format={(pos) => `${formatHz(posToHz(pos, band.range[0], band.range[1]))}Hz`}
                disabled={!canUse}
                size={44}
                onChange={(pos) => set({ [band.hzKey]: posToHz(pos, band.range[0], band.range[1]) })}
              />
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (tool === "comp") {
    return (
      <div className="fx-section fx-section-comp">
        <VuMeter levelKey={levelKey} />
        <ReductionMeter read={readReduction} active={activeStages(fx).includes("comp") && !compare} />
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
  const { pos, setPos, headerProps, startWindowDrag } = useDraggable(start);
  const { box: sizeBox, grip: sizeGrip, style: sizeStyle } = useResizable(null);
  useKeepOnScreen(sizeBox, setPos);
  const grabbed = useRef(false);
  useEffect(() => {
    // Pulled out by dragging its tab: keep following the pointer until it is let go.
    if (grab && !grabbed.current) {
      grabbed.current = true;
      startWindowDrag(grab.x, grab.y);
    }
  });
  const info = TOOLS.find((t) => t.id === tool)!;
  const field = ON_FIELD[tool];
  const live = !field || (track.fx.fxOn && track.fx[field]);
  return (
    <div ref={sizeBox} className={live ? "channel-fx-plugin detached" : "channel-fx-plugin detached off"} style={{ top: pos.top, left: pos.left, ...sizeStyle }} onPointerDown={(e) => e.stopPropagation()}>
      <div className="fx-plugin-header" {...headerProps}>
        <span className="fx-plugin-title">
          {track.instrument} — {info.name}
        </span>
        <span className="fx-header-tools">
          {field && <Switch on={track.fx[field]} disabled={!canUse} label={`${info.name} on`} title={track.fx[field] ? `${info.name} is on — click to bypass it` : `${info.name} is bypassed — click to turn it on`} onChange={(on) => setChannelFx(track.id, { [field]: on }, { checkpoint: true })} />}
          <button className="fx-dock" onClick={onDock} title="Put this back in the main Tools window" aria-label={`Dock ${info.name}`}>
            Dock
          </button>
        </span>
      </div>
      {field && !track.fx.fxOn && <p className="fx-offnote">The effects are off for this channel — switch them on in the main window to hear this.</p>}
      <ToolBody fx={track.fx} set={(patch) => setChannelFx(track.id, patch)} tool={tool} canUse={canUse} levelKey={track.id} readReduction={() => useProjectStore.getState().engine.getCompressorReduction(track.id)} compare={useProjectStore.getState().fxCompare[track.id] ?? false} />
      <Grip grip={sizeGrip} />
    </div>
  );
}

/** The tuner in a window of its own. It never lives inside the FX box: it stays on screen when the box is closed, and its × closes it. */
function TunerWindow({ track, start, onClose }: { track: Track; start: { top: number; left: number }; onClose: () => void }) {
  const { pos, setPos, headerProps } = useDraggable(start);
  const { box, grip, style } = useResizable(TUNER_SCALE_KEY);
  useKeepOnScreen(box, setPos);
  return (
    <div ref={box} className="channel-fx-plugin detached tuner-window" style={{ top: pos.top, left: pos.left, ...style }} onPointerDown={(e) => e.stopPropagation()}>
      <div className="fx-plugin-header" {...headerProps}>
        <span className="fx-plugin-title">{track.instrument} — Tuner</span>
        <span className="fx-header-tools">
          <HelpHint topic="tuner" />
          <button className="fx-close" onClick={onClose} aria-label="Close the tuner" title="Close the tuner">
            <CloseIcon size={14} />
          </button>
        </span>
      </div>
      <TunerPanel />
      <Grip grip={grip} />
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
  anchorName,
}: {
  track: Track;
  initialAnchor: { top: number; left: number };
  /** The CSS anchor name of the FX button, when the browser can place the window against it. */
  anchorName?: string | null;
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
  const [tunerOpen, setTunerOpen] = useState(false);
  const justDragged = useRef(false);
  // Placed by the browser against the FX button (below it, or above it when there is no room) until it is
  // dragged or resized. Not when the window was left enlarged: its size would fool the browser's room check.
  const [anchored] = useState(() => !!anchorName && canAnchor() && readStoredScale(SCALE_KEY) === 1);
  const { pos, setPos, headerProps } = usePlacement(anchored ? null : initialAnchor);
  const materialize = useRef<() => void>(() => {});
  const { box: sizeBox, grip: sizeGrip, style: sizeStyle } = useResizable(SCALE_KEY, () => materialize.current());
  useKeepOnScreen(sizeBox, setPos, mainOpen && pos !== null);
  useEffect(() => {
    materialize.current = () => {
      const r = sizeBox.current?.getBoundingClientRect();
      if (r) setPos((p) => p ?? { top: r.top, left: r.left });
    };
  }, [sizeBox, setPos]);
  // Make sure the browser really put it by its button; if not, stop trusting that and use coordinates.
  useEffect(() => {
    if (!anchored || pos !== null || !mainOpen) return;
    const frame = requestAnimationFrame(() => {
      const r = sizeBox.current?.getBoundingClientRect();
      const button = { left: initialAnchor.left, right: initialAnchor.left + 40, top: initialAnchor.top - 30, bottom: initialAnchor.top - 4 };
      if (r && !looksAnchored(r, button, { width: window.innerWidth, height: window.innerHeight })) {
        distrustAnchors();
        setPos(initialAnchor);
      }
    });
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchored, mainOpen]);
  const [tunerStart, setTunerStart] = useState<Pos>({ top: 8, left: 8 });
  const toggleTuner = () => {
    if (!tunerOpen) {
      const r = sizeBox.current?.getBoundingClientRect();
      const top = r?.top ?? initialAnchor.top;
      const left = r?.left ?? initialAnchor.left;
      setTunerStart({ top, left: Math.min(Math.max(0, window.innerWidth - 300), left + 300) });
    }
    setTunerOpen((v) => !v);
  };

  // Hearing the channel dry is only for the moment: closing the window puts the effects back.
  useEffect(() => () => useProjectStore.getState().setFxCompare(track.id, false), [track.id]);

  // Opening the Tools box turns the effects on (when you may change them): you open it to use them. It can be switched off again.
  useEffect(() => {
    if (!mainOpen) return;
    const s = useProjectStore.getState();
    const current = s.project?.tracks.find((t) => t.id === track.id);
    if (current && !current.fx.fxOn && s.canUseFx(current)) s.setChannelFx(track.id, { fxOn: true }, { checkpoint: true });
  }, [mainOpen, track.id]);

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
    if (!mainOpen && detached.length === 0 && !tunerOpen) onClose();
  }, [mainOpen, detached.length, tunerOpen, onClose]);
  const fx = track.fx;
  const locked = track.fxLocked;

  return (
    <>
      {mainOpen && (
      <div
        ref={sizeBox}
        className={`${fx.fxOn ? "channel-fx-plugin" : "channel-fx-plugin off"}${pos ? "" : " fx-anchored"}`}
        style={pos ? { top: pos.top, left: pos.left, ...sizeStyle } : ({ positionAnchor: anchorName, ...sizeStyle } as React.CSSProperties)}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="fx-plugin-header" {...headerProps}>
          <span className="fx-plugin-title">{track.instrument} — Tools</span>
          <span className="fx-header-tools">
            <HelpHint topic="fx" />
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
        {canUse && !fx.fxOn && <p className="fx-offnote">Effects are off — switch them on (top right) to hear what you set.</p>}

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
                  <span className={fx[ON_FIELD[t.id]] ? "fx-tab-dot on" : "fx-tab-dot"} />
                  {t.label}
                </button>
              ))}
            </div>
            {shown && (
              <>
                <div className="fx-tool-head">
                  <span className="fx-section-label">{TOOLS.find((t) => t.id === shown)!.name}</span>
                  <span className="fx-header-tools">
                    <Switch on={fx[ON_FIELD[shown]]} disabled={!canUse} label={`${shown} on`} title={fx[ON_FIELD[shown]] ? "On — click to bypass just this effect" : "Bypassed — click to turn this effect on"} onChange={(on) => setChannelFx(track.id, { [ON_FIELD[shown]]: on }, { checkpoint: true })} />
                  </span>
                </div>
                <ToolBody fx={fx} set={(patch) => setChannelFx(track.id, patch)} tool={shown} canUse={canUse} levelKey={track.id} readReduction={() => useProjectStore.getState().engine.getCompressorReduction(track.id)} compare={dry} />
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
        <div className="fx-footer">
          <button
            className={tunerOpen ? "fx-tuner-btn on" : "fx-tuner-btn"}
            onClick={toggleTuner}
            aria-pressed={tunerOpen}
            aria-label="Tuner"
            title={tunerOpen ? "Tuner — open in its own window (click to close it)" : "Tuner — opens in its own window and stays when this box is closed"}
          >
            <TunerIcon size={16} />
          </button>
        </div>
        <Grip grip={sizeGrip} />
      </div>
      )}
      {tunerOpen && <TunerWindow track={track} start={tunerStart} onClose={() => setTunerOpen(false)} />}
      {detached.map((id) => (
        <DetachedTool key={id} track={track} tool={id} canUse={canUse} start={starts[id] ?? { top: 40, left: 40 }} grab={grabs[id]} onDock={() => dock(id)} />
      ))}
    </>
  );
}
