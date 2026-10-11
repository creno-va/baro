import { sha256 } from "@noble/hashes/sha2.js";
import { hex } from "../files/binary";

export type ZipSource = {
  id: string;
  name: string;
  byteLength: number;
  contentHash: string;
  open: () => Promise<ReadableStream<Uint8Array>>;
};
const encoder = new TextEncoder();
function header(size: number, fields: [number, number, 2 | 4][]) {
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  for (const [offset, value, length] of fields)
    if (length === 2) view.setUint16(offset, value, true);
    else view.setUint32(offset, value, true);
  return bytes;
}
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});
function crcUpdate(crc: number, bytes: Uint8Array) {
  for (const byte of bytes) crc = (crc >>> 8) ^ (crcTable[(crc ^ byte) & 255] ?? 0);
  return crc;
}
/** Preserve reviewed original names. Disambiguate duplicate names without paths. */
export function zipNames(sources: readonly ZipSource[]) {
  const used = new Set<string>();
  return sources.map((source) => {
    if (
      !source.name ||
      source.name.includes("/") ||
      source.name.includes("\\") ||
      [...source.name].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) ||
      /^\.+$/.test(source.name)
    )
      throw new Error("EXPORT_INVALID_FILENAME");
    // Extraction must remain lossless on case-insensitive, 255-byte filesystems.
    const safe =
      source.name
        .normalize("NFC")
        .replace(/[<>:"|?*]/g, "_")
        .replace(/[ .]+$/, "") || "original";
    const dot = safe.lastIndexOf(".");
    const extension = dot > 0 ? safe.slice(dot) : "";
    const rawBase = dot > 0 ? safe.slice(0, dot) : safe;
    const base = /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(safe)
      ? `_${rawBase}`
      : rawBase;
    const fit = (value: string, bytes: number) => {
      let output = "";
      for (const char of value) {
        if (encoder.encode(output + char).length > bytes) break;
        output += char;
      }
      return output;
    };
    const ext = fit(extension, 64);
    const candidate = (suffix: string) =>
      `${fit(base, 255 - encoder.encode(suffix + ext).length)}${suffix}${ext}`;
    let name = candidate("");
    let counter = 2;
    while (used.has(name.toLowerCase())) name = candidate(` (${counter++})`);
    used.add(name.toLowerCase());
    return encoder.encode(name);
  });
}
// Classic ZIP offsets are uint32. The 5 GB case limit can exceed ZIP32; fail
// before reading any source, and guide the user to smaller selected packages.
export const MAX_ZIP_BYTES = 4_000_000_000;
export function zipByteLength(sources: readonly ZipSource[]) {
  if (
    !sources.length ||
    sources.length > 100 ||
    new Set(sources.map((s) => s.id)).size !== sources.length
  )
    throw new Error("EXPORT_INVALID_SELECTION");
  const names = zipNames(sources);
  const bytes =
    22 +
    sources.reduce((total, source, i) => {
      if (
        !Number.isSafeInteger(source.byteLength) ||
        source.byteLength < 1 ||
        !/^[a-f0-9]{64}$/.test(source.contentHash)
      )
        throw new Error("EXPORT_INVALID_SOURCE");
      return (
        total + 30 + (names[i]?.length ?? 0) + source.byteLength + 16 + 46 + (names[i]?.length ?? 0)
      );
    }, 0);
  if (bytes > MAX_ZIP_BYTES) throw new Error("EXPORT_TOO_LARGE");
  return bytes;
}
/** STORE + UTF-8 + data descriptors: bounded original chunks, no whole ZIP buffer. */
export async function* zipChunks(sources: readonly ZipSource[], authorize: () => Promise<void>) {
  zipByteLength(sources);
  const names = zipNames(sources);
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [i, source] of sources.entries()) {
    await authorize();
    const name = names[i];
    if (!name) throw new Error("EXPORT_INVALID_SELECTION");
    const local = header(30, [
      [0, 0x04034b50, 4],
      [4, 20, 2],
      [6, 0x808, 2],
      [12, 0x21, 2],
      [26, name.length, 2],
    ]);
    yield local;
    yield name;
    let crc = 0xffffffff,
      size = 0;
    const hash = sha256.create();
    const reader = (await source.open()).getReader();
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        await authorize();
        size += part.value.byteLength;
        if (size > source.byteLength) throw new Error("EXPORT_SOURCE_CHANGED");
        crc = crcUpdate(crc, part.value);
        hash.update(part.value);
        yield part.value;
      }
      if (size !== source.byteLength || hex(hash.digest()) !== source.contentHash)
        throw new Error("EXPORT_SOURCE_CHANGED");
      await authorize();
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    yield header(16, [
      [0, 0x08074b50, 4],
      [4, crc, 4],
      [8, size, 4],
      [12, size, 4],
    ]);
    central.push(
      header(46, [
        [0, 0x02014b50, 4],
        [4, 20, 2],
        [6, 20, 2],
        [8, 0x808, 2],
        [14, 0x21, 2],
        [16, crc, 4],
        [20, size, 4],
        [24, size, 4],
        [28, name.length, 2],
        [42, offset, 4],
      ]),
      name,
    );
    offset += local.length + name.length + size + 16;
  }
  await authorize();
  const directoryLength = central.reduce((sum, item) => sum + item.length, 0);
  yield* central;
  yield header(22, [
    [0, 0x06054b50, 4],
    [8, sources.length, 2],
    [10, sources.length, 2],
    [12, directoryLength, 4],
    [16, offset, 4],
  ]);
}
export function streamChunks(iterator: AsyncGenerator<Uint8Array>) {
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          const item = await iterator.next();
          if (item.done) controller.close();
          else controller.enqueue(item.value);
        } catch (error) {
          controller.error(error);
          await iterator.return(undefined);
        }
      },
      async cancel() {
        await iterator.return(undefined);
      },
    },
    { highWaterMark: 0 },
  );
}
