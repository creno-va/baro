import { sha256 } from "@noble/hashes/sha2.js";
import { z } from "zod";
import { opaqueIdSchema } from "../../../contracts";
import type { EnvelopeCipher } from "../../crypto";
import { hex } from "../files/binary";

export const EXPORT_CHUNK_BYTES = 262144;
const headerSchema = z.strictObject({
  format: z.literal("report_export_v1"),
  environment: z.enum(["preview", "production"]),
  ownerId: opaqueIdSchema,
  reportId: opaqueIdSchema,
  blobId: opaqueIdSchema,
  revision: z.number().int().positive(),
  kind: z.enum(["report_pdf", "original_zip"]),
  byteLength: z.number().int().positive().max(4_000_000_000),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  key: z.string().regex(/^[a-f0-9]{64}$/),
  nonce: z.string().regex(/^[a-f0-9]{16}$/),
});
export type ExportIdentity = Pick<
  z.infer<typeof headerSchema>,
  "environment" | "ownerId" | "reportId" | "blobId" | "revision" | "kind"
>;
const fromHex = (value: string) =>
  Uint8Array.from(value.match(/../g) ?? [], (v) => Number.parseInt(v, 16));
const context = (id: ExportIdentity) => ({
  table: "v2_blobs" as const,
  column: "encrypted_payload" as const,
  rowId: id.blobId,
  userId: id.ownerId,
  revision: 1,
});
const word = (value: number) => {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value);
  return bytes;
};
function iv(nonce: string, index: number) {
  const value = new Uint8Array(12);
  value.set(fromHex(nonce));
  new DataView(value.buffer).setUint32(8, index);
  return value;
}
/** Split at a fixed boundary independent of upstream transport chunking. */
async function* split(source: AsyncGenerator<Uint8Array>) {
  let part = new Uint8Array(EXPORT_CHUNK_BYTES),
    offset = 0;
  try {
    for await (const bytes of source) {
      for (let start = 0; start < bytes.length; ) {
        const count = Math.min(part.length - offset, bytes.length - start);
        part.set(bytes.subarray(start, start + count), offset);
        start += count;
        offset += count;
        if (offset === part.length) {
          yield part;
          part = new Uint8Array(EXPORT_CHUNK_BYTES);
          offset = 0;
        }
      }
    }
    if (offset) yield part.slice(0, offset);
  } finally {
    part.fill(0);
    await source.return(undefined);
  }
}
export async function planExport(
  cipher: EnvelopeCipher,
  identity: ExportIdentity,
  byteLength: number,
  open: () => AsyncGenerator<Uint8Array>,
  authorize: () => Promise<void>,
) {
  // The first pass verifies original hashes before any persisted archive can be
  // published. Only per-chunk hashes survive; the body is never accumulated.
  const hashes: string[] = [];
  const plainHash = sha256.create();
  let size = 0;
  for await (const part of split(open())) {
    await authorize();
    size += part.length;
    if (size > byteLength) throw new Error("EXPORT_SOURCE_CHANGED");
    plainHash.update(part);
    hashes.push(hex(sha256(part)));
    part.fill(0);
  }
  if (size !== byteLength) throw new Error("EXPORT_SOURCE_CHANGED");
  const rawKey = crypto.getRandomValues(new Uint8Array(32));
  const header = headerSchema.parse({
    ...identity,
    format: "report_export_v1",
    byteLength,
    contentHash: hex(plainHash.digest()),
    key: hex(rawKey),
    nonce: hex(crypto.getRandomValues(new Uint8Array(8))),
  });
  const key = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["encrypt"]);
  rawKey.fill(0);
  const encoded = new TextEncoder().encode(
    await cipher.encrypt(JSON.stringify(header), context(identity)),
  );
  if (encoded.length > 4096) throw new Error("EXPORT_INVALID_HEADER");
  const produce = async function* () {
    await authorize();
    yield word(encoded.length);
    yield encoded;
    let index = 0;
    for await (const part of split(open())) {
      try {
        await authorize();
        // This check runs before encryption: a repeated plan can only encrypt
        // the identical plaintext under its indexed nonce, never changed bytes.
        if (hex(sha256(part)) !== hashes[index]) throw new Error("EXPORT_SOURCE_CHANGED");
        const encrypted = new Uint8Array(
          await crypto.subtle.encrypt(
            { name: "AES-GCM", iv: iv(header.nonce, index), additionalData: encoded },
            key,
            part,
          ),
        );
        yield word(encrypted.length);
        yield encrypted;
        index++;
      } finally {
        part.fill(0);
      }
    }
    if (index !== hashes.length) throw new Error("EXPORT_SOURCE_CHANGED");
    await authorize();
  };
  const cipherHash = sha256.create();
  let cipherBytes = 0;
  for await (const bytes of produce()) {
    cipherHash.update(bytes);
    cipherBytes += bytes.length;
  }
  return {
    open: produce,
    contentHash: header.contentHash,
    cipherHash: hex(cipherHash.digest()),
    cipherBytes,
    byteLength,
  };
}
/** Exact reads retain at most one upstream chunk plus one 256 KiB ciphertext. */
function exactReader(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  let current: Uint8Array<ArrayBufferLike> = new Uint8Array(0),
    offset = 0;
  return {
    async read(size: number) {
      const value = new Uint8Array(size);
      let written = 0;
      while (written < size) {
        if (offset === current.length) {
          const next = await reader.read();
          if (next.done || next.value.length > 8 * 1024 * 1024 + 8192)
            throw new Error("EXPORT_CORRUPTED");
          current = next.value;
          offset = 0;
        }
        const count = Math.min(size - written, current.length - offset);
        value.set(current.subarray(offset, offset + count), written);
        offset += count;
        written += count;
      }
      return value;
    },
    async end() {
      if (offset !== current.length || !(await reader.read()).done)
        throw new Error("EXPORT_CORRUPTED");
    },
    async close() {
      current.fill(0);
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    },
  };
}
export async function* decryptExport(
  cipher: EnvelopeCipher,
  identity: ExportIdentity,
  expected: { byteLength: number; contentHash: string; cipherBytes: number; cipherHash: string },
  body: ReadableStream<Uint8Array>,
  authorize: () => Promise<void>,
) {
  const reader = exactReader(body),
    cipherHasher = sha256.create(),
    plainHasher = sha256.create();
  let cipherSize = 0;
  const read = async (size: number) => {
    const bytes = await reader.read(size);
    cipherHasher.update(bytes);
    cipherSize += size;
    return bytes;
  };
  try {
    await authorize();
    const length = new DataView((await read(4)).buffer).getUint32(0);
    if (length < 1 || length > 4096) throw new Error("EXPORT_CORRUPTED");
    const encoded = await read(length);
    const header = headerSchema.parse(
      JSON.parse(
        await cipher.decrypt(
          new TextDecoder("utf-8", { fatal: true }).decode(encoded),
          context(identity),
        ),
      ),
    );
    if (
      Object.entries(identity).some(([k, value]) => header[k as keyof ExportIdentity] !== value) ||
      header.byteLength !== expected.byteLength ||
      header.contentHash !== expected.contentHash
    )
      throw new Error("EXPORT_CORRUPTED");
    const key = await crypto.subtle.importKey("raw", fromHex(header.key), "AES-GCM", false, [
      "decrypt",
    ]);
    let size = 0,
      index = 0;
    while (size < header.byteLength) {
      await authorize();
      const partLength = new DataView((await read(4)).buffer).getUint32(0);
      if (partLength !== Math.min(EXPORT_CHUNK_BYTES, header.byteLength - size) + 16)
        throw new Error("EXPORT_CORRUPTED");
      const encrypted = await read(partLength);
      const plain = new Uint8Array(
        await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: iv(header.nonce, index++), additionalData: encoded },
          key,
          encrypted,
        ),
      );
      plainHasher.update(plain);
      size += plain.length;
      await authorize();
      yield plain;
    }
    await reader.end();
    if (
      cipherSize !== expected.cipherBytes ||
      hex(cipherHasher.digest()) !== expected.cipherHash ||
      hex(plainHasher.digest()) !== expected.contentHash
    )
      throw new Error("EXPORT_CORRUPTED");
    await authorize();
  } finally {
    await reader.close();
  }
}
