import { createFilesClient, type WorkspaceTransport } from "@baro/api-client";
import { createSessionBoundClient } from "@baro/client-core";
import { FILE_TARGET_UPLOAD_CONSISTENCY } from "@baro/contracts/v2";
import { sha256 } from "@noble/hashes/sha2.js";
import { browserSessionScope } from "./context";

export { fileViewSchema, splitObservationEdits, validateUpload } from "@baro/api-client";

async function hash(blob: Blob, signal: AbortSignal) {
  const hash = sha256.create(),
    reader = blob.stream().getReader();
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      hash.update(value);
    }
    return Array.from(hash.digest(), (b) => b.toString(16).padStart(2, "0")).join("");
  } finally {
    reader.releaseLock();
  }
}

export function createFilesApi(request: WorkspaceTransport) {
  return createSessionBoundClient(browserSessionScope, () =>
    createFilesClient<File, Blob>({
      request,
      scope: browserSessionScope,
      completionConsistency: FILE_TARGET_UPLOAD_CONSISTENCY,
      newKey: () => crypto.randomUUID(),
      openUpload: async (file, signal) => ({
        fingerprint: async () => {
          signal.throwIfAborted();
          return hash(file, signal);
        },
        part: async (start, end) => {
          signal.throwIfAborted();
          const chunk = file.slice(start, end);
          return { body: chunk, byteLength: chunk.size, contentHash: await hash(chunk, signal) };
        },
        close: () => {},
      }),
      download: (response) => response.blob(),
    }),
  );
}
