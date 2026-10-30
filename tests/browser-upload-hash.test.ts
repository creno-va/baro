import { expect, test } from "bun:test";
import { V2_LIMITS } from "@baro/contracts/v2";
import { uploadFingerprints } from "../src/client/api/files";

const digest = async (bytes: Uint8Array<ArrayBuffer>) =>
  Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString("hex");
test("one-pass browser hashing matches full original and exact negotiated chunk boundaries", async () => {
  const bytes = new Uint8Array(V2_LIMITS.chunkBytes + 91).fill(73);
  bytes[V2_LIMITS.chunkBytes - 1] = 15;
  bytes[V2_LIMITS.chunkBytes] = 27;
  const result = await uploadFingerprints(new Blob([bytes]), new AbortController().signal);
  expect(result.contentHash).toBe(await digest(bytes));
  expect(result.parts.get(0)).toBe(await digest(bytes.subarray(0, V2_LIMITS.chunkBytes)));
  expect(result.parts.get(V2_LIMITS.chunkBytes)).toBe(
    await digest(bytes.subarray(V2_LIMITS.chunkBytes)),
  );
  expect(result.parts.size).toBe(2);
});
test("account revocation stops browser hashing before any source read", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    uploadFingerprints(new Blob(["synthetic"]), controller.signal),
  ).rejects.toBeDefined();
});
