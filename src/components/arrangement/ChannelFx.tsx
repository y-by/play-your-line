import { useEffect, useRef, useState } from "react";
import { useProjectStore } from "../../store/useProjectStore";
import type { Track } from "../../types/project";
import { FX_PRESETS } from "../../lib/channelFx";
import { CloseIcon, LockIcon, UndoIcon } from "../icons/Icons";
import { Knob } from "./Knob";
import { EqCurve } from "./EqCurve";

type Tool = "eq" | "comp" | "delay" | "reverb";
const TOOLS: { id: Tool; label: string; name: string }[] = [
  { id: "eq", label: "EQ", name: "EQ" },
  { id: "comp", label: "Comp", name: "Compressor" },
  { id: "delay", label: "Delay", name: "Delay" },
  { id: "reverb", label: "Reverb", name: "Reverb" },
];
const ON_FIELD = { eq: "eqOn", comp: "compOn", delay: "delayOn", reverb: "reverbOn" } as const;

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
  return { pos, headerProps };
}

/** The controls of one effect. */
function ToolBody({ track, tool, canUse }: { track: Track; tool: Tool; canUse: boolean }) {
  const setChannelFx = useProjectStore((s) => s.setChannelFx);
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
function DetachedTool({ track, tool, canUse, start, onDock }: { track: Track; tool: Tool; canUse: boolean; start: { top: number; left: number }; onDock: () => void }) {
  const setChannelFx = useProjectStore((s) => s.setChannelFx);
  const { pos, headerProps } = useDraggable(start);
  const info = TOOLS.find((t) => t.id === tool)!;
  const field = ON_FIELD[tool];
  const live = track.fx.fxOn && track.fx[field];
  return (
    <div className={live ? "channel-fx-plugin detached" : "channel-fx-plugin detached off"} style={{ top: pos.top, left: pos.left }} onPointerDown={(e) => e.stopPropagation()}>
      <div className="fx-plugin-header" {...headerProps}>
        <span className="fx-plugin-title">
          {track.instrument} — {info.name}
        </span>
        <span className="fx-header-tools">
          <Switch on={track.fx[field]} disabled={!canUse} label={`${info.name} on`} title={track.fx[field] ? `${info.name} is on — click to bypass it` : `${info.name} is bypassed — click to turn it on`} onChange={(on) => setChannelFx(track.id, { [field]: on }, { checkpoint: true })} />
          <button className="fx-dock" onClick={onDock} title="Put this back in the main FX window" aria-label={`Dock ${info.name}`}>
            Dock
          </button>
        </span>
      </div>
      {!track.fx.fxOn && <p className="fx-offnote">FX is off for this channel — switch it on in the main window to hear this.</p>}
      <ToolBody track={track} tool={tool} canUse={canUse} />
    </div>
  );
}

/**
 * Per-channel EQ / Compressor / Delay / Reverb, on the saved final mix.
 * The Owner and the Mixer always; the channel's own player until the channel is locked.
 * A power switch (off by default), a bypass for each effect, presets, undo, reset and a before/after Compare.
 * Each effect can be pulled out into a window of its own and docked back.
 */
export function ChannelFx({ track, initialAnchor, onClose }: { track: Track; initialAnchor: { top: number; left: number }; onClose: () => void }) {
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
  const { pos, headerProps } = useDraggable(initialAnchor);

  // Hearing the channel dry is only for the moment: closing the window puts the effects back.
  useEffect(() => () => useProjectStore.getState().setFxCompare(track.id, false), [track.id]);

  const docked = TOOLS.filter((t) => !detached.includes(t.id));
  const shown = docked.some((t) => t.id === tool) ? tool : docked[0]?.id;
  const detach = (id: Tool) => {
    setStarts((s) => ({ ...s, [id]: { top: pos.top + 40 + detached.length * 28, left: Math.min(window.innerWidth - 300, pos.left + 280 + detached.length * 28) } }));
    setDetached((d) => [...d, id]);
  };
  const dock = (id: Tool) => {
    setDetached((d) => d.filter((x) => x !== id));
    setTool(id);
  };
  const fx = track.fx;
  const locked = track.fxLocked;

  return (
    <>
      <div className={fx.fxOn ? "channel-fx-plugin" : "channel-fx-plugin off"} style={{ top: pos.top, left: pos.left }} onPointerDown={(e) => e.stopPropagation()}>
        <div className="fx-plugin-header" {...headerProps}>
          <span className="fx-plugin-title">{track.instrument} — FX</span>
          <span className="fx-header-tools">
            <span className="fx-power-label">{fx.fxOn ? "On" : "Off"}</span>
            <Switch on={fx.fxOn} disabled={!canUse} label="Effects on" title={fx.fxOn ? "Effects are on — click to hear this channel dry" : "Effects are off — click to turn them on"} onChange={(on) => setChannelFx(track.id, { fxOn: on }, { checkpoint: true })} />
            <button className="fx-close" onClick={onClose} aria-label="Close">
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
                <button key={t.id} className={shown === t.id ? "fx-tab on" : "fx-tab"} onClick={() => setTool(t.id)} role="tab" aria-selected={shown === t.id}>
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
                    <button className="fx-dock" onClick={() => detach(shown)} title="Pull this tab out into its own window" aria-label="Detach">
                      Detach
                    </button>
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
      </div>
      {detached.map((id) => (
        <DetachedTool key={id} track={track} tool={id} canUse={canUse} start={starts[id] ?? { top: pos.top + 40, left: pos.left + 280 }} onDock={() => dock(id)} />
      ))}
    </>
  );
}
