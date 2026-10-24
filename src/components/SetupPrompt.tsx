import { useState } from "react";
import { useProjectStore } from "../store/useProjectStore";
import { useSetupStore } from "../store/useSetupStore";
import { readSetupMemory, shouldOfferSetup, writeSetupMemory } from "../lib/setupGuide";

/** The first-time offer on a project page: a quiet bar for people who can record, until they set up, put it off, or say never. */
export function SetupPrompt() {
  const canRecord = useProjectStore((s) => s.project?.tracks.some((t) => s.canEditClips(t)) ?? false);
  const guideOpen = useSetupStore((s) => s.open);
  const openGuide = useSetupStore((s) => s.openGuide);
  const [hidden, setHidden] = useState(false);
  const [offer] = useState(() => shouldOfferSetup(readSetupMemory()));
  if (!offer || hidden || guideOpen || !canRecord) return null;
  return (
    <div className="setup-banner" role="region" aria-label="Set up your sound">
      <span>
        <strong>New here?</strong> Check your microphone and level in two minutes, so your first recording sounds right.
      </span>
      <button className="fb-send" onClick={() => { setHidden(true); openGuide(); }}>Set up my sound</button>
      <button className="zip-cancel" onClick={() => { writeSetupMemory("later"); setHidden(true); }}>Not now</button>
      <button className="zip-cancel" onClick={() => { writeSetupMemory("never"); setHidden(true); }}>Don't ask again</button>
    </div>
  );
}
