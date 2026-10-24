// A person's own monitor mix of a project: channel volume and mute, kept only on this device (never saved to the project).
// Players and Listeners can make one; the Owner's and the Mixer's levels ARE the saved final mix.

export type MonitorMix = Record<string, { volume: number; muted: boolean }>;

export const monitorKey = (projectId: string) => `pyl.monitor.${projectId}`;

export function readMonitor(projectId: string): MonitorMix {
  try {
    const raw = localStorage.getItem(monitorKey(projectId));
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** True when this person has changed anything: only then is "my mix" different from the Owner's. */
export function hasPersonalMix(projectId: string): boolean {
  return Object.keys(readMonitor(projectId)).length > 0;
}
