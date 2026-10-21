import { afterEach, expect, test } from "bun:test";
import { casesApi } from "../src/client/api/cases";
import { sessionApi } from "../src/client/api/session";
import { workspace } from "./fixtures/contracts/v2";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("simultaneous session checks share an in-flight read but settled permissions are never cached", async () => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reads = 0;
  let owner = "synthetic-owner";
  globalThis.fetch = (async () => {
    reads++;
    await gate;
    return Response.json({
      user: { id: owner, name: "합성 사용자", accountType: "customer" },
      needsConsent: false,
    });
  }) as unknown as typeof fetch;
  const pending = [sessionApi.get(), sessionApi.get(), sessionApi.get()];
  expect(reads).toBe(1);
  release();
  const sessions = await Promise.all(pending);
  expect(sessions).toHaveLength(3);
  expect(reads).toBe(1);
  if (sessions[0]?.user) sessions[0].user.accountType = "lawyer";
  expect(sessions[1]?.user?.accountType).toBe("customer");
  owner = "synthetic-other-owner";
  expect((await sessionApi.get()).user?.id).toBe(owner);
  expect(reads).toBe(2);
});

test("a failed shared session request can be retried without preserving stale access", async () => {
  let reads = 0;
  globalThis.fetch = (async () => {
    reads++;
    if (reads === 1) throw new Error("synthetic outage");
    return Response.json({ user: null, needsConsent: false });
  }) as unknown as typeof fetch;
  const results = await Promise.allSettled([sessionApi.get(), sessionApi.get()]);
  expect(results.map((result) => result.status)).toEqual(["rejected", "rejected"]);
  expect(reads).toBe(1);
  expect((await sessionApi.get()).user).toBeNull();
  expect(reads).toBe(2);
});

test("the current case list starts while legacy history is still pending", async () => {
  let release = () => {},
    started = () => {};
  const legacyGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const currentStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const paths: string[] = [];
  globalThis.fetch = (async (url) => {
    paths.push(String(url));
    if (String(url).startsWith("/api/cases?")) {
      await legacyGate;
      return Response.json({ items: [], nextCursor: null });
    }
    started();
    return Response.json({
      items: [workspace],
      nextCursor: null,
      previews: [{ id: workspace.id, title: "합성 목록", hasSummary: true }],
    });
  }) as typeof fetch;
  const list = casesApi.list();
  await currentStarted;
  expect(paths).toHaveLength(2);
  release();
  expect((await list)[0]?.title).toBe("합성 목록");
  expect(paths).toHaveLength(2);
});
