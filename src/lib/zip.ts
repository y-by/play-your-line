// A minimal ZIP writer ("stored", no compression: WAV files do not shrink much and it keeps the code small and fast).
// Pure and tested. Used by "Download all channels". Files stay as Blob parts, so a big archive is not copied in memory.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 of some bytes (the checksum a ZIP file stores for each file). */
export function crc32(bytes: Uint8Array, start = 0): number {
  let c = ~start >>> 0;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

export interface ZipEntry {
  name: string;
  blob: Blob;
}

/** A file name that is safe inside a zip and on every system: no slashes or characters Windows refuses. */
export function safeFileName(name: string, fallback = "file"): string {
  const cleaned = Array.from(name, (ch) => (ch.charCodeAt(0) < 32 ? " " : ch))
    .join("")
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, 80)
    .trim();
  return cleaned || fallback;
}

/** Makes every name in the list different ("Guitar.wav", "Guitar 2.wav"), ignoring case, keeping the order. */
export function uniqueNames(names: string[]): string[] {
  const seen = new Set<string>();
  return names.map((n) => {
    const dot = n.lastIndexOf(".");
    const base = dot > 0 ? n.slice(0, dot) : n;
    const ext = dot > 0 ? n.slice(dot) : "";
    let candidate = n;
    for (let i = 2; seen.has(candidate.toLowerCase()); i++) candidate = `${base} ${i}${ext}`;
    seen.add(candidate.toLowerCase());
    return candidate;
  });
}

function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

const MAX_32 = 0xffffffff;

/**
 * Builds the zip. Each file is read once for its checksum, one at a time (so only one file's bytes are in memory at once),
 * and `onProgress(done, total)` is called after each. Files over 4 GB are not supported (nothing here comes close).
 */
export async function makeZip(entries: ZipEntry[], now = new Date(), onProgress?: (done: number, total: number) => void): Promise<Blob> {
  const enc = new TextEncoder();
  const parts: BlobPart[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  const { time, date } = dosDateTime(now);
  let offset = 0;

  for (let i = 0; i < entries.length; i++) {
    const { name, blob } = entries[i];
    const nameBytes = enc.encode(name);
    const crc = crc32(new Uint8Array(await blob.arrayBuffer()));
    if (blob.size > MAX_32 || offset > MAX_32) throw new Error("This archive would be over 4 GB, which this download cannot make.");

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); // local file header
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, 0x0800, true); // file name is UTF-8
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, blob.size, true);
    local.setUint32(22, blob.size, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);
    parts.push(local.buffer, nameBytes, blob);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); // central directory header
    cd.setUint16(4, 20, true); // made by
    cd.setUint16(6, 20, true); // version needed
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true);
    cd.setUint16(12, time, true);
    cd.setUint16(14, date, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, blob.size, true);
    cd.setUint32(24, blob.size, true);
    cd.setUint16(28, nameBytes.length, true);
    cd.setUint16(30, 0, true); // extra
    cd.setUint16(32, 0, true); // comment
    cd.setUint16(34, 0, true); // disk number
    cd.setUint16(36, 0, true); // internal attributes
    cd.setUint32(38, 0, true); // external attributes
    cd.setUint32(42, offset, true);
    const row = new Uint8Array(new ArrayBuffer(46 + nameBytes.length));
    row.set(new Uint8Array(cd.buffer), 0);
    row.set(nameBytes, 46);
    central.push(row);

    offset += 30 + nameBytes.length + blob.size;
    onProgress?.(i + 1, entries.length);
  }

  const centralSize = central.reduce((n, r) => n + r.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); // end of central directory
  end.setUint16(4, 0, true);
  end.setUint16(6, 0, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  end.setUint16(20, 0, true);

  return new Blob([...parts, ...central, end.buffer], { type: "application/zip" });
}
