import { useEffect, useState } from "react";
import { useProjectStore } from "../../store/useProjectStore";
import { groupLevelKey } from "../../lib/audioEngine";
import { CloseIcon, UndoIcon } from "../icons/Icons";
import { HelpHint } from "../HelpHint";
import { Switch, ToolBody, Grip } from "./ChannelFx";
import { usePlacement, useKeepOnScreen, useResizable, SCALE_KEY } from "./fxWindow";

type GroupTool = "eq" | "comp" | "delay" | "reverb";
const TABS: { id: GroupTool; label: string; name: string }[] = [
  { id: "eq", label: "EQ", name: "EQ" },
  { id: "comp", label: "Comp", name: "Compressor" },
  { id: "delay", label: "Delay", name: "Delay" },
  { id: "reverb", label: "Reverb", name: "Reverb" },
];
const ON_FIELD = { eq: "eqOn", comp: "compOn", delay: "delayOn", reverb: "reverbOn" } as const;

/**
 * A group's Tools box: EQ, Compressor, Delay and Reverb on everything in the group, saved on the project.
 * The Owner and the Mixer change it; everyone hears it. A power switch (off by default), a bypass for each effect,
 * undo, reset and a before/after Compare.
 */
export function GroupTools({ groupId, initialAnchor, onClose }: { groupId: string; initialAnchor: { top: number; left: number }; onClose: () => void }) {
  const group = useProjectStore((s) => s.project?.groups.find((g) => g.id === groupId));
  const canUse = useProjectStore((s) => s.canMix());
  const setGroupFx = useProjectStore((s) => s.setGroupFx);
  const undo = useProjectStore((s) => s.undoGroupFx);
  const canUndo = useProjectStore((s) => (s.groupFxUndoCount[groupId] ?? 0) > 0);
  const reset = useProjectStore((s) => s.resetGroupFx);
  const dry = useProjectStore((s) => !!s.groupFxCompare[groupId]);
  const setCompare = useProjectStore((s) => s.setGroupFxCompare);
  const [tool, setTool] = useState<GroupTool>("eq");
  const { pos, setPos, headerProps } = usePlacement(initialAnchor);
  const { box, grip, style } = useResizable(SCALE_KEY);
  useKeepOnScreen(box, setPos);

  // Hearing the group dry is only for the moment: closing the window puts the effects back.
  useEffect(() => () => useProjectStore.getState().setGroupFxCompare(groupId, false), [groupId]);

  // Opening the Tools box turns the group's effects on (when you may change them). It can be switched off again.
  useEffect(() => {
    const s = useProjectStore.getState();
    const current = s.project?.groups.find((g) => g.id === groupId);
    if (current && !current.fx.fxOn && s.canMix()) s.setGroupFx(groupId, { fxOn: true }, { checkpoint: true });
  }, [groupId]);

  if (!group) return null;
  const fx = group.fx;
  const field = ON_FIELD[tool];

  return (
    <div ref={box} className={fx.fxOn ? "channel-fx-plugin" : "channel-fx-plugin off"} style={{ top: pos?.top ?? initialAnchor.top, left: pos?.left ?? initialAnchor.left, ...style }} onPointerDown={(e) => e.stopPropagation()}>
      <div className="fx-plugin-header" {...headerProps}>
        <span className="fx-plugin-title">{group.name} — Tools</span>
        <span className="fx-header-tools">
          <HelpHint topic="groups" />
          <span className="fx-power-label">{fx.fxOn ? "On" : "Off"}</span>
          <Switch on={fx.fxOn} disabled={!canUse} label="Group effects on" title={fx.fxOn ? "The group's effects are on — click to hear it dry" : "The group's effects are off — click to turn them on"} onChange={(on) => setGroupFx(groupId, { fxOn: on }, { checkpoint: true })} />
          <button className="fx-close" onClick={onClose} aria-label="Close">
            <CloseIcon size={14} />
          </button>
        </span>
      </div>

      <div className="fx-toolbar">
        <button className="fx-tool-btn" disabled={!canUse || !canUndo} onClick={() => undo(groupId)} title="Undo the last change to this group's effects" aria-label="Undo">
          <UndoIcon size={13} />
        </button>
        <button className="fx-tool-btn" disabled={!canUse} onClick={() => reset(groupId)} title="Put every effect of this group back to neutral (you can undo this)">
          Reset
        </button>
        <button className={dry ? "fx-tool-btn on" : "fx-tool-btn"} onClick={() => setCompare(groupId, !dry)} aria-pressed={dry} title="Hear this group without its effects, to compare. Only you hear this; it is never saved.">
          {dry ? "Dry" : "Compare"}
        </button>
      </div>
      {!canUse && <p className="fx-offnote">You can look, but only the Owner and the Mixer can change a group.</p>}
      {canUse && !fx.fxOn && <p className="fx-offnote">The effects are off — switch them on (top right) to hear what you set.</p>}

      <div className="fx-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} className={tool === t.id ? "fx-tab on" : "fx-tab"} onClick={() => setTool(t.id)} role="tab" aria-selected={tool === t.id}>
            <span className={fx[ON_FIELD[t.id]] ? "fx-tab-dot on" : "fx-tab-dot"} />
            {t.label}
          </button>
        ))}
      </div>
      <div className="fx-tool-head">
        <span className="fx-section-label">{TABS.find((t) => t.id === tool)!.name}</span>
        <span className="fx-header-tools">
          <Switch on={fx[field]} disabled={!canUse} label={`${tool} on`} title={fx[field] ? "On — click to bypass just this effect" : "Bypassed — click to turn this effect on"} onChange={(on) => setGroupFx(groupId, { [field]: on }, { checkpoint: true })} />
        </span>
      </div>
      <ToolBody
        fx={fx}
        set={(patch) => setGroupFx(groupId, patch)}
        tool={tool}
        canUse={canUse}
        levelKey={groupLevelKey(groupId)}
        readReduction={() => useProjectStore.getState().engine.getGroupCompressorReduction(groupId)}
        compare={dry}
      />
      <Grip grip={grip} />
    </div>
  );
}

