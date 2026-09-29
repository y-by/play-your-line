import { useRef, useState } from "react";
import { useProjectStore } from "../../store/useProjectStore";
import type { Track } from "../../types/project";
import { CloseIcon } from "../icons/Icons";
import { Knob } from "./Knob";
import { EqCurve } from "./EqCurve";

type Tool = "eq" | "comp" | "delay" | "reverb";
const TOOLS: { id: Tool; label: string }[] = [
  { id: "eq", label: "EQ" },
  { id: "comp", label: "Comp" },
  { id: "delay", label: "Delay" },
  { id: "reverb", label: "Reverb" },
];

/** A live level meter — real audio, not decoration — for the Compressor tool. */
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

/**
 * Per-channel EQ / Compressor / Delay / Reverb, on the saved final mix.
 * Available to the Owner, the Mixer, and the channel's own assigned player.
 * One tool shown at a time (click a tab to switch), draggable by its header —
 * styled like a real plugin window, not a settings form.
 */
export function ChannelFx({ track, initialAnchor, onClose }: { track: Track; initialAnchor: { top: number; left: number }; onClose: () => void }) {
  const canUse = useProjectStore((s) => s.canUseFx(track));
  const setChannelFx = useProjectStore((s) => s.setChannelFx);
  const setPct = (field: "compAmount" | "delayMix" | "reverbMix", uiValue: number) => setChannelFx(track.id, { [field]: uiValue / 100 });

  const [tool, setTool] = useState<Tool>("eq");
  const [pos, setPos] = useState(initialAnchor);
  const drag = useRef<{ startX: number; startY: number; startTop: number; startLeft: number } | null>(null);

  const onHeaderPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    try {
      (e.target as Element).setPointerCapture(e.pointerId);
    } catch {
      // Capture is only a convenience; dragging still works while the pointer stays over the header.
    }
    drag.current = { startX: e.clientX, startY: e.clientY, startTop: pos.top, startLeft: pos.left };
  };
  const onHeaderPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const { startX, startY, startTop, startLeft } = drag.current;
    setPos({
      top: Math.max(0, startTop + (e.clientY - startY)),
      left: Math.max(0, Math.min(window.innerWidth - 60, startLeft + (e.clientX - startX))),
    });
  };
  const onHeaderPointerUp = () => {
    drag.current = null;
  };

  return (
    <div className="channel-fx-plugin" style={{ top: pos.top, left: pos.left }} onPointerDown={(e) => e.stopPropagation()}>
      <div className="fx-plugin-header" onPointerDown={onHeaderPointerDown} onPointerMove={onHeaderPointerMove} onPointerUp={onHeaderPointerUp}>
        <span className="fx-plugin-title">{track.instrument} — FX</span>
        <button className="fx-close" onClick={onClose} aria-label="Close">
          <CloseIcon size={14} />
        </button>
      </div>

      <div className="fx-tabs" role="tablist">
        {TOOLS.map((t) => (
          <button key={t.id} className={tool === t.id ? "fx-tab on" : "fx-tab"} onClick={() => setTool(t.id)} role="tab" aria-selected={tool === t.id}>
            {t.label}
          </button>
        ))}
      </div>

      {tool === "eq" && (
        <div className="fx-section fx-section-eq">
          <EqCurve trackId={track.id} eqLow={track.fx.eqLow} eqMid={track.fx.eqMid} eqHigh={track.fx.eqHigh} />
          <div className="fx-knob-row">
            <Knob
              label="low"
              value={track.fx.eqLow}
              unit="dB"
              min={-12}
              max={12}
              sensitivity={0.15}
              defaultValue={0}
              disabled={!canUse}
              size={56}
              onChange={(v) => setChannelFx(track.id, { eqLow: v })}
            />
            <Knob
              label="mid"
              value={track.fx.eqMid}
              unit="dB"
              min={-12}
              max={12}
              sensitivity={0.15}
              defaultValue={0}
              disabled={!canUse}
              size={56}
              onChange={(v) => setChannelFx(track.id, { eqMid: v })}
            />
            <Knob
              label="high"
              value={track.fx.eqHigh}
              unit="dB"
              min={-12}
              max={12}
              sensitivity={0.15}
              defaultValue={0}
              disabled={!canUse}
              size={56}
              onChange={(v) => setChannelFx(track.id, { eqHigh: v })}
            />
          </div>
        </div>
      )}

      {tool === "comp" && (
        <div className="fx-section fx-section-comp">
          <VuMeter trackId={track.id} />
          <div className="fx-knob-row">
            <Knob
              label="amount"
              value={track.fx.compAmount * 100}
              unit="%"
              min={0}
              max={100}
              sensitivity={0.6}
              defaultValue={0}
              disabled={!canUse}
              size={72}
              onChange={(v) => setPct("compAmount", v)}
            />
          </div>
          <p className="fx-hint">Squeezes the loud parts closer to the quiet parts — more amount, less dynamic range.</p>
        </div>
      )}

      {tool === "delay" && (
        <div className="fx-section">
          <div className="fx-knob-row">
            <Knob
              label="time"
              value={track.fx.delayTimeMs}
              unit="ms"
              min={0}
              max={1000}
              sensitivity={4}
              defaultValue={300}
              disabled={!canUse}
              size={64}
              onChange={(v) => setChannelFx(track.id, { delayTimeMs: v })}
            />
            <Knob
              label="mix"
              value={track.fx.delayMix * 100}
              unit="%"
              min={0}
              max={100}
              sensitivity={0.6}
              defaultValue={0}
              disabled={!canUse}
              size={64}
              onChange={(v) => setPct("delayMix", v)}
            />
          </div>
        </div>
      )}

      {tool === "reverb" && (
        <div className="fx-section">
          <div className="fx-knob-row">
            <Knob
              label="mix"
              value={track.fx.reverbMix * 100}
              unit="%"
              min={0}
              max={100}
              sensitivity={0.6}
              defaultValue={0}
              disabled={!canUse}
              size={72}
              onChange={(v) => setPct("reverbMix", v)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
