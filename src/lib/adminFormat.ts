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

// ---- Health: the Free plan limits, read from the real files (migration 0049) -----------------------------------------

export const STORAGE_LIMIT_BYTES = 1024 ** 3;
export const DB_LIMIT_BYTES = 500 * 1024 ** 2;

export type HealthLevel = "ok" | "warn" | "bad";

export interface HealthCheck {
  id: "storage" | "database" | "leftover" | "unused" | "missing";
  level: HealthLevel;
  label: string;
  value: string;
  note: string;
}

export interface HealthNumbers {
  storageBytes: number;
  dbBytes: number;
  leftoverFiles: number;
  leftoverBytes: number;
  unusedTakes: number;
  unusedBytes: number;
  missingFiles: number;
}

const percent = (part: number, whole: number) => Math.round((part / whole) * 100);

/** The five rows of the Health panel. Storage turns amber at 85% and red at 100%, the database at 80% / 100%. */
export function healthChecks(h: HealthNumbers): HealthCheck[] {
  const storagePct = percent(h.storageBytes, STORAGE_LIMIT_BYTES);
  const dbPct = percent(h.dbBytes, DB_LIMIT_BYTES);
  return [
    {
      id: "storage",
      level: storagePct >= 100 ? "bad" : storagePct >= 85 ? "warn" : "ok",
      label: "Storage",
      value: `${formatBytes(h.storageBytes)} · ${storagePct}%`,
      note:
        storagePct >= 100
          ? "Over the 1 GB Free limit. Delete test projects or leftovers now."
          : storagePct >= 85
            ? "Close to the 1 GB Free limit."
            : "of the 1 GB Free limit (real file sizes, not Supabase's delayed figure).",
    },
    {
      id: "database",
      level: dbPct >= 100 ? "bad" : dbPct >= 80 ? "warn" : "ok",
      label: "Database",
      value: `${formatBytes(h.dbBytes)} · ${dbPct}%`,
      note: "of the 500 MB Free limit.",
    },
    {
      id: "leftover",
      level: h.leftoverFiles > 0 ? "warn" : "ok",
      label: "Leftover files",
      value: h.leftoverFiles === 0 ? "none" : `${h.leftoverFiles} · ${formatBytes(h.leftoverBytes)}`,
      note:
        h.leftoverFiles === 0
          ? "No recording file without a take."
          : "Files no take points to. Opening the project as its Owner clears them (files under 10 minutes old are kept).",
    },
    {
      id: "unused",
      level: h.unusedBytes >= 100 * 1024 ** 2 ? "warn" : "ok",
      label: "Unused takes",
      value: h.unusedTakes === 0 ? "none" : `${h.unusedTakes} · ${formatBytes(h.unusedBytes)}`,
      note: "Recordings no clip uses. They clean up when their player opens the project.",
    },
    {
      id: "missing",
      level: h.missingFiles > 0 ? "bad" : "ok",
      label: "Missing files",
      value: h.missingFiles === 0 ? "none" : String(h.missingFiles),
      note: h.missingFiles === 0 ? "Every take has its recording." : "A take's recording is gone, so a clip will not play. Tell Claude.",
    },
  ];
}
