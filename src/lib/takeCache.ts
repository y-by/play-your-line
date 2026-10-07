/**
 * Keeps downloaded recordings on this device (the browser's Cache Storage) so a
 * recording is downloaded once, not on every open. A take's file is never
 * replaced (its path holds the take's own id), so a cached copy never goes stale.
 *
 * Everything here is best effort: if the browser has no Cache Storage, is full
 * or blocks it, the caller simply downloads as before.
 */
const CACHE_NAME = "pyl-takes-v1";
const MAX_CACHE_BYTES = 600 * 1024 * 1024;

const keyFor = (path: string) => new Request(`https://takes.pyl.invalid/${path}`);

async function open(): Promise<Cache | null> {
  try {
    return typeof caches === "undefined" ? null : await caches.open(CACHE_NAME);
  } catch {
    return null;
  }
}

export async function getCachedTake(path: string): Promise<Blob | null> {
  try {
    const cache = await open();
    const hit = cache ? await cache.match(keyFor(path)) : undefined;
    return hit ? await hit.blob() : null;
  } catch {
    return null;
  }
}

export async function putCachedTake(path: string, blob: Blob): Promise<void> {
  try {
    const cache = await open();
    if (!cache) return;
    await cache.put(keyFor(path), new Response(blob, { headers: { "Content-Type": blob.type || "audio/wav" } }));
    await trim(cache);
  } catch {
    // Full or blocked: skip caching, the app still works.
  }
}

/** Forgets the cached recordings of one project (after it is deleted). */
export async function forgetCachedProject(projectId: string): Promise<void> {
  try {
    const cache = await open();
    if (!cache) return;
    const marker = `https://takes.pyl.invalid/${projectId}/`;
    for (const req of await cache.keys()) if (req.url.startsWith(marker)) await cache.delete(req);
  } catch {
    // ignore
  }
}

/** Keeps the cache under a size cap by dropping the oldest recordings first. */
async function trim(cache: Cache): Promise<void> {
  const keys = await cache.keys();
  const sizes: number[] = [];
  let total = 0;
  for (const req of keys) {
    const res = await cache.match(req);
    const size = Number(res?.headers.get("Content-Length")) || (res ? (await res.clone().blob()).size : 0);
    sizes.push(size);
    total += size;
  }
  for (let i = 0; i < keys.length - 1 && total > MAX_CACHE_BYTES; i++) {
    await cache.delete(keys[i]);
    total -= sizes[i];
  }
}
