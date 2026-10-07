import { getProject, hydrateTakeBlobs, publishProject, unpublishProject, setProjectPreview } from "./projectApi";
import { mixdownProject, renderMix } from "./mixdown";
import { encodeMp3 } from "./mp3";

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

/** Renders the saved final mix, encodes it as an MP3 and stores it as the project's listening copy. */
export async function buildListeningCopy(projectId: string): Promise<void> {
  const project = await getProject(projectId);
  await hydrateTakeBlobs(project);
  const mp3 = await encodeMp3(await renderMix(project));
  await setProjectPreview(projectId, mp3);
}

/**
 * Publishes (or takes back to a draft) a project from the list. Returns false when publishing was refused for lack of recordings.
 * Publishing also makes the lighter listening copy; if that fails the project is still published (it plays the slow way)
 * and `copyFailed` is true so the caller can say so.
 */
export async function setPublished(projectId: string, publish: boolean): Promise<{ done: boolean; copyFailed: boolean }> {
  if (!publish) {
    await unpublishProject(projectId);
    return { done: true, copyFailed: false };
  }
  const project = await getProject(projectId);
  if (!hasRecordings(project)) return { done: false, copyFailed: false };
  let copyFailed = false;
  try {
    await buildListeningCopy(projectId);
  } catch (err) {
    console.error("Couldn't make the listening copy:", err);
    copyFailed = true;
  }
  await publishProject(projectId);
  return { done: true, copyFailed };
}
