import { useState } from "react";
import type { Project } from "../types/project";
import { exportMix, setPublished } from "../lib/projectActions";
import { errorMessage } from "../lib/errorMessage";
import { ExportIcon, GlobeIcon, SpinnerIcon } from "./icons/Icons";

/** The two things you can do to a project from the list: publish it (or take it back) and export its mix. */
export function ProjectCardActions({ project, isOwner, onStatus }: { project: Project; isOwner: boolean; onStatus: (id: string, status: "draft" | "published") => void }) {
  const [busy, setBusy] = useState<"publish" | "export" | null>(null);
  const published = project.status === "published";

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
      const done = await setPublished(project.id, !published);
      if (!done) alert("There is nothing to publish yet: record something first.");
      else onStatus(project.id, published ? "draft" : "published");
    } catch (err) {
      console.error("Failed to change the published state:", err);
      alert(errorMessage(err, "Couldn't do that. Try again."));
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
      <button className="card-act" onClick={doExport} disabled={!!busy} title="Export the mix as a WAV file" aria-label="Export mix">
        {busy === "export" ? <SpinnerIcon size={14} /> : <ExportIcon size={14} />}
      </button>
    </div>
  );
}
