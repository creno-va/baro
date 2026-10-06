import { sha256 } from "@noble/hashes/sha2.js";
import { z } from "zod";
import { opaqueIdSchema } from "../../../contracts";
import type { EnvelopeCipher } from "../../crypto";
import { digest, hex } from "../files/binary";
import { MAX_ARTIFACT_BYTES, ProcessingError } from "./protocol";
import { type SanitizedManifest, sanitizedManifestSchema } from "./sanitized-protocol";

const identitySchema = z.strictObject({
  environment: z.enum(["preview", "production"]),
  ownerId: opaqueIdSchema,
  profileId: opaqueIdSchema,
  assetId: opaqueIdSchema,
  assetRevision: z.number().int().positive(),
  sourceBlobId: opaqueIdSchema,
  blobId: opaqueIdSchema,
});
export type SanitizedIdentity = z.infer<typeof identitySchema>;
const headerSchema = identitySchema.extend({
  version: z.literal(1),
  purpose: z.literal("asset_sanitized_v1"),
  index: z.number().int().min(0).max(95),
  totalByteLength: z.number().int().positive().max(100_000_000),
  byteLength: z.number().int().positive().max(MAX_ARTIFACT_BYTES),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  chunkHash: z.string().regex(/^[a-f0-9]{64}$/),
  format: z.enum(["jpeg", "pdf"]),
  key: z.string().regex(/^[a-f0-9]{64}$/),
  iv: z.string().regex(/^[a-f0-9]{24}$/),
});
const context = (identity: SanitizedIdentity) => ({
  table: "v2_blobs" as const,
  column: "encrypted_payload" as const,
  rowId: identity.blobId,
  userId: identity.ownerId,
  revision: 1,
});
const fromHex = (value: string) =>
  Uint8Array.from(value.match(/../g) ?? [], (b) => Number.parseInt(b, 16));

/** First pass retains only authenticated frame headers/IVs and plaintext SHA.
 * Same-IV replay is allowed only for the identical plaintext chunk. */
export async function createSanitizedEncoder(
  cipher: EnvelopeCipher,
  identityInput: SanitizedIdentity,
  manifestInput: SanitizedManifest,
) {
  const identity = identitySchema.parse(identityInput);
  const manifest = sanitizedManifestSchema.parse(manifestInput);
  const rawKey = crypto.getRandomValues(new Uint8Array(32));
  const keyHex = hex(rawKey);
  const key = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["encrypt"]);
  rawKey.fill(0);
  const frames: {
    header: Uint8Array<ArrayBuffer>;
    iv: Uint8Array<ArrayBuffer>;
    hash: string;
    size: number;
  }[] = [];
  const cipherHasher = sha256.create();
  const plainHasher = sha256.create();
  let cipherBytes = 0,
    replayIndex = 0;
  let sealed = false;
  const encode = async (frame: (typeof frames)[number], bytes: Uint8Array<ArrayBuffer>) => {
    const encrypted = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: frame.iv, additionalData: frame.header },
        key,
        bytes,
      ),
    );
    const output = new Uint8Array(4 + frame.header.length + encrypted.length);
    new DataView(output.buffer).setUint32(0, frame.header.length);
    output.set(frame.header, 4);
    output.set(encrypted, 4 + frame.header.length);
    encrypted.fill(0);
    return output;
  };
  return {
    async observe(index: number, bytes: Uint8Array<ArrayBuffer>) {
      if (
        sealed ||
        index !== frames.length ||
        index >= manifest.chunkCount ||
        bytes.length !==
          Math.min(MAX_ARTIFACT_BYTES, manifest.byteLength - index * MAX_ARTIFACT_BYTES)
      )
        throw new ProcessingError("FILE_REJECTED");
      const hash = await digest(bytes);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const header = new TextEncoder().encode(
        await cipher.encrypt(
          JSON.stringify(
            headerSchema.parse({
              ...identity,
              version: 1,
              purpose: "asset_sanitized_v1",
              index,
              totalByteLength: manifest.byteLength,
              byteLength: bytes.length,
              contentHash: manifest.contentHash,
              chunkHash: hash,
              format: manifest.format,
              key: keyHex,
              iv: hex(iv),
            }),
          ),
          context(identity),
        ),
      );
      if (header.length > 8192) throw new ProcessingError("FILE_REJECTED");
      const frame = { header, iv, hash, size: bytes.length };
      const encrypted = await encode(frame, bytes);
      cipherHasher.update(encrypted);
      plainHasher.update(bytes);
      cipherBytes += encrypted.length;
      encrypted.fill(0);
      frames.push(frame);
    },
    seal() {
      if (
        sealed ||
        frames.length !== manifest.chunkCount ||
        hex(plainHasher.digest()) !== manifest.contentHash
      )
        throw new ProcessingError("FILE_REJECTED");
      sealed = true;
      return { cipherBytes, cipherHash: hex(cipherHasher.digest()) };
    },
    async replay(index: number, bytes: Uint8Array<ArrayBuffer>) {
      const frame = frames[index];
      // This assertion occurs before AES-GCM: no nonce reuse for altered plaintext.
      if (
        !sealed ||
        !frame ||
        index !== replayIndex ||
        frame.size !== bytes.length ||
        (await digest(bytes)) !== frame.hash
      )
        throw new ProcessingError("FILE_REJECTED");
      const encrypted = await encode(frame, bytes);
      replayIndex++;
      return encrypted;
    },
    complete: () => replayIndex === manifest.chunkCount,
  };
}

/** Independent asset AAD; never relabel an asset as a case/file. The caller
 * authorizes before and after every frame and validates full cipher hash. */
export async function decryptSanitizedFrame(
  cipher: EnvelopeCipher,
  identityInput: SanitizedIdentity,
  frame: Uint8Array<ArrayBuffer>,
  expected: { index: number; byteLength: number; contentHash: string },
) {
  const identity = identitySchema.parse(identityInput);
  try {
    if (frame.length < 21 || frame.length > MAX_ARTIFACT_BYTES + 8212) throw new Error();
    const size = new DataView(frame.buffer, frame.byteOffset, frame.length).getUint32(0);
    if (size < 1 || size > 8192 || size + 20 >= frame.length) throw new Error();
    const encoded = frame.slice(4, size + 4);
    const header = headerSchema.parse(
      JSON.parse(
        await cipher.decrypt(
          new TextDecoder("utf-8", { fatal: true }).decode(encoded),
          context(identity),
        ),
      ),
    );
    if (
      Object.keys(identity).some(
        (key) =>
          header[key as keyof SanitizedIdentity] !== identity[key as keyof SanitizedIdentity],
      ) ||
      header.index !== expected.index ||
      header.totalByteLength !== expected.byteLength ||
      header.contentHash !== expected.contentHash ||
      frame.length !== 4 + size + header.byteLength + 16
    )
      throw new Error();
    const key = await crypto.subtle.importKey("raw", fromHex(header.key), "AES-GCM", false, [
      "decrypt",
    ]);
    const bytes = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: fromHex(header.iv), additionalData: encoded },
        key,
        frame.slice(4 + size),
      ),
    );
    if ((await digest(bytes)) !== header.chunkHash) {
      bytes.fill(0);
      throw new Error();
    }
    return bytes;
  } catch {
    throw new ProcessingError("FILE_REJECTED");
  }
}
