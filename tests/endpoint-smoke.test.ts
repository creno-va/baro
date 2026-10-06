import { expect, spyOn, test } from "bun:test";
import { Hono } from "hono";
import { endpointSmoke } from "../scripts/endpoint-smoke";
import { api } from "../src/server/api";
import type { ApiEnvironment } from "../src/server/api/errors";
import { createTestDatabase, testEnvironment } from "./helpers/d1";

const paths = [
  "/api/me/session",
  "/api/v2/lawyers/self-service?limit=1",
  "/api/me/consent",
  "/api/cases",
  "/api/v2/cases",
  "/api/v2/me/usage",
  "/api/v2/me/lawyer/self-profile",
  "/api/v2/cases/deployment-smoke/files",
  "/api/v2/cases/deployment-smoke/reports",
] as const;
function reply(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "private, no-store",
      "x-request-id": "synthetic-deployment-smoke",
      ...headers,
    },
  });
}
function open(path: string) {
  return path === paths[0]
    ? reply({ user: null, needsConsent: false })
    : path === paths[1]
      ? reply({ items: [], nextCursor: null })
      : reply({ error: { code: "UNAUTHENTICATED" } }, 401);
}
function harness(response: (path: string) => Response | Promise<Response> = open) {
  const calls: string[] = [];
  return {
    calls,
    fetch: (async (input, init) => {
      const url = new URL(String(input));
      const path = `${url.pathname}${url.search}`;
      calls.push(path);
      expect(init?.method).toBe("GET");
      expect(init?.credentials).toBe("omit");
      expect(init?.body).toBeUndefined();
      expect(init?.cache).toBe("no-store");
      expect(init?.redirect).toBe("error");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(Object.fromEntries(new Headers(init?.headers))).toEqual({
        "cache-control": "no-cache",
      });
      return response(path);
    }) as typeof fetch,
  };
}

test("open preview and production check the same real route contracts with anonymous GETs", async () => {
  for (const origin of ["https://preview.baro.site", "https://baro.site"]) {
    const h = harness();
    expect(await endpointSmoke(origin, "open", h)).toEqual({ passed: true, checked: paths.length });
    expect(h.calls).toEqual([...paths]);
  }
});

test("all smoke contracts match the real API, auth and migrated database without writes or provider calls", async () => {
  const workerApi = new Hono<ApiEnvironment>().route("/api", api);
  const outbound = spyOn(globalThis, "fetch").mockImplementation((async (
    _input: RequestInfo | URL,
  ): Promise<Response> => {
    throw new Error("Unexpected external request in deployment smoke");
  }) as typeof fetch);
  try {
    for (const [environment, mode, publicBetaEnabled] of [
      ["preview", "open", "false"],
      ["production", "open", "true"],
      ["production", "foundation", "false"],
    ] as const) {
      const db = await createTestDatabase();
      try {
        const origin =
          environment === "preview" ? "https://preview.baro.site" : "https://baro.site";
        const env = {
          ...testEnvironment(db.binding),
          APP_ENV: environment,
          BETTER_AUTH_URL: origin,
          PUBLIC_BETA_ENABLED: publicBetaEnabled,
          CASE_DATA_KEY_V1: btoa("s".repeat(32)).replace(/=+$/, ""),
        };
        const changes = () => db.sqlite.query("SELECT total_changes() AS changes").get();
        const before = changes();
        const h = harness((path) => workerApi.request(`${origin}${path}`, { method: "GET" }, env));
        expect(await endpointSmoke(origin, mode, h)).toEqual({
          passed: true,
          checked: paths.length,
        });
        expect(h.calls).toEqual([...paths]);
        expect(changes()).toEqual(before);
        expect(db.sqlite.query("SELECT count(*) AS count FROM session").get()).toEqual({
          count: 0,
        });
        expect(db.sqlite.query("SELECT count(*) AS count FROM user").get()).toEqual({ count: 0 });
      } finally {
        db.close();
      }
    }
    expect(outbound).not.toHaveBeenCalled();
  } finally {
    outbound.mockRestore();
  }
});

test("actual missing OAuth configuration fails endpoint smoke despite a healthy database", async () => {
  const db = await createTestDatabase();
  try {
    const workerApi = new Hono<ApiEnvironment>().route("/api", api);
    const origin = "https://baro.site";
    const env = {
      ...testEnvironment(db.binding),
      APP_ENV: "production",
      BETTER_AUTH_URL: origin,
      PUBLIC_BETA_ENABLED: "true",
      NAVER_CLIENT_SECRET: "",
    };
    expect((await workerApi.request(`${origin}/api/health/ready`, {}, env)).status).toBe(200);
    const h = harness((path) => workerApi.request(`${origin}${path}`, { method: "GET" }, env));
    expect(await endpointSmoke(origin, "open", h)).toEqual({
      passed: false,
      path: paths[0],
      reason: "http",
    });
    expect(h.calls).toEqual([paths[0]]);
  } finally {
    db.close();
  }
});

