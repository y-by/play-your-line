// Reads the "time reference" a DAW writes into a broadcast WAV (the `bext` chunk): the sample at which the file
// starts on the song's timeline. Pro Tools, Logic, Reaper and Cubase can write it when stems are exported, so a stem
// exported from the middle of a song can be put back in the right place. Pure, so it is testable.

/** Where the file starts on the song's timeline, in seconds, or null when it is not a WAV with a time reference. */
export function readBwfStartSec(data: ArrayBuffer): number | null {
  if (data.byteLength < 44) return null;
  const view = new DataView(data);
  const tag = (at: number) => String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
  let rate = 0;
  let reference: number | null = null;
  let at = 12;
  while (at + 8 <= data.byteLength) {
    const id = tag(at);
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (id === "fmt " && body + 8 <= data.byteLength) rate = view.getUint32(body + 4, true);
    // bext: description 256, originator 32, originator reference 32, date 10, time 8, then the time reference as two 32-bit halves.
    if (id === "bext" && size >= 346 && body + 346 <= data.byteLength) {
      reference = view.getUint32(body + 338, true) + view.getUint32(body + 342, true) * 4294967296;
    }
    if (id === "data") break;
    at = body + size + (size % 2);
  }
  if (reference === null || !(rate > 0)) return null;
  return reference / rate;
}
