import { expect, test } from "bun:test";
import {
  ApiError,
  createDirectoryClient,
  createJsonRequester,
  createSessionClient,
  isApiPath,
} from "@baro/api-client";
import { createSessionScope } from "@baro/client-core";
import { CURRENT_POLICY_VERSIONS } from "@baro/contracts/consent";
import { ApiError as WebApiError } from "../src/client/api/errors";

test("web and mobile share safe errors and preserve the exact mutation body/key without automatic replay", async () => {
  const calls: { path: string; init: RequestInit }[] = [];
  let fail = true;
  const request = createJsonRequester({
    newKey: () => "generated-key",
    transport: async (path, init) => {
      calls.push({ path, init });
      if (fail) throw new Error("private transport diagnostic");
      return Response.json({ accepted: true });
    },
  });
  const options = {
    path: "/api/v2/cases/case_synthetic/actions",
    method: "POST",
    key: "same-key",
    body: { expectedRevision: 7, done: true },
  };
  await expect(request(options)).rejects.toMatchObject({ code: "UNAVAILABLE", retryable: true });
  expect(calls).toHaveLength(1);
  fail = false;
  await expect(request(options)).resolves.toEqual({ accepted: true });
  expect(calls[0]?.init.body).toBe(calls[1]?.init.body);
  expect(new Headers(calls[1]?.init.headers).get("idempotency-key")).toBe("same-key");
  expect(calls[1]?.init.credentials).toBeUndefined();
  expect(WebApiError).toBe(ApiError);
});

test("API paths cannot send credentials or a write to another origin or outside the API", async () => {
  let calls = 0;
  const request = createJsonRequester({
    newKey: () => "key",
    transport: async () => {
      calls++;
      return Response.json({});
    },
  });
  for (const path of [
    "https://other.invalid/api/me",
    "//other.invalid/api/me",
    "/api/../../settings",
    "/api/me#fragment",
    "/api/\\other.invalid",
  ]) {
    expect(isApiPath(path)).toBe(false);
    await expect(request({ path })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  }
  expect(calls).toBe(0);
});

test("a session transition fences stale success, error, and body decode responses", async () => {
  for (const status of [200, 403]) {
    const scope = createSessionScope();
    scope.transition("synthetic-owner-a");
    let release!: (response: Response) => void;
    const request = createJsonRequester({
      newKey: () => "key",
      scope,
      transport: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    });
    const pending = request({ path: "/api/me/session" });
    scope.transition("synthetic-owner-b");
    release(Response.json({ privateOwner: "a", error: { code: "CONSENT_REQUIRED" } }, { status }));
    await expect(pending).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  }
  const scope = createSessionScope();
  let releaseBody!: (value: unknown) => void;
  const response = new Response();
  response.json = () =>
    new Promise((resolve) => {
      releaseBody = resolve;
    });
  const request = createJsonRequester({
    scope,
    newKey: () => "key",
    transport: async () => response,
  });
  const pending = request({ path: "/api/me/session" });
  await Promise.resolve();
  scope.invalidate();
  releaseBody({ owner: "old" });
  await expect(pending).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
});

test("an abort never becomes a retryable network error and malformed/private responses stay safe", async () => {
  const controller = new AbortController();
  const reason = new Error("synthetic cancellation");
  const request = createJsonRequester({
    newKey: () => "key",
    transport: async () => {
      controller.abort(reason);
      throw reason;
    },
  });
  await expect(request({ path: "/api/me/session", signal: controller.signal })).rejects.toBe(
    reason,
  );
  const unavailable = createJsonRequester({
    newKey: () => "key",
    transport: async () => new Response("private non-json diagnostic"),
  });
  await expect(unavailable({ path: "/api/me/session" })).rejects.toMatchObject({
    code: "UNAVAILABLE",
  });
  const denied = createJsonRequester({
    newKey: () => "key",
    transport: async () =>
      Response.json(
        { error: { code: "REVISION_CONFLICT", message: "private SQL" } },
        { status: 409 },
      ),
  });
  await expect(denied({ path: "/api/me/session" })).rejects.toMatchObject({ code: "CONFLICT" });
  try {
    await denied({ path: "/api/me/session" });
  } catch (error) {
    expect((error as Error).message).not.toContain("SQL");
  }
});

test("session reads share only in-flight work, clone permissions, and invalidate between owners", async () => {
  const scope = createSessionScope();
  let reads = 0;
  const http = createJsonRequester({
    scope,
    newKey: () => "key",
    transport: async () => {
      reads++;
      return Response.json({
        user: { id: "synthetic-owner", name: "합성 사용자", accountType: "customer" },
        needsConsent: false,
      });
    },
  });
  const client = createSessionClient(http, scope);
  const [first, peer] = await Promise.all([client.get(), client.get()]);
  expect(reads).toBe(1);
  expect(first).toEqual(peer);
  expect(first.user).not.toBe(peer.user);
  await client.get();
  expect(reads).toBe(2);
  client.invalidate();
  expect(scope.snapshot()).toBe(1);
  await client.get();
  expect(reads).toBe(3);
});

test("session and directory validate canonical wire data and reject invalid consent or filters before IO", async () => {
  const calls: { path: string; init: RequestInit }[] = [];
  const http = createJsonRequester({
    newKey: () => "key",
    transport: async (path, init) => {
      calls.push({ path, init });
      if (path === "/api/me/consent")
        return Response.json({
          required: CURRENT_POLICY_VERSIONS,
          consent: null,
          needsConsent: false,
        });
      return Response.json({
        items: [],
        nextCursor: null,
        expiresAt: "2026-10-23T00:00:00.000Z",
        rotation: { day: "2026-10-22", algorithm: "daily_sha256_pivot_v1" },
      });
    },
  });
  const session = createSessionClient(http);
  await session.saveConsent({ ...CURRENT_POLICY_VERSIONS, over14Confirmed: true });
  expect(calls[0]?.init.body).toBe(
    JSON.stringify({ ...CURRENT_POLICY_VERSIONS, over14Confirmed: true }),
  );
  const directory = createDirectoryClient(http);
  expect(
    (await directory.listPage({ query: "  합성 이름  ", region: "seoul", practiceArea: "civil" }))
      .items,
  ).toEqual([]);
  expect(calls[1]?.path).toBe(
    "/api/v2/lawyers/directory?limit=20&name=%ED%95%A9%EC%84%B1+%EC%9D%B4%EB%A6%84&region=seoul&legalField=civil",
  );
  await expect(directory.listPage({ region: "moderator" })).rejects.toMatchObject({
    code: "VALIDATION_ERROR",
  });
  expect(calls).toHaveLength(2);
});
