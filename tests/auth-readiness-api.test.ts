import { expect, test } from "bun:test";
import { Hono } from "hono";
import { api } from "../src/server/api";
import type { ApiEnvironment } from "../src/server/api/errors";

const workerApi = new Hono<ApiEnvironment>().route("/api", api);

test("missing OAuth configuration returns a private safe dependency error before database queries", async () => {
  let databaseReads = 0;
  const env = {
    APP_ENV: "preview",
    BETTER_AUTH_URL: "https://preview.baro.site",
    BETTER_AUTH_SECRET: "synthetic-auth-secret-at-least-32-characters",
    GOOGLE_CLIENT_ID: "synthetic-provider-value",
    GOOGLE_CLIENT_SECRET: "synthetic-provider-secret",
    DB: {
      prepare() {
        databaseReads++;
        throw new Error("UNEXPECTED_DATABASE_ACCESS");
      },
    },
  } as unknown as Env;
  for (const [path, method] of [
    ["/api/me/session", "GET"],
    ["/api/auth/sign-in/social", "POST"],
  ] as const) {
    const response = await workerApi.request(
      path,
      { method, headers: { "x-request-id": "synthetic-auth-readiness" } },
      env,
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-request-id")).toBe("synthetic-auth-readiness");
    const body = await response.text();
    expect(JSON.parse(body)).toMatchObject({
      error: { code: "DEPENDENCY_UNAVAILABLE", details: {}, retryable: true },
    });
    expect(body).not.toContain("CLIENT_SECRET");
    expect(body).not.toContain("synthetic-provider");
    expect(body).not.toContain("AUTH_CONFIGURATION_INVALID");
  }
  expect(databaseReads).toBe(0);
});

test("production auth remains private and closed before missing configuration is evaluated", async () => {
  for (const path of ["/api/me/session", "/api/auth/sign-in/social"]) {
    const response = await workerApi.request(path, undefined, {
      APP_ENV: "production",
      PUBLIC_BETA_ENABLED: "false",
    } as Env);
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({ error: { code: "BETA_NOT_OPEN" } });
  }
});

test("the global production gate preserves no-store for public directory routes", async () => {
  for (const path of ["/api/v2/lawyers", "/api/v2/lawyers/self-service"]) {
    const response = await workerApi.request(path, undefined, {
      APP_ENV: "production",
      PUBLIC_BETA_ENABLED: "false",
    } as Env);
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toBeTruthy();
    expect(await response.json()).toMatchObject({ error: { code: "BETA_NOT_OPEN" } });
  }
});
