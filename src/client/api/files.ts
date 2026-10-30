import { createFilesClient, type WorkspaceTransport } from "@baro/api-client";
import { createSessionBoundClient } from "@baro/client-core";
import { FILE_TARGET_UPLOAD_CONSISTENCY, V2_LIMITS } from "@baro/contracts/v2";
import { sha256 } from "@noble/hashes/sha2.js";
import { browserSessionScope } from "./context";

export { fileViewSchema, splitObservationEdits, validateUpload } from "@baro/api-client";

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
/** Immutable browser Files allow one bounded pass to hash both file and parts. */
export async function uploadFingerprints(blob: Blob, signal: AbortSignal) {
  const hash = sha256.create(),
    reader = blob.stream().getReader();
  let part = sha256.create();
  let offset = 0;
  const parts = new Map<number, string>();
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      hash.update(value);
      for (let start = 0; blob.size > V2_LIMITS.chunkBytes && start < value.length; ) {
        const length = Math.min(
          value.length - start,
          V2_LIMITS.chunkBytes - (offset % V2_LIMITS.chunkBytes),
        );
        part.update(value.subarray(start, start + length));
        start += length;
        offset += length;
        if (offset % V2_LIMITS.chunkBytes === 0 || offset === blob.size) {
          parts.set(
            Math.floor((offset - 1) / V2_LIMITS.chunkBytes) * V2_LIMITS.chunkBytes,
            hex(part.digest()),
          );
          part.destroy();
          part = sha256.create();
        }
      }
    }
    const contentHash = hex(hash.digest());
    if (blob.size <= V2_LIMITS.chunkBytes) parts.set(0, contentHash);
    return { contentHash, parts };
  } finally {
    hash.destroy();
    part.destroy();
    reader.releaseLock();
  }
}

export function createFilesApi(request: WorkspaceTransport) {
  return createSessionBoundClient(browserSessionScope, () =>
    createFilesClient<File, Blob>({
      request,
      scope: browserSessionScope,
      completionConsistency: FILE_TARGET_UPLOAD_CONSISTENCY,
      uploadConcurrency: 3,
      newKey: () => crypto.randomUUID(),
      openUpload: async (file, signal) => {
        let fingerprints: Awaited<ReturnType<typeof uploadFingerprints>> | undefined;
        return {
          fingerprint: async () => {
            signal.throwIfAborted();
            fingerprints ??= await uploadFingerprints(file, signal);
            return fingerprints.contentHash;
          },
          part: async (start, end) => {
            signal.throwIfAborted();
            const chunk = file.slice(start, end);
            const contentHash = fingerprints?.parts.get(start);
            if (!contentHash || end !== Math.min(start + V2_LIMITS.chunkBytes, file.size))
              throw new Error("UPLOAD_PART_INVALID");
            return { body: chunk, byteLength: chunk.size, contentHash };
          },
          close: () => {},
        };
      },
      download: (response) => response.blob(),
    }),
  );
}
