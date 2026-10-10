import { useEffect, useState } from "react";
import { useProjectStore } from "../../store/useProjectStore";
import { MASTER_LEFT } from "../../lib/audioEngine";
import { CloseIcon, UndoIcon } from "../icons/Icons";
import { HelpHint } from "../HelpHint";
import { LIMITER_CEILING_DB } from "../../lib/master";
import { ReductionMeter, Switch, ToolBody, Grip } from "./ChannelFx";
import { usePlacement, useKeepOnScreen, useResizable, SCALE_KEY } from "./fxWindow";

const readComp = () => useProjectStore.getState().engine.getMasterReduction();
const readLimit = () => useProjectStore.getState().engine.getLimiterReduction();

type MasterTool = "eq" | "comp" | "limiter";
const TABS: { id: MasterTool; label: string; name: string }[] = [
  { id: "eq", label: "EQ", name: "EQ" },
  { id: "comp", label: "Comp", name: "Compressor" },
  { id: "limiter", label: "Limiter", name: "Limiter" },
];

/**
 * The master channel's Tools box: EQ, Compressor and a safety Limiter on the whole song, after every channel.
 * Saved on the project; the Owner and the Mixer change it, everyone hears it. A power switch (off by default),
 * a bypass for each effect, undo, reset and a before/after Compare.
 */
export function MasterTools({ initialAnchor, onClose }: { initialAnchor: { top: number; left: number }; onClose: () => void }) {
  const master = useProjectStore((s) => s.project?.master);
  const canUse = useProjectStore((s) => s.canMix());
  const setMasterFx = useProjectStore((s) => s.setMasterFx);
  const undo = useProjectStore((s) => s.undoMasterFx);
  const canUndo = useProjectStore((s) => s.masterFxUndoCount > 0);
  const reset = useProjectStore((s) => s.resetMasterFx);
  const dry = useProjectStore((s) => s.masterCompare);
  const setCompare = useProjectStore((s) => s.setMasterCompare);
  const [tool, setTool] = useState<MasterTool>("eq");
  const { pos, setPos, headerProps } = usePlacement(initialAnchor);
  const { box, grip, style } = useResizable(SCALE_KEY);
  useKeepOnScreen(box, setPos);

  // Hearing the song dry is only for the moment: closing the window puts the master back.
  useEffect(() => () => useProjectStore.getState().setMasterCompare(false), []);

  // Opening the Tools box turns the master effects on (when you may change them). It can be switched off again.
  useEffect(() => {
    const s = useProjectStore.getState();
    const current = s.project?.master;
    if (current && !current.fx.fxOn && s.canMix()) s.setMasterFx({ fxOn: true }, { checkpoint: true });
  }, []);

  if (!master) return null;
  const fx = master.fx;
  const stageOn = tool === "eq" ? fx.eqOn : tool === "comp" ? fx.compOn : master.limiterOn;
  const setStageOn = (on: boolean) => setMasterFx(tool === "eq" ? { eqOn: on } : tool === "comp" ? { compOn: on } : { limiterOn: on }, { checkpoint: true });

  return (
    <div ref={box} className={fx.fxOn ? "channel-fx-plugin" : "channel-fx-plugin off"} style={{ top: pos?.top ?? initialAnchor.top, left: pos?.left ?? initialAnchor.left, ...style }} onPointerDown={(e) => e.stopPropagation()}>
      <div className="fx-plugin-header" {...headerProps}>
        <span className="fx-plugin-title">Master — Tools</span>
        <span className="fx-header-tools">
          <HelpHint topic="master" />
          <span className="fx-power-label">{fx.fxOn ? "On" : "Off"}</span>
          <Switch on={fx.fxOn} disabled={!canUse} label="Master effects on" title={fx.fxOn ? "The master effects are on — click to hear the song without them" : "The master effects are off — click to turn them on"} onChange={(on) => setMasterFx({ fxOn: on }, { checkpoint: true })} />
          <button className="fx-close" onClick={onClose} aria-label="Close">
            <CloseIcon size={14} />
          </button>
        </span>
      </div>

      <div className="fx-toolbar">
        <button className="fx-tool-btn" disabled={!canUse || !canUndo} onClick={undo} title="Undo the last change to the master effects" aria-label="Undo">
          <UndoIcon size={13} />
        </button>
        <button className="fx-tool-btn" disabled={!canUse} onClick={reset} title="Put every master effect back to neutral (you can undo this)">
          Reset
        </button>
        <button className={dry ? "fx-tool-btn on" : "fx-tool-btn"} onClick={() => setCompare(!dry)} aria-pressed={dry} title="Hear the song without the master effects, to compare. Only you hear this; it is never saved.">
          {dry ? "Dry" : "Compare"}
        </button>
      </div>
      {!canUse && <p className="fx-offnote">You can look, but only the Owner and the Mixer can change the master.</p>}
      {canUse && !fx.fxOn && <p className="fx-offnote">The master effects are off — switch them on (top right) to hear what you set.</p>}

      <div className="fx-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} className={tool === t.id ? "fx-tab on" : "fx-tab"} onClick={() => setTool(t.id)} role="tab" aria-selected={tool === t.id}>
            <span className={(t.id === "eq" ? fx.eqOn : t.id === "comp" ? fx.compOn : master.limiterOn) ? "fx-tab-dot on" : "fx-tab-dot"} />
            {t.label}
          </button>
        ))}
      </div>
      <div className="fx-tool-head">
        <span className="fx-section-label">{TABS.find((t) => t.id === tool)!.name}</span>
        <span className="fx-header-tools">
          <Switch on={stageOn} disabled={!canUse} label={`${tool} on`} title={stageOn ? "On — click to bypass just this effect" : "Bypassed — click to turn this effect on"} onChange={setStageOn} />
        </span>
      </div>
      {tool === "limiter" ? (
        <div className="fx-section">
          <ReductionMeter read={readLimit} active={fx.fxOn && master.limiterOn && !dry} label="limiting" title="How many dB the limiter is turning the sound down right now" />
          <p className="fx-hint">
            A safety limiter. It catches the loudest peaks near {LIMITER_CEILING_DB} dB so the song, the exported file and the MP3 listening copy do not distort. It is a safety net, not a mastering tool.
          </p>
        </div>
      ) : (
        <ToolBody fx={fx} set={(patch) => setMasterFx(patch)} tool={tool} canUse={canUse} levelKey={MASTER_LEFT} readReduction={readComp} compare={dry} />
      )}
      <Grip grip={grip} />
    </div>
  );
}
