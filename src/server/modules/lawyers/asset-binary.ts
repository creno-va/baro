import { sha256 } from "@noble/hashes/sha2.js";
import { z } from "zod";
import { opaqueIdSchema, revisionSchema } from "../../../contracts";
import { V2_LIMITS } from "../../../contracts/v2";
import type { EnvelopeCipher } from "../../crypto";
import { hex } from "../files/binary";

const identitySchema = z.strictObject({
  environment: z.enum(["preview", "production"]),
  ownerId: opaqueIdSchema,
  assetId: opaqueIdSchema,
  assetRevision: revisionSchema,
  blobId: opaqueIdSchema,
  byteLength: z.number().int().positive().max(V2_LIMITS.documentImageBytes),
});
export type AssetIdentity = z.infer<typeof identitySchema>;
const headerSchema = identitySchema.extend({
  version: z.literal("asset_binary_v1"),
  wrappedKey: z.string().min(1).max(2048),
  ivPrefix: z.string().regex(/^[a-f0-9]{16}$/),
  sourceMetadata: z.strictObject({ name: z.string(), mediaType: z.string() }).optional(),
});
const keySchema = identitySchema.extend({ key: z.string().regex(/^[a-f0-9]{64}$/) });
export class AssetBinaryError extends Error {
  constructor() {
    super("INVALID_ASSET_BINARY");
  }
}
const keyContext = (id: AssetIdentity) => ({
  table: "v2_assets" as const,
  column: "encrypted_payload" as const,
  rowId: id.assetId,
  userId: id.ownerId,
  revision: id.assetRevision,
});
const headerContext = (id: AssetIdentity) => ({ ...keyContext(id), rowId: id.blobId });
const fromHex = (value: string) =>
  Uint8Array.from(value.match(/../g) ?? [], (b) => Number.parseInt(b, 16));
const sameIdentity = (value: AssetIdentity, id: AssetIdentity) =>
  Object.keys(id).every((k) => value[k as keyof AssetIdentity] === id[k as keyof AssetIdentity]);
const ivFor = (prefix: string, ordinal: number) => {
  const iv = new Uint8Array(12);
  iv.set(fromHex(prefix));
  new DataView(iv.buffer).setUint32(8, ordinal);
  return iv;
};
const aadFor = (encoded: Uint8Array<ArrayBuffer>, ordinal: number) => {
  const aad = new Uint8Array(encoded.length + 4);
  aad.set(encoded);
  new DataView(aad.buffer).setUint32(encoded.length, ordinal);
  return aad;
};

/** At most one bounded source chunk and one 8 MiB frame; never materializes a whole asset. */
export function boundedReader(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  let pending: Uint8Array | null = null;
  let offset = 0;
  return {
    async exact(size: number) {
      if (size < 1 || size > V2_LIMITS.chunkBytes + 16) throw new AssetBinaryError();
      const result = new Uint8Array(size);
      let written = 0;
      while (written < size) {
        if (!pending || offset === pending.length) {
          const next = await reader.read();
          if (next.done || next.value.length > V2_LIMITS.chunkBytes + 4096)
            throw new AssetBinaryError();
          pending = next.value;
          offset = 0;
          if (!pending.length) continue;
        }
        const count = Math.min(size - written, pending.length - offset);
        result.set(pending.subarray(offset, offset + count), written);
        written += count;
        offset += count;
      }
      return result;
    },
    async end() {
      if (pending && offset < pending.length) throw new AssetBinaryError();
      for (;;) {
        const next = await reader.read();
        if (next.done) return;
        if (next.value.length) throw new AssetBinaryError();
      }
    },
    async cancel() {
      await reader.cancel().catch(() => {});
    },
  };
}

