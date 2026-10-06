import { z } from "zod";
import { opaqueIdSchema } from "../../../contracts";
import type { EnvelopeCipher } from "../../crypto";
import { digest, hex } from "../files/binary";
import { MAX_ARTIFACT_BYTES, ProcessingError } from "./protocol";

const headerSchema = z.strictObject({
  version: z.literal(1),
  environment: z.enum(["preview", "production"]),
  ownerId: opaqueIdSchema,
  blobId: opaqueIdSchema,
  fileId: opaqueIdSchema,
  fileRevision: z.number().int().positive(),
  purpose: z.literal("processing_artifact"),
  byteLength: z.number().int().positive().max(MAX_ARTIFACT_BYTES),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  key: z.string().regex(/^[a-f0-9]{64}$/),
  iv: z.string().regex(/^[a-f0-9]{24}$/),
});
export type ArtifactIdentity = Pick<
  z.infer<typeof headerSchema>,
  "environment" | "ownerId" | "blobId" | "fileId" | "fileRevision"
>;
const context = (id: ArtifactIdentity) => ({
  table: "v2_blobs" as const,
  column: "encrypted_payload" as const,
  rowId: id.blobId,
  userId: id.ownerId,
  revision: 1,
});
const fromHex = (value: string) =>
  Uint8Array.from(value.match(/../g) ?? [], (b) => Number.parseInt(b, 16));
export async function encryptArtifact(
  cipher: EnvelopeCipher,
  id: ArtifactIdentity,
  bytes: Uint8Array<ArrayBuffer>,
) {
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_ARTIFACT_BYTES)
    throw new ProcessingError("FILE_REJECTED");
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt"]);
  const header = headerSchema.parse({
    ...id,
    version: 1,
    purpose: "processing_artifact",
    byteLength: bytes.byteLength,
    contentHash: await digest(bytes),
    key: hex(raw),
    iv: hex(iv),
  });
  const encoded = new TextEncoder().encode(
    await cipher.encrypt(JSON.stringify(header), context(id)),
  );
  raw.fill(0);
  if (encoded.byteLength > 4096) throw new ProcessingError("FILE_REJECTED");
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoded }, key, bytes),
  );
  const output = new Uint8Array(4 + encoded.byteLength + encrypted.byteLength);
  new DataView(output.buffer).setUint32(0, encoded.byteLength);
  output.set(encoded, 4);
  output.set(encrypted, encoded.byteLength + 4);
  return output;
}
export async function decryptArtifact(
  cipher: EnvelopeCipher,
  id: ArtifactIdentity,
  bytes: Uint8Array<ArrayBuffer>,
) {
  try {
    if (bytes.byteLength < 21 || bytes.byteLength > MAX_ARTIFACT_BYTES + 4116) throw new Error();
    const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
    if (size < 1 || size > 4096 || size + 20 >= bytes.byteLength) throw new Error();
    const encoded = bytes.slice(4, size + 4);
    const header = headerSchema.parse(
      JSON.parse(
        await cipher.decrypt(
          new TextDecoder("utf-8", { fatal: true }).decode(encoded),
          context(id),
        ),
      ),
    );
    if (
      Object.keys(id).some(
        (k) => header[k as keyof ArtifactIdentity] !== id[k as keyof ArtifactIdentity],
      ) ||
      bytes.byteLength !== 4 + size + header.byteLength + 16
    )
      throw new Error();
    const key = await crypto.subtle.importKey("raw", fromHex(header.key), "AES-GCM", false, [
      "decrypt",
    ]);
    const data = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: fromHex(header.iv), additionalData: encoded },
        key,
        bytes.slice(4 + size),
      ),
    );
    if ((await digest(data)) !== header.contentHash) {
      data.fill(0);
      throw new Error();
    }
    return data;
  } catch {
    throw new ProcessingError("FILE_REJECTED");
  }
}
