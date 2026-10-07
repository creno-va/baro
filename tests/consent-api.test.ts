import { expect, test } from "bun:test";
import { CURRENT_POLICY_VERSIONS } from "../src/contracts/consent";
import { api } from "../src/server/api";
import {
  RECENT_OAUTH_MS,
  SESSION_EXPIRES_SECONDS,
  SESSION_UPDATE_SECONDS,
} from "../src/server/auth/policy";
import { createTestDatabase, signedSessionCookie, testEnvironment } from "./helpers/d1";
import { createOAuthFixture, responseCookies } from "./helpers/oauth";

test("real SQL sessions and consent routes enforce authentication, origin and policy versions", async () => {
  const database = await createTestDatabase();
  const env = testEnvironment(database.binding);
  try {
    const unauthenticated = await api.request("/me/consent", undefined, env);
    expect(unauthenticated.status).toBe(401);
    const error = (await unauthenticated.json()) as { error: { requestId: string } };
    expect(error.error.requestId).toBe(unauthenticated.headers.get("x-request-id") ?? "");

    const now = Date.now();
    database.sqlite
      .query(
        "INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES(?,?,?,1,?,?)",
      )
      .run("user-one", "Synthetic", "synthetic@example.test", now, now);
    database.sqlite
      .query(
        "INSERT INTO session(id,user_id,token,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?)",
      )
      .run("session-one", "user-one", "synthetic-session-token", now + 3_600_000, now, now);
    const cookie = await signedSessionCookie("synthetic-session-token", env.BETTER_AUTH_SECRET);
    const before = await api.request("/me/consent", { headers: { cookie } }, env);
    expect(before.status).toBe(200);
    expect(((await before.json()) as { needsConsent: boolean }).needsConsent).toBe(true);

    const put = (origin: string, body: unknown) =>
      api.request(
        "/me/consent",
        {
          method: "PUT",
          headers: { cookie, origin, "content-type": "application/json" },
          body: JSON.stringify(body),
        },
        env,
      );
    const consent = { ...CURRENT_POLICY_VERSIONS, over14Confirmed: true };
    expect((await put("https://attacker.example", consent)).status).toBe(403);
    expect((await put("", consent)).status).toBe(403);
    expect((await put(env.BETTER_AUTH_URL, { ...consent, termsVersion: "old" })).status).toBe(400);
    expect((await put(env.BETTER_AUTH_URL, { ...consent, over14Confirmed: false })).status).toBe(
      400,
    );
    expect((await put(env.BETTER_AUTH_URL, { ...consent, extra: true })).status).toBe(400);
    expect((await put(env.BETTER_AUTH_URL, consent)).status).toBe(200);
    const after = await api.request("/me/consent", { headers: { cookie } }, env);
    expect(((await after.json()) as { needsConsent: boolean }).needsConsent).toBe(false);
    database.sqlite.exec("UPDATE user_consents SET privacy_version='old'");
    const changedPolicy = await api.request("/me/consent", { headers: { cookie } }, env);
    expect(changedPolicy.status).toBe(200);
    expect(((await changedPolicy.json()) as { needsConsent: boolean }).needsConsent).toBe(true);

    database.sqlite.exec("UPDATE session SET expires_at=1");
    expect((await api.request("/me/consent", { headers: { cookie } }, env)).status).toBe(401);
  } finally {
    database.close();
  }
});

test("production foundation gate and unknown routes fail with safe correlated errors", async () => {
  const closed = await api.request("/auth/sign-in/social", { method: "POST" }, {
    APP_ENV: "production",
    PUBLIC_BETA_ENABLED: "false",
  } as Env);
  expect(closed.status).toBe(503);
  expect(((await closed.json()) as { error: { code: string } }).error.code).toBe("BETA_NOT_OPEN");
  const response = await api.request("/does-not-exist", {
    headers: { "x-request-id": "a".repeat(129) },
  });
  expect(response.status).toBe(404);
  const error = (await response.json()) as { error: { requestId: string } };
  expect(error.error.requestId).toBe(response.headers.get("x-request-id") ?? "");
  expect(error.error.requestId.length).toBeLessThan(129);
});

test("oversize bodies fail before route handling without reflecting input", async () => {
  const response = await api.request("/does-not-exist", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ narrative: "x".repeat(65_537) }),
  });
  expect(response.status).toBe(413);
  const body = (await response.json()) as { error: { code: string; requestId: string } };
  expect(body.error.code).toBe("BODY_TOO_LARGE");
  expect(body.error.requestId).toBe(response.headers.get("x-request-id") ?? "");
});

test("unexpected database errors do not leak SQL or credentials", async () => {
  const env = testEnvironment({
    prepare() {
      throw new Error("synthetic SQL credential material must remain private");
    },
  } as unknown as D1Database);
  const cookie = await signedSessionCookie("synthetic-session-token", env.BETTER_AUTH_SECRET);
  const response = await api.request("/me/consent", { headers: { cookie } }, env);
  expect(response.status).toBe(500);
  const body = await response.text();
  expect(body).not.toContain("SQL credential");
  expect(body).toContain("INTERNAL_ERROR");
});

test("consent routes forward sliding and expired cookies while preserving the actual OAuth timestamp", async () => {
  const fixture = await createOAuthFixture("google");
  try {
    const start = await fixture.begin();
    const callback = await fixture.callback(start.state, start.cookie);
    const cookie = responseCookies(callback);
    const oauthTimestamp = Date.now() - RECENT_OAUTH_MS - 1;
    fixture.database.sqlite
      .query("UPDATE session SET oauth_authenticated_at=?")
      .run(oauthTimestamp);
    for (const method of ["GET", "PUT"] as const) {
      const now = Date.now();
      fixture.database.sqlite
        .query("UPDATE session SET updated_at=?,expires_at=?")
        .run(
          now - SESSION_UPDATE_SECONDS * 1_000 - 1,
          now + (SESSION_EXPIRES_SECONDS - SESSION_UPDATE_SECONDS) * 1_000 - 1,
        );
      const response = await api.request(
        "/me/consent",
        {
          method,
          headers: {
            cookie,
            origin: fixture.env.BETTER_AUTH_URL,
            "content-type": "application/json",
          },
          ...(method === "PUT"
            ? { body: JSON.stringify({ ...CURRENT_POLICY_VERSIONS, over14Confirmed: true }) }
            : {}),
        },
        fixture.env,
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      const sessionCookie = response.headers
        .getSetCookie()
        .find((value) => value.startsWith("better-auth.session_token="));
      expect(sessionCookie).toContain(`Max-Age=${SESSION_EXPIRES_SECONDS}`);
      expect(sessionCookie).toContain("HttpOnly");
      expect(sessionCookie).toContain("SameSite=Lax");
      const row = fixture.database.sqlite
        .query("SELECT updated_at,expires_at,oauth_authenticated_at FROM session")
        .get() as { updated_at: number; expires_at: number; oauth_authenticated_at: number };
      expect(row.updated_at).toBeGreaterThanOrEqual(now);
      expect(row.expires_at).toBeGreaterThanOrEqual(now + SESSION_EXPIRES_SECONDS * 1_000);
      expect(row.oauth_authenticated_at).toBe(oauthTimestamp);
    }
    fixture.database.sqlite.exec("UPDATE session SET expires_at=1");
    const expired = await api.request("/me/consent", { headers: { cookie } }, fixture.env);
    expect(expired.status).toBe(401);
    expect(
      expired.headers
        .getSetCookie()
        .find((value) => value.startsWith("better-auth.session_token=")),
    ).toContain("Max-Age=0");
  } finally {
    fixture.database.close();
  }
});
