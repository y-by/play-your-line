import { getProject, hydrateTakeBlobs, publishProject, unpublishProject } from "./projectApi";
import { mixdownProject } from "./mixdown";

const hasRecordings = (p: { tracks: { clips: unknown[] }[] }) => p.tracks.some((t) => t.clips.length > 0);

/** Renders the saved final mix of a project and hands it to the browser as a WAV download. Returns false if there is nothing to mix. */
export async function exportMix(projectId: string): Promise<boolean> {
  const project = await getProject(projectId);
  if (!hasRecordings(project)) return false;
  await hydrateTakeBlobs(project);
  const blob = await mixdownProject(project);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${project.title.replace(/\s+/g, "_")}.wav`;
  a.click();
  URL.revokeObjectURL(url);
  return true;
}

/** Publishes (or takes back to a draft) a project from the list. Returns false when publishing was refused for lack of recordings. */
export async function setPublished(projectId: string, publish: boolean): Promise<boolean> {
  if (publish) {
    const project = await getProject(projectId);
    if (!hasRecordings(project)) return false;
    await publishProject(projectId);
  } else {
    await unpublishProject(projectId);
  }
  return true;
}
