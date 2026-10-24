import { expect, test } from "bun:test";
import {
  ApiError,
  createJsonRequester,
  createMobileAuthClient,
  type JsonRequest,
} from "@baro/api-client";
import { createSessionScope } from "@baro/client-core";
import { mobileDeletionOutcomeSchema } from "@baro/contracts/mobile-deletion";
import { resolveMobileConfig } from "../apps/mobile/config/environment";
import { createNativeCredentials } from "../apps/mobile/src/platform/auth/credentials";
import { createNativeDeletionTransport } from "../apps/mobile/src/platform/auth/deletion-transport";

const config = resolveMobileConfig({ environment: "preview" }),
  path = "/api/mobile/auth/deletion/status";
const headers = { "content-type": "application/json", "x-baro-auth-contract": "2" };
const proof = { attemptId: crypto.randomUUID(), verifier: "a".repeat(43) },
  tag = "b".repeat(64);
const outcome = {
  contractVersion: 2,
  status: "accepted",
  ownerTag: tag,
  appleRevocation: "unconfirmed",
} as const;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("native deletion completion sends only proof protocol headers and never exposes or applies Set-Cookie", async () => {
  const requests: RequestInit[] = [];
  const transport = createNativeDeletionTransport({
    config,
    fetch: async (url, init) => {
      expect(url).toBe(config.apiBaseUrl + path);
      requests.push(init);
      return Response.json(outcome, {
        headers: { "set-cookie": "synthetic-stale-cookie=forbidden" },
      });
    },
  });
  const response = await transport(path, {
    method: "POST",
    headers: {
      ...headers,
      cookie: "synthetic-private-cookie",
      authorization: "synthetic-private-bearer",
      "expo-origin": "synthetic-private-origin",
      "expo-cookie": "synthetic-private-sdk-cookie",
      referer: "synthetic-private-callback",
    },
    body: JSON.stringify(proof),
    credentials: "include",
    redirect: "follow",
    cache: "force-cache",
    referrer: "https://foreign.example.test/private",
  });
  expect(requests).toHaveLength(1);
  const sent = requests[0];
  expect(Object.fromEntries(new Headers(sent?.headers))).toEqual({
    ...headers,
    origin: config.apiBaseUrl,
  });
  expect(sent).toMatchObject({
    credentials: "omit",
    redirect: "error",
    cache: "no-store",
    referrer: "",
    referrerPolicy: "no-referrer",
    body: JSON.stringify(proof),
  });
  expect(response.headers.has("set-cookie")).toBe(false);
  expect(response.clone().headers.has("set-cookie")).toBe(false);
  expect(mobileDeletionOutcomeSchema.parse(await response.json())).toEqual(outcome);
});

