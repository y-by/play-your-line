import { useState } from "react";
import type { Project } from "../types/project";
import { buildListeningCopy, exportMix, setPublished } from "../lib/projectActions";
import { errorMessage } from "../lib/errorMessage";
import { ExportIcon, GlobeIcon, RefreshIcon, SpinnerIcon } from "./icons/Icons";

/** The two things you can do to a project from the list: publish it (or take it back) and export its mix. */
export function ProjectCardActions({ project, isOwner, onStatus }: { project: Project; isOwner: boolean; onStatus: (id: string, status: "draft" | "published") => void }) {
  const [busy, setBusy] = useState<"publish" | "export" | "copy" | null>(null);
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

  return (
    <div className="card-actions" onPointerDown={(e) => e.stopPropagation()}>
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
    </div>
  );
}
