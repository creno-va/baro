import { expect, test } from "bun:test";
import { CURRENT_POLICY_VERSIONS } from "../src/contracts/consent";
import { api } from "../src/server/api";
import { createTestDatabase, signedSessionCookie, testEnvironment } from "./helpers/d1";

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
