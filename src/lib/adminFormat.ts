// Pure helpers for the owner dashboard (tested in scripts/test-clips.ts).

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** "now", "4 min ago", "3 h ago", "2 d ago", then a date. */
export function timeAgo(iso: string | null, nowMs = Date.now()): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((nowMs - new Date(iso).getTime()) / 1000));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 14) return `${Math.floor(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** Online = the app sent its heartbeat within the last 3 minutes (it sends one a minute while open). */
export const ONLINE_WINDOW_MS = 3 * 60 * 1000;
export function isOnline(lastSeenAt: string | null, nowMs = Date.now()): boolean {
  return !!lastSeenAt && nowMs - new Date(lastSeenAt).getTime() < ONLINE_WINDOW_MS;
}
