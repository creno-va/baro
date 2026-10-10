import { afterEach, expect, test } from "bun:test";
import { lawyers } from "../src/client/api/lawyers";

const original = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = original;
});
const snapshot = {
  schemaVersion: "2",
  snapshotId: "synthetic-directory",
  rotation: "disclosed_rotation",
  expiresAt: "2026-10-06T00:05:00Z",
  items: [],
  nextCursor: "synthetic-next",
};
test("cancelling directory pagination aborts its fetch and never starts self-service requests", async () => {
  const controller = new AbortController();
  const paths: string[] = [];
  globalThis.fetch = (async (path, init) => {
    paths.push(String(path));
    expect(init?.signal).toBe(controller.signal);
    if (paths.length === 1) return Response.json(snapshot);
    return await new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(new DOMException("cancelled", "AbortError")),
        { once: true },
      );
      controller.abort();
    });
  }) as typeof fetch;
  await expect(lawyers.list({}, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(paths).toHaveLength(2);
  expect(paths.every((path) => !path.includes("self-service"))).toBe(true);
});
