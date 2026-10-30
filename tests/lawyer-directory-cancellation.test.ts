import { afterEach, expect, test } from "bun:test";
import { lawyers } from "../src/client/api/lawyers";

const original = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = original;
});
const cursor = "synthetic-next-page-cursor-at-least-thirty-two-characters";
const page = {
  items: [],
  nextCursor: cursor,
  expiresAt: "2026-10-14T00:05:00Z",
  rotation: { day: "2026-10-14", algorithm: "daily_sha256_pivot_v1" },
};
test("directory fetches one page until the caller requests the next, propagating cancellation", async () => {
  const paths: string[] = [];
  globalThis.fetch = (async (path) => {
    paths.push(String(path));
    return Response.json(page);
  }) as typeof fetch;
  const first = await lawyers.listPage({ query: "합성" });
  expect(first.nextCursor).toBe(cursor);
  expect(paths).toHaveLength(1);
  const controller = new AbortController();
  globalThis.fetch = (async (path, init) => {
    paths.push(String(path));
    // The transport can combine caller cancellation with its request deadline.
    expect(init?.signal).toBeDefined();
    expect(init?.signal?.aborted).toBe(false);
    return new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(new DOMException("cancelled", "AbortError")),
        { once: true },
      );
      controller.abort();
    });
  }) as typeof fetch;
  await expect(
    lawyers.listPage({ query: "합성" }, cursor, controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(paths).toHaveLength(2);
  expect(paths[1]).toContain(`cursor=${cursor}`);
  expect(
    paths.every((path) => path.includes("/lawyers/directory?") && !path.includes("self-service")),
  ).toBe(true);
});
