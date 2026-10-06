import { z } from "zod";
import { opaqueIdSchema } from "../../../contracts";
import { V2_LIMITS } from "../../../contracts/v2";
import type { EnvelopeCipher } from "../../crypto";

const headerSchema = z.strictObject({
  version: z.literal(1),
  environment: z.enum(["preview", "production"]),
  ownerId: opaqueIdSchema,
  fileId: opaqueIdSchema,
  uploadId: opaqueIdSchema,
  revision: z.number().int().positive(),
  index: z.number().int().min(0).max(119),
  byteLength: z.number().int().positive().max(V2_LIMITS.chunkBytes),
  wrappedKey: z.string().min(1).max(2048),
  iv: z.string().regex(/^[0-9a-f]{24}$/),
});
export type PartIdentity = Pick<
  z.infer<typeof headerSchema>,
  "environment" | "ownerId" | "fileId" | "uploadId" | "revision" | "index" | "byteLength"
>;
export class FileError extends Error {
  constructor(
    readonly code:
      | "NOT_FOUND"
      | "CONFLICT"
      | "BODY_TOO_LARGE"
      | "INVALID_FILE"
      | "PROCESSING_UNAVAILABLE"
      | "STORAGE_UNAVAILABLE",
  ) {
    super(code);
    this.name = "FileError";
  }
}
export const MAX_BINARY_BYTES = V2_LIMITS.chunkBytes + 4100 + 16;
export const hex = (bytes: Uint8Array) =>
  [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
export async function digest(bytes: Uint8Array<ArrayBuffer>) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
}
/** Exact sized buffer; no whole-file allocation and no reliance on Content-Length. */
export async function readBounded(body: ReadableStream<Uint8Array> | null, size: number) {
  if (!body || !Number.isSafeInteger(size) || size < 1 || size > MAX_BINARY_BYTES)
    throw new FileError("INVALID_FILE");
  const reader = body.getReader();
  const bytes = new Uint8Array(size);
  let offset = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      if (item.value.byteLength > size - offset) throw new FileError("BODY_TOO_LARGE");
      bytes.set(item.value, offset);
      offset += item.value.byteLength;
    }
    if (offset !== size) throw new FileError("INVALID_FILE");
    return bytes;
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}
const keySchema = z.strictObject({
  key: z.string().regex(/^[0-9a-f]{64}$/),
  environment: z.enum(["preview", "production"]),
  fileId: opaqueIdSchema,
  uploadId: opaqueIdSchema,
});
function context(id: PartIdentity) {
  return {
    table: "v2_upload_sessions" as const,
    column: "encrypted_payload" as const,
    rowId: id.uploadId,
    userId: id.ownerId,
    revision: id.revision,
  };
}
async function unwrap(cipher: EnvelopeCipher, id: PartIdentity, wrappedKey: string) {
  const value = keySchema.parse(JSON.parse(await cipher.decrypt(wrappedKey, context(id))));
  if (
    value.environment !== id.environment ||
    value.fileId !== id.fileId ||
    value.uploadId !== id.uploadId
  )
    throw new FileError("INVALID_FILE");
  return crypto.subtle.importKey(
    "raw",
    Uint8Array.from(value.key.match(/../g) ?? [], (b) => Number.parseInt(b, 16)),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
}
function headerContext(id: PartIdentity) {
  return { ...context(id), table: "v2_upload_parts" as const, rowId: `${id.uploadId}-${id.index}` };
}
export async function readHeader(
  cipher: EnvelopeCipher,
  id: PartIdentity,
  bytes: Uint8Array<ArrayBuffer>,
) {
  if (bytes.byteLength < 21) throw new FileError("INVALID_FILE");
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
  if (length < 1 || length > 4096 || length + 20 > bytes.byteLength)
    throw new FileError("INVALID_FILE");
  const encoded = bytes.slice(4, length + 4);
  const header = headerSchema.parse(
    JSON.parse(
      await cipher.decrypt(
        new TextDecoder("utf-8", { fatal: true }).decode(encoded),
        headerContext(id),
      ),
    ),
  );
  if (bytes.byteLength !== length + 4 + header.byteLength + 16) throw new FileError("INVALID_FILE");
  return { header, encoded, offset: length + 4 };
}
export async function encryptPart(
  cipher: EnvelopeCipher,
  id: PartIdentity,
  plaintext: Uint8Array<ArrayBuffer>,
  wrappedKey?: string,
) {
  if (plaintext.byteLength !== id.byteLength) throw new FileError("INVALID_FILE");
  if (!wrappedKey) {
    if (id.index !== 0) throw new FileError("CONFLICT");
    const raw = crypto.getRandomValues(new Uint8Array(32));
    wrappedKey = await cipher.encrypt(
      JSON.stringify({
        key: hex(raw),
        environment: id.environment,
        fileId: id.fileId,
        uploadId: id.uploadId,
      }),
      context(id),
    );
    raw.fill(0);
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const header = headerSchema.parse({ ...id, version: 1, wrappedKey, iv: hex(iv) });
  const encoded = new TextEncoder().encode(
    await cipher.encrypt(JSON.stringify(header), headerContext(id)),
  );
  if (encoded.byteLength > 4096) throw new FileError("INVALID_FILE");
  const key = await unwrap(cipher, id, wrappedKey);
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: encoded, tagLength: 128 },
      key,
      plaintext,
    ),
  );
  const bytes = new Uint8Array(4 + encoded.byteLength + encrypted.byteLength);
  new DataView(bytes.buffer).setUint32(0, encoded.byteLength);
  bytes.set(encoded, 4);
  bytes.set(encrypted, encoded.byteLength + 4);
  return bytes;
}
export async function decryptPart(
  cipher: EnvelopeCipher,
  id: PartIdentity,
  bytes: Uint8Array<ArrayBuffer>,
  expectedWrappedKey?: string,
) {
  try {
    const { header, encoded, offset } = await readHeader(cipher, id, bytes);
    if (
      Object.keys(id).some(
        (key) => header[key as keyof PartIdentity] !== id[key as keyof PartIdentity],
      ) ||
      (expectedWrappedKey !== undefined && header.wrappedKey !== expectedWrappedKey)
    )
      throw new FileError("INVALID_FILE");
    const key = await unwrap(cipher, id, header.wrappedKey);
    const iv = Uint8Array.from(header.iv.match(/../g) ?? [], (b) => Number.parseInt(b, 16));
    return new Uint8Array(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv, additionalData: encoded, tagLength: 128 },
        key,
        bytes.slice(offset),
      ),
    );
  } catch {
    throw new FileError("INVALID_FILE");
  }
}
