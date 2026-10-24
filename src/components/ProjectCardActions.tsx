import { useState } from "react";
import { createPortal } from "react-dom";
import type { Project } from "../types/project";
import { leaveProject } from "../lib/projectApi";
import { buildListeningCopy, exportChannelsZip, exportMix, setPublished, type MixChoice } from "../lib/projectActions";
import { hasPersonalMix } from "../lib/personalMix";
import { errorMessage } from "../lib/errorMessage";
import { CloseIcon, ExportIcon, GlobeIcon, RefreshIcon, SpinnerIcon, StemsIcon } from "./icons/Icons";

/** What you can do to a project from the list: publish it (or take it back), export its mix, download all its channels, leave it. */
export function ProjectCardActions({
  project,
  isOwner,
  roleLabel,
  onStatus,
  onLeft,
}: {
  project: Project;
  isOwner: boolean;
  roleLabel?: string | null;
  onStatus: (id: string, status: "draft" | "published") => void;
  onLeft?: (id: string) => void;
}) {
  const [busy, setBusy] = useState<"publish" | "export" | "channels" | "copy" | "leave" | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [progress, setProgress] = useState("");
  // Listeners only listen; everyone who records or mixes may take the channels home.
  const canDownloadChannels = roleLabel === "Owner" || roleLabel === "Mixer" || roleLabel === "Player";
  // The Owner's and the Mixer's levels ARE the saved mix; a Player also has a monitor mix of their own on this device.
  const hasOwnChoice = roleLabel === "Player";
  const [refreshed, setRefreshed] = useState(false);
  const published = project.status === "published";
  // The master changed after the listening copy was made: the Owner is reminded to update it.
  const stale = published && !!project.previewPath && project.previewStale && !refreshed;

  const stop = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const togglePublish = async (e: React.MouseEvent) => {
    stop(e);
    if (busy) return;
    const message = published
      ? "Unpublish this project? It will disappear from the Published Projects list and only the people in it will see it."
      : "Publish this project? Everyone signed in will be able to find and listen to it in Published Projects.";
    if (!confirm(message)) return;
    setBusy("publish");
    try {
      const { done, copyFailed } = await setPublished(project.id, !published);
      if (!done) alert("There is nothing to publish yet: record something first.");
      else {
        onStatus(project.id, published ? "draft" : "published");
        if (copyFailed) alert("Published, but the lighter listening copy could not be made, so it will load slowly for listeners. Use the refresh button on the card to try again.");
      }
    } catch (err) {
      console.error("Failed to change the published state:", err);
      alert(errorMessage(err, "Couldn't do that. Try again."));
    } finally {
      setBusy(null);
    }
  };

  const refreshCopy = async (e: React.MouseEvent) => {
    stop(e);
    if (busy) return;
    setBusy("copy");
    try {
      await buildListeningCopy(project.id);
      setRefreshed(true);
      alert("The listening copy now matches the current mix.");
    } catch (err) {
      console.error("Failed to update the listening copy:", err);
      alert(errorMessage(err, "Couldn't update the listening copy. Try again."));
    } finally {
      setBusy(null);
    }
  };

  const leave = async (e: React.MouseEvent) => {
    stop(e);
    if (busy) return;
    if (!confirm(`Leave "${project.title}"?\n\nIt disappears from your list. Any channel of yours with recordings stays in the project with the Owner; empty channels become free. You can only come back if the Owner invites you again.`)) return;
    setBusy("leave");
    try {
      await leaveProject(project.id);
      onLeft?.(project.id);
    } catch (err) {
      console.error("Failed to leave the project:", err);
      alert(errorMessage(err, "Couldn't leave the project. Try again."));
    } finally {
      setBusy(null);
    }
  };

  const doExport = async (e: React.MouseEvent) => {
    stop(e);
    if (busy) return;
    setBusy("export");
    try {
      const done = await exportMix(project.id);
      if (!done) alert("There is nothing to export yet: no one has recorded anything.");
    } catch (err) {
      console.error("Failed to export the mix:", err);
      alert(errorMessage(err, "Couldn't export the mix. Try again."));
    } finally {
      setBusy(null);
    }
  };

  const downloadChannels = async (mix: MixChoice) => {
    setChoosing(false);
    if (busy) return;
    setBusy("channels");
    setProgress("Starting…");
    try {
      const done = await exportChannelsZip(project.id, mix, setProgress);
      if (!done) alert("There is nothing to download yet: no one has recorded anything.");
    } catch (err) {
      console.error("Failed to download the channels:", err);
      alert(errorMessage(err, "Couldn't make the download. Try again."));
    } finally {
      setBusy(null);
      setProgress("");
    }
  };

  const startChannels = (e: React.MouseEvent) => {
    stop(e);
    if (busy) return;
    if (hasOwnChoice) setChoosing(true);
    else void downloadChannels("owner");
  };

  const personal = hasOwnChoice && hasPersonalMix(project.id);

  return (
    <div className={choosing ? "card-actions open" : "card-actions"} onPointerDown={(e) => e.stopPropagation()}>
      {busy === "channels" && progress && <span className="card-act-progress">{progress}</span>}
      {isOwner && (
        <button className={published ? "card-act on" : "card-act"} onClick={togglePublish} disabled={!!busy} title={published ? "Published — click to take it back to a draft" : "Publish this project"} aria-label={published ? "Unpublish" : "Publish"}>
          {busy === "publish" ? <SpinnerIcon size={14} /> : <GlobeIcon size={14} />}
        </button>
      )}
      {isOwner && published && (
        <button className={stale ? "card-act stale" : "card-act"} onClick={refreshCopy} disabled={!!busy} title={stale ? "Out of date: the master changed after the listening copy was made. Click to update it so Published Projects plays your latest mix." : "Update the listening copy so Published Projects plays your latest mix"} aria-label={stale ? "Update listening copy (out of date)" : "Update listening copy"}>
          {busy === "copy" ? <SpinnerIcon size={14} /> : <RefreshIcon size={14} />}
        </button>
      )}
      <button className="card-act" onClick={doExport} disabled={!!busy} title="Export the mix as a WAV file" aria-label="Export mix">
        {busy === "export" ? <SpinnerIcon size={14} /> : <ExportIcon size={14} />}
      </button>
      {canDownloadChannels && (
        <button className="card-act" onClick={startChannels} disabled={!!busy} title="Download all channels (a zip of WAV files)" aria-label="Download all channels">
          {busy === "channels" ? <SpinnerIcon size={14} /> : <StemsIcon size={14} />}
        </button>
      )}
      {choosing &&
        createPortal(
          <div className="zip-backdrop" onClick={(e) => { stop(e); setChoosing(false); }} onPointerDown={(e) => e.stopPropagation()}>
            <div className="zip-panel" role="dialog" aria-label="Download all channels" onClick={stop}>
              <h3>Download all channels</h3>
              <p className="zip-lead">One zip with a full mix and every channel as its own WAV file, all the same length so they line up in any DAW. Which levels should it use?</p>
              <button className="zip-choice" onClick={() => void downloadChannels("owner")}>
                <b>The Owner's mix</b>
                <span>The levels the Owner saved for the project.</span>
              </button>
              <button className="zip-choice" onClick={() => void downloadChannels("mine")} disabled={!personal}>
                <b>My mix</b>
                <span>{personal ? "The levels you set in your own monitor mix on this device." : "You have not changed any levels in this project on this device, so this would be the same as the Owner's mix."}</span>
              </button>
              <p className="zip-size">It is big: roughly 25 MB for each minute of each channel. It is made on your computer, so it can take a minute.</p>
              <button className="zip-cancel" onClick={() => setChoosing(false)}>Cancel</button>
            </div>
          </div>,
          document.body
        )}
      {!isOwner && onLeft && (
        <button className="card-act" onClick={leave} disabled={!!busy} title="Leave this project" aria-label="Leave this project">
          {busy === "leave" ? <SpinnerIcon size={14} /> : <CloseIcon size={14} />}
        </button>
      )}
    </div>
  );
}