test("actual missing case-data key fails directory smoke after health and session pass", async () => {
  const db = await createTestDatabase();
  try {
    const workerApi = new Hono<ApiEnvironment>().route("/api", api);
    const origin = "https://baro.site";
    const env = {
      ...testEnvironment(db.binding),
      APP_ENV: "production",
      BETTER_AUTH_URL: origin,
      PUBLIC_BETA_ENABLED: "true",
      CASE_DATA_KEY_V1: "",
    };
    expect((await workerApi.request(`${origin}/api/health/ready`, {}, env)).status).toBe(200);
    const session = await workerApi.request(`${origin}/api/me/session`, {}, env);
    expect(session.status).toBe(200);
    const sessionBody: unknown = await session.json();
    expect(sessionBody).toEqual({ user: null, needsConsent: false });
    const directory = await workerApi.request(`${origin}${paths[1]}`, {}, env);
    expect(directory.status).toBe(503);
    expect(await directory.json()).toMatchObject({ error: { code: "DEPENDENCY_UNAVAILABLE" } });
    const h = harness((path) => workerApi.request(`${origin}${path}`, { method: "GET" }, env));
    expect(await endpointSmoke(origin, "open", h)).toEqual({
      passed: false,
      path: paths[1],
      reason: "http",
    });
    expect(h.calls).toEqual([paths[0], paths[1]]);
  } finally {
    db.close();
  }
});

test("foundation requires every product route to retain the public-launch gate", async () => {
  const h = harness(() => reply({ error: { code: "BETA_NOT_OPEN" } }, 503));
  expect(await endpointSmoke("https://baro.site", "foundation", h)).toEqual({
    passed: true,
    checked: paths.length,
  });
  expect(h.calls).toEqual([...paths]);
  const accidentallyOpen = harness();
  expect(await endpointSmoke("https://baro.site", "foundation", accidentallyOpen)).toEqual({
    passed: false,
    path: paths[0],
    reason: "http",
  });
});

test("open deployments reject gated, missing and misconfigured APIs even when health passed", async () => {
  for (const status of [404, 500, 503]) {
    const h = harness((path) =>
      path === paths[4] ? reply({ error: { code: "DEPENDENCY_UNAVAILABLE" } }, status) : open(path),
    );
    expect(await endpointSmoke("https://baro.site", "open", h)).toEqual({
      passed: false,
      path: paths[4],
      reason: "http",
    });
  }
});

test("session, directory and protected error payloads must match their actual contracts", async () => {
  for (const [path, invalid] of [
    [paths[0], reply({ user: { id: "unexpected-session" }, needsConsent: false })],
    [paths[0], reply({ user: null })],
    [paths[1], reply({ items: [{}], nextCursor: null })],
    [paths[2], reply({ error: { code: "NOT_FOUND" } }, 401)],
    [paths[2], new Response("not-json", { status: 401, headers: open(paths[2]).headers })],
  ] as const) {
    const h = harness((requested) => (requested === path ? invalid : open(requested)));
    expect(await endpointSmoke("https://preview.baro.site", "open", h)).toEqual({
      passed: false,
      path,
      reason: "invalid-response",
    });
  }
  const h = harness(() => reply({ error: { code: "DEPENDENCY_UNAVAILABLE" } }, 503));
  expect(await endpointSmoke("https://baro.site", "foundation", h)).toMatchObject({
    passed: false,
    reason: "invalid-response",
  });
});

test("all checked routes require no-store and safe request correlation", async () => {
  for (const path of paths) {
    for (const [name, value, reason] of [
      ["cache-control", "private, max-age=60", "missing-no-store"],
      ["x-request-id", "", "missing-correlation"],
      ["x-request-id", "invalid request id", "missing-correlation"],
    ] as const) {
      const h = harness((requested) => {
        const response = open(requested);
        if (requested === path) response.headers.set(name, value);
        return response;
      });
      expect(await endpointSmoke("https://baro.site", "open", h)).toEqual({
        passed: false,
        path,
        reason,
      });
    }
  }
});

test("safe failures never return private payloads, exception messages, or credentials", async () => {
  const secret = "synthetic-private-provider-token";
  for (const response of [
    () => reply({ error: { code: secret }, secret }, 401),
    () => {
      throw new Error(`https://provider.invalid/?token=${secret}`);
    },
  ]) {
    const h = harness((path) => (path === paths[2] ? response() : open(path)));
    const result = await endpointSmoke("https://baro.site", "open", h);
    expect(result.passed).toBe(false);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(Object.keys(result).sort()).toEqual(["passed", "path", "reason"]);
  }
});

test("unknown origins and modes fail before network access", async () => {
  const h = harness();
  for (const origin of ["http://baro.site", "https://attacker.invalid", "https://baro.site/"])
    await expect(endpointSmoke(origin, "open", h)).rejects.toThrow();
  await expect(endpointSmoke("https://baro.site", "unknown" as "open", h)).rejects.toThrow();
  expect(h.calls).toEqual([]);
});
