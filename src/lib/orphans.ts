// Deciding which stored recording files are no longer used. Pure, so the
// safety rules can be tested with plain numbers.

export interface StoredFile {
  name: string; // e.g. "3f2a....wav"
  createdAtMs: number;
}

/** A file this young might belong to a recording that's still being saved — never touch it. */
export const MIN_ORPHAN_AGE_MS = 10 * 60 * 1000;

/**
 * Files in a channel's folder that no clip uses any more.
 * `usedFileNames` are the files of takes that at least one clip points at.
 */
export function findOrphanFiles(files: StoredFile[], usedFileNames: Set<string>, nowMs: number): StoredFile[] {
  return files.filter((f) => !usedFileNames.has(f.name) && nowMs - f.createdAtMs >= MIN_ORPHAN_AGE_MS);
}

/** "<takeId>.wav" → "<takeId>" */
export function takeIdFromFileName(name: string): string {
  return name.replace(/\.wav$/i, "");
}
