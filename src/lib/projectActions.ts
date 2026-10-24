import { getProject, hydrateTakeBlobs, publishProject, unpublishProject, setProjectPreview } from "./projectApi";
import { decodeTakes, mixdownProject, projectLengthSec, renderMix, renderMixFromBuffers } from "./mixdown";
import { encodeMp3 } from "./mp3";
import { encodeWavFloat32, encodeWavPcm24Channels, peakOf } from "./wav";
import { makeZip, safeFileName, uniqueNames, type ZipEntry } from "./zip";
import { readMonitor } from "./personalMix";

const hasRecordings = (p: { tracks: { clips: unknown[] }[] }) => p.tracks.some((t) => t.clips.length > 0);

function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  // Give the browser a moment to start the save before the link goes away (a big file needs it).
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Renders the saved final mix of a project and hands it to the browser as a WAV download. Returns false if there is nothing to mix. */
export async function exportMix(projectId: string): Promise<boolean> {
  const project = await getProject(projectId);
  if (!hasRecordings(project)) return false;
  await hydrateTakeBlobs(project);
  const blob = await mixdownProject(project);
  saveBlob(blob, `${project.title.replace(/\s+/g, "_")}.wav`);
  return true;
}

/** Whose levels the download uses: the Owner's saved mix, or the person's own monitor mix (kept on this device). */
export type MixChoice = "owner" | "mine";

/** A channel as a WAV file: 24-bit when it fits, 32-bit float when it goes past full scale (nothing is ever clipped). */
function channelWav(buffer: AudioBuffer): Blob {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  return peakOf(channels) <= 0.999 ? encodeWavPcm24Channels(channels, buffer.sampleRate) : encodeWavFloat32(buffer);
}

/**
 * "Download all channels": one zip with the full mix and every channel that has recordings as its own WAV file. Every file is
 * 48 kHz, stereo and exactly the same length, starting at the same point (bar 1), so they line up when dropped into any DAW.
 * A channel file is the channel after its own fader, effects and pan (not through its group or the master), muted or not.
 * `mix` chooses the levels: the Owner's saved mix, or this person's own monitor mix. Returns false if there is nothing to export.
 */
export async function exportChannelsZip(projectId: string, mix: MixChoice, onProgress?: (text: string) => void): Promise<boolean> {
  const project = await getProject(projectId);
  const channels = project.tracks.filter((t) => t.clips.length > 0);
  if (channels.length === 0) return false;
  onProgress?.("Downloading the recordings…");
  await hydrateTakeBlobs(project);
  const buffers = await decodeTakes(project);
  // A monitor mix has no entry for a channel nobody touched: that channel is at full volume, as when listening.
  const monitor = readMonitor(projectId);
  const trackMix =
    mix === "mine" ? Object.fromEntries(project.tracks.map((t) => [t.id, { volume: monitor[t.id]?.volume ?? 1, muted: monitor[t.id]?.muted ?? false }])) : undefined;
  const minDurationSec = projectLengthSec(project);
  const mixName = mix === "mine" ? "my mix" : "the Owner's mix";

  const names = uniqueNames(channels.map((t, i) => `${String(i + 1).padStart(2, "0")} ${safeFileName(t.instrument, "Channel")}.wav`));
  const entries: ZipEntry[] = [];
  onProgress?.(`Mixing 1 of ${channels.length + 1}…`);
  entries.push({ name: `00 Full mix (${mixName}).wav`, blob: encodeWavFloat32(await renderMixFromBuffers(project, buffers, 48000, undefined, { trackMix, minDurationSec })) });
  for (let i = 0; i < channels.length; i++) {
    onProgress?.(`Rendering ${i + 2} of ${channels.length + 1}…`);
    const rendered = await renderMixFromBuffers(project, buffers, 48000, undefined, { onlyTrackId: channels[i].id, trackMix, minDurationSec });
    entries.push({ name: names[i], blob: channelWav(rendered) });
  }
  const about = [
    `${project.title}`,
    `Downloaded from Play Your Line on ${new Date().toLocaleDateString()}.`,
    "",
    `Levels: ${mixName}.`,
    `Tempo: ${project.bpm} BPM, ${project.beatsPerBar} beats a bar.`,
    "",
    "Every file is 48 kHz, stereo and exactly the same length, starting at bar 1, so drop them all at the start of a DAW project and they line up.",
    "Each channel file is that channel after its own fader, effects and pan. It does not go through the group or the master, and it is included even if the channel is muted.",
    "A one-microphone channel sits in the middle of the stereo picture, about 3 dB lower in each side, exactly as it does in the mix.",
    `"00 Full mix" is everything together, with the master and the groups, as ${mixName}.`,
  ].join("\n");
  entries.push({ name: "About this download.txt", blob: new Blob([about], { type: "text/plain" }) });
  onProgress?.("Packing the zip…");
  saveBlob(await makeZip(entries), `${safeFileName(project.title, "Project")} - all channels.zip`);
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