for (const [url, method, extra] of [
  ["https://foreign.example.test/api/mobile/auth/deletion/status", "POST", {}],
  ["/api/mobile/auth/deletion/prepare", "POST", {}],
  ["/api/mobile/auth/exchange", "POST", {}],
  ["/api/mobile/auth/deletion/status?token=synthetic", "POST", {}],
  ["/api/mobile/auth/deletion/status#synthetic", "POST", {}],
  ["https://synthetic@preview.baro.site/api/mobile/auth/deletion/status", "POST", {}],
  [path, "GET", {}],
  [path, "POST", { "x-baro-auth-contract": "1" }],
  [path, "POST", { "content-type": "application/x-www-form-urlencoded" }],
] as const)
  test(`completion transport rejects unrelated path, method or protocol before IO: ${url}/${method}/${JSON.stringify(extra)}`, async () => {
    let calls = 0;
    const transport = createNativeDeletionTransport({
      config,
      fetch: async () => {
        calls++;
        return Response.json(outcome);
      },
    });
    await expect(
      transport(url, { method, headers: { ...headers, ...extra }, body: JSON.stringify(proof) }),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(calls).toBe(0);
  });

for (const kind of ["redirect", "foreign", "other-path", "aborted-after"] as const)
  test(`completion cannot consume a redirected or retired response and discards its body: ${kind}`, async () => {
    let discarded = false;
    const abort = new AbortController();
    const transport = createNativeDeletionTransport({
      config,
      fetch: async () => {
        const response = new Response(
          new ReadableStream({
            cancel() {
              discarded = true;
            },
          }),
          { headers: { "set-cookie": "synthetic-stale" } },
        );
        if (kind === "redirect") Object.defineProperty(response, "redirected", { value: true });
        if (kind === "foreign")
          Object.defineProperty(response, "url", { value: `https://foreign.example.test${path}` });
        if (kind === "other-path")
          Object.defineProperty(response, "url", {
            value: `${config.apiBaseUrl}/api/auth/sign-out`,
          });
        if (kind === "aborted-after") abort.abort();
        return response;
      },
    });
    await expect(
      transport(path, { method: "POST", headers, signal: abort.signal }),
    ).rejects.toBeDefined();
    expect(discarded).toBe(true);
  });

test("abort before IO sends no proof; an anonymous failure cannot clear any current cookie", async () => {
  const abort = new AbortController();
  abort.abort();
  let calls = 0;
  const transport = createNativeDeletionTransport({
    config,
    fetch: async () => {
      calls++;
      return Response.json(
        { error: { code: "UNAUTHENTICATED" } },
        { status: 401, headers: { "set-cookie": "better-auth.session_token=; Max-Age=0" } },
      );
    },
  });
  await expect(
    transport(path, { method: "POST", headers, signal: abort.signal }),
  ).rejects.toBeDefined();
  expect(calls).toBe(0);
  const response = await transport(path, { method: "POST", headers });
  expect(response.status).toBe(401);
  expect(response.headers.has("set-cookie")).toBe(false);
});

test("an old owner's delayed completion survives session deletion and owner changes without reading, clearing or replacing the new jar", async () => {
  const disk = new Map<string, string>([["unsettled_case_operations", "preserve"]]),
    scope = createSessionScope();
  let reads = 0,
    writes = 0;
  const credentials = createNativeCredentials({
    scope,
    namespace: "synthetic_auth",
    storage: {
      getItemAsync: async (key) => {
        reads++;
        return disk.get(key) ?? null;
      },
      setItemAsync: async (key, value) => {
        writes++;
        disk.set(key, value);
      },
    },
    manageStorage: (storage) => storage,
    codec: {
      header: (value) => (value ? (JSON.parse(value).cookie ?? "") : ""),
      merge: (header) => JSON.stringify({ cookie: header }),
    },
  });
  await credentials.capture().accept("synthetic-owner-A");
  const response = deferred<Response>(),
    entered = deferred<void>();
  const completionRequest = createJsonRequester({
    newKey: () => crypto.randomUUID(),
    transport: createNativeDeletionTransport({
      config,
      fetch: async () => {
        entered.resolve();
        return response.promise;
      },
    }),
  });
  const request: JsonRequest = async () => {
    throw new Error("AUTHENTICATED_REQUEST_MUST_NOT_RUN");
  };
  const client = createMobileAuthClient({ request, completionRequest });
  const pending = client.deletionStatus(proof, tag);
  await entered.promise;
  await credentials.reset();
  scope.transition("new-owner-B");
  await credentials.capture().accept("synthetic-owner-B");
  const before = JSON.stringify([...disk]),
    priorReads = reads,
    priorWrites = writes;
  response.resolve(
    Response.json(outcome, { headers: { "set-cookie": "synthetic-owner-A-expired" } }),
  );
  expect(await pending).toEqual(outcome);
  expect(JSON.stringify([...disk])).toBe(before);
  expect(reads).toBe(priorReads);
  expect(writes).toBe(priorWrites);
  expect(await credentials.capture().cookie()).toBe("synthetic-owner-B");
  expect(disk.get("unsettled_case_operations")).toBe("preserve");
});

test("signed activity is the same cookie-free exact-path POST and cannot leak its proof through redirect/query headers", async () => {
  let calls = 0;
  const activityPath = "/api/mobile/auth/deletion/activity";
  const transport = createNativeDeletionTransport({
    config,
    fetch: async (url, init) => {
      calls++;
      expect(url).toBe(config.apiBaseUrl + activityPath);
      expect(Object.fromEntries(new Headers(init.headers))).toEqual({
        ...headers,
        origin: config.apiBaseUrl,
      });
      expect(init.credentials).toBe("omit");
      expect(init.redirect).toBe("error");
      return Response.json(
        { status: "inactive", outcome: "unknown" },
        { headers: { "set-cookie": "SYNTHETIC_STALE_A" } },
      );
    },
  });
  const input = { ...proof, ownerTag: "a".repeat(64), startedAt: 1, activityProof: "b".repeat(64) };
  const response = await transport(activityPath, {
    method: "POST",
    headers: {
      ...headers,
      cookie: "SYNTHETIC_B",
      authorization: "SYNTHETIC_BEARER",
      "x-baro-deletion-activity": "1",
    },
    body: JSON.stringify(input),
  });
  expect(response.headers.has("set-cookie")).toBe(false);
  expect(response.clone().headers.has("set-cookie")).toBe(false);
  await expect(
    transport(`${activityPath}?activityProof=synthetic`, { method: "POST", headers }),
  ).rejects.toBeInstanceOf(ApiError);
  expect(calls).toBe(1);
});