export async function prepareAssetBinary(
  cipher: EnvelopeCipher,
  input: AssetIdentity,
  sourceMetadata?: { name: string; mediaType: string },
) {
  const id = identitySchema.parse(input);
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt"]);
  const wrappedKey = await cipher.encrypt(JSON.stringify({ ...id, key: hex(raw) }), keyContext(id));
  raw.fill(0);
  const prefix = hex(crypto.getRandomValues(new Uint8Array(8)));
  const encoded = new TextEncoder().encode(
    await cipher.encrypt(
      JSON.stringify({
        ...id,
        version: "asset_binary_v1",
        wrappedKey,
        ivPrefix: prefix,
        ...(sourceMetadata ? { sourceMetadata } : {}),
      }),
      headerContext(id),
    ),
  );
  if (encoded.length > 4096) throw new AssetBinaryError();
  const preamble = new Uint8Array(encoded.length + 4);
  new DataView(preamble.buffer).setUint32(0, encoded.length);
  preamble.set(encoded, 4);
  const frameCount = Math.ceil(id.byteLength / V2_LIMITS.chunkBytes);
  return {
    cipherBytes: preamble.length + id.byteLength + frameCount * 16,
    async write(body: ReadableStream<Uint8Array>, writer: WritableStreamDefaultWriter<Uint8Array>) {
      const source = boundedReader(body);
      const plainHash = sha256.create();
      const cipherHash = sha256.create();
      try {
        cipherHash.update(preamble);
        await writer.write(preamble);
        for (let ordinal = 0; ordinal < frameCount; ordinal++) {
          const plaintext = await source.exact(
            Math.min(V2_LIMITS.chunkBytes, id.byteLength - ordinal * V2_LIMITS.chunkBytes),
          );
          plainHash.update(plaintext);
          const frame = new Uint8Array(
            await crypto.subtle.encrypt(
              {
                name: "AES-GCM",
                iv: ivFor(prefix, ordinal),
                additionalData: aadFor(encoded, ordinal),
              },
              key,
              plaintext,
            ),
          );
          plaintext.fill(0);
          cipherHash.update(frame);
          await writer.write(frame);
        }
        await source.end();
        await writer.close();
        return { contentHash: hex(plainHash.digest()), cipherHash: hex(cipherHash.digest()) };
      } catch (error) {
        await source.cancel();
        await writer.abort().catch(() => {});
        throw error;
      }
    },
  };
}

export function decryptAssetBinary(
  cipher: EnvelopeCipher,
  id: AssetIdentity,
  body: ReadableStream<Uint8Array>,
  hashes: { contentHash: string; cipherHash: string },
  authorized: () => Promise<boolean>,
) {
  const source = boundedReader(body);
  const plainHash = sha256.create();
  const cipherHash = sha256.create();
  let ordinal = 0;
  let encoded: Uint8Array<ArrayBuffer>;
  let prefix: string;
  let key: CryptoKey;
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          if (!(await authorized())) throw new AssetBinaryError();
          if (ordinal === 0) {
            const lengthBytes = await source.exact(4);
            const length = new DataView(lengthBytes.buffer).getUint32(0);
            if (length < 1 || length > 4096) throw new AssetBinaryError();
            encoded = await source.exact(length);
            cipherHash.update(lengthBytes);
            cipherHash.update(encoded);
            const header = headerSchema.parse(
              JSON.parse(
                await cipher.decrypt(
                  new TextDecoder("utf-8", { fatal: true }).decode(encoded),
                  headerContext(id),
                ),
              ),
            );
            if (!sameIdentity(header, id)) throw new AssetBinaryError();
            const unwrapped = keySchema.parse(
              JSON.parse(await cipher.decrypt(header.wrappedKey, keyContext(id))),
            );
            if (!sameIdentity(unwrapped, id)) throw new AssetBinaryError();
            const raw = fromHex(unwrapped.key);
            key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
            raw.fill(0);
            prefix = header.ivPrefix;
          }
          const length = Math.min(
            V2_LIMITS.chunkBytes,
            id.byteLength - ordinal * V2_LIMITS.chunkBytes,
          );
          const frame = await source.exact(length + 16);
          cipherHash.update(frame);
          const plaintext = new Uint8Array(
            await crypto.subtle.decrypt(
              {
                name: "AES-GCM",
                iv: ivFor(prefix, ordinal),
                additionalData: aadFor(encoded, ordinal),
              },
              key,
              frame,
            ),
          );
          plainHash.update(plaintext);
          ordinal++;
          if (ordinal === Math.ceil(id.byteLength / V2_LIMITS.chunkBytes)) {
            await source.end();
            if (
              hex(plainHash.digest()) !== hashes.contentHash ||
              hex(cipherHash.digest()) !== hashes.cipherHash
            )
              throw new AssetBinaryError();
          }
          if (!(await authorized())) throw new AssetBinaryError();
          controller.enqueue(plaintext);
          if (ordinal === Math.ceil(id.byteLength / V2_LIMITS.chunkBytes)) controller.close();
        } catch {
          await source.cancel();
          controller.error(new AssetBinaryError());
        }
      },
      async cancel() {
        await source.cancel();
      },
    },
    { highWaterMark: 0 },
  );
}
