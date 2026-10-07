import { afterEach, expect, test } from "bun:test";
import { Hono } from "hono";
import { CURRENT_POLICY_VERSIONS } from "../src/contracts/consent";
import type { ApiEnvironment } from "../src/server/api/errors";
import { saveAccountType } from "../src/server/auth/account-type";
import { createPageAccess } from "../src/server/auth/page-access";
import { SESSION_EXPIRES_SECONDS, SESSION_UPDATE_SECONDS } from "../src/server/auth/policy";
import { createTestDatabase, signedSessionCookie, testEnvironment } from "./helpers/d1";
import { createOAuthFixture, responseCookies } from "./helpers/oauth";

const databases: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function application(syntheticFixture = false) {
  return new Hono<ApiEnvironment>()
    .use(createPageAccess({ syntheticFixture }))
    .all("*", (context) => {
      context.header("cache-control", "public, max-age=3600");
      return context.html("<h1>Synthetic application reached</h1>");
    });
}

async function signedIn(origin?: string) {
  const fixture = await createOAuthFixture("google", undefined, origin);
  databases.push(fixture.database);
  const started = await fixture.begin();
  const callback = await fixture.callback(started.state, started.cookie);
  expect(callback.status).toBe(302);
  const cookie = responseCookies(callback);
  const user = fixture.database.sqlite.query("SELECT id FROM user").get() as { id: string };
  const consent = () => {
    fixture.database.sqlite
      .query(
        "INSERT OR REPLACE INTO user_consents(user_id,terms_version,privacy_version,ai_notice_version,over_14_confirmed,consented_at) VALUES(?,?,?,?,1,?)",
      )
      .run(
        user.id,
        CURRENT_POLICY_VERSIONS.termsVersion,
        CURRENT_POLICY_VERSIONS.privacyVersion,
        CURRENT_POLICY_VERSIONS.aiNoticeVersion,
        new Date().toISOString(),
      );
  };
  return { ...fixture, cookie, userId: user.id, consent };
}

async function expectRedirect(response: Response, destination: string) {
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe(destination);
  expect(response.headers.get("cache-control")).toContain("private, no-store");
  expect(await response.text()).not.toContain("Synthetic application reached");
}

test("anonymous GET and HEAD app entries redirect on the server, including normalized aliases", async () => {
  const database = await createTestDatabase();
  databases.push(database);
  const env = testEnvironment(database.binding);
  for (const path of ["/app", "/app/", "/%61pp", "//app", "/%2fapp", "/app%2f", "/%5capp"])
    for (const method of ["GET", "HEAD"])
      await expectRedirect(
        await application().request(`http://localhost:4321${path}`, { method }, env),
        "/login",
      );
});

test("missing, empty and unrelated cookies reach login even before OAuth is configured", async () => {
  for (const cookie of [
    "",
    "theme=blue",
    "better-auth.session_token=",
    "__Secure-better-auth.session_token=",
    "better-auth.session_token_backup=unrelated",
  ])
    await expectRedirect(
      await application().request("/app", { headers: { cookie } }, { APP_ENV: "local" } as Env),
      "/login",
    );
});

test("other methods cannot render the application or bypass its GET and HEAD guard", async () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
    for (const path of ["/app", "/app/", "/%61pp"]) {
      const response = await application().request(path, { method }, { APP_ENV: "local" } as Env);
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("GET, HEAD");
      expect(response.headers.get("cache-control")).toContain("private, no-store");
      expect(await response.text()).not.toContain("Synthetic application reached");
    }
});

test("only a consenting customer reaches app HTML; consent takes precedence over account type", async () => {
  const fixture = await signedIn();
  const app = application();
  const read = (path = "/app", method = "GET") =>
    app.request(path, { method, headers: { cookie: fixture.cookie } }, fixture.env);
  await expectRedirect(await read(), "/consent");
  await saveAccountType(fixture.env.DB, fixture.userId, "lawyer");
  await expectRedirect(await read(), "/consent");
  fixture.consent();
  await expectRedirect(await read(), "/lawyer");
  await saveAccountType(fixture.env.DB, fixture.userId, "customer");
  for (const path of ["/app", "/app/"])
    for (const method of ["GET", "HEAD"]) {
      const response = await read(path, method);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toContain("private, no-store");
      expect(response.headers.get("location")).toBeNull();
      expect(await response.text()).toBe(
        method === "HEAD" ? "" : "<h1>Synthetic application reached</h1>",
      );
    }
  await expectRedirect(await read("/%61pp?returnTo=https://foreign.test"), "/app");
  fixture.database.sqlite.exec("UPDATE user_consents SET privacy_version='superseded'");
  await expectRedirect(await read(), "/consent");
});

test("expired, tampered and deleted-account sessions never reach the application", async () => {
  const fixture = await signedIn();
  fixture.consent();
  const app = application();
  const read = (cookie = fixture.cookie, method = "GET") =>
    app.request("/app", { method, headers: { cookie } }, fixture.env);
  await expectRedirect(await read("better-auth.session_token=forged-cookie"), "/login");
  fixture.database.sqlite
    .query("INSERT INTO v2_tombstones(target_kind,target_id,deleted_at) VALUES('account',?,?)")
    .run(fixture.userId, new Date().toISOString());
  await expectRedirect(await read(), "/login");
  fixture.database.sqlite.exec("DELETE FROM v2_tombstones; UPDATE session SET expires_at=1");
  for (const method of ["GET", "HEAD"]) {
    const response = await read(fixture.cookie, method);
    await expectRedirect(response, "/login");
    expect(
      response.headers
        .getSetCookie()
        .find((value) => value.startsWith("better-auth.session_token=")),
    ).toContain("Max-Age=0");
  }
});

test("secure OAuth cookies retain the same consent and customer boundary in open production", async () => {
  const fixture = await signedIn("https://baro.example.test");
  expect(fixture.cookie).toContain("__Secure-better-auth.session_token=");
  const env = { ...fixture.env, APP_ENV: "production", PUBLIC_BETA_ENABLED: "true" } as Env;
  const app = application();
  await expectRedirect(
    await app.request("/app", { headers: { cookie: fixture.cookie } }, env),
    "/consent",
  );
  fixture.consent();
  expect((await app.request("/app", { headers: { cookie: fixture.cookie } }, env)).status).toBe(
    200,
  );
});

test("sliding session cookies survive both consent redirects and successful app rendering", async () => {
  const fixture = await signedIn();
  const app = application();
  for (const consented of [false, true]) {
    if (consented) fixture.consent();
    const now = Date.now();
    fixture.database.sqlite
      .query("UPDATE session SET updated_at=?,expires_at=?")
      .run(
        now - SESSION_UPDATE_SECONDS * 1_000 - 1,
        now + (SESSION_EXPIRES_SECONDS - SESSION_UPDATE_SECONDS) * 1_000 - 1,
      );
    const response = await app.request(
      "/app",
      { headers: { cookie: fixture.cookie } },
      fixture.env,
    );
    expect(response.status).toBe(consented ? 200 : 302);
    expect(response.headers.get("cache-control")).toContain("private, no-store");
    const refreshed = response.headers
      .getSetCookie()
      .find((value) => value.startsWith("better-auth.session_token="));
    expect(refreshed).toContain(`Max-Age=${SESSION_EXPIRES_SECONDS}`);
    expect(refreshed).toContain("HttpOnly");
    expect(refreshed).toContain("SameSite=Lax");
  }
});

test("OAuth configuration and database failures return safe 503s without login loops", async () => {
  const database = await createTestDatabase();
  databases.push(database);
  const misconfigured = { ...testEnvironment(database.binding), BETTER_AUTH_SECRET: "" };
  const unavailable = testEnvironment({
    prepare() {
      throw new Error("SQL private credential synthetic-token");
    },
  } as unknown as D1Database);
  const cookie = await signedSessionCookie("synthetic-token", unavailable.BETTER_AUTH_SECRET);
  for (const env of [misconfigured, unavailable]) {
    const response = await application().request("/app", { headers: { cookie } }, env);
    expect(response.status).toBe(503);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("cache-control")).toContain("private, no-store");
    const body = await response.text();
    expect(body).toContain("로그인 상태를 확인할 수 없어요.");
    expect(body).not.toMatch(/SQL|credential|synthetic-token|BETTER_AUTH_SECRET/);
    expect(body).not.toContain("Synthetic application reached");
  }
});

test("a consent-store failure after valid authentication also fails closed", async () => {
  const fixture = await signedIn();
  fixture.database.sqlite.exec("DROP TABLE user_consents");
  const response = await application().request(
    "/app",
    { headers: { cookie: fixture.cookie } },
    fixture.env,
  );
  expect(response.status).toBe(503);
  expect(response.headers.get("location")).toBeNull();
  expect(response.headers.get("cache-control")).toContain("private, no-store");
  expect(await response.text()).not.toMatch(/user_consents|SELECT|Synthetic application reached/);
});

test("the explicit build fixture bypass is local-only and request input cannot enable it", async () => {
  const local = { APP_ENV: "local" } as Env;
  expect((await application(true).request("/app", undefined, local)).status).toBe(200);
  for (const APP_ENV of ["preview", "production"] as const) {
    const response = await application(true).request("/app", undefined, {
      APP_ENV,
      PUBLIC_BETA_ENABLED: "true",
    } as Env);
    await expectRedirect(response, "/login");
  }
  const database = await createTestDatabase();
  databases.push(database);
  const env = testEnvironment(database.binding);
  const response = await application().request(
    "/app?BARO_UI_TEST_FIXTURE=true&PUBLIC_API_MODE=mock&returnTo=https://foreign.test",
    {
      headers: {
        "x-baro-ui-test-fixture": "true",
        "x-forwarded-for": "127.0.0.1",
        cookie: "BARO_UI_TEST_FIXTURE=true; PUBLIC_API_MODE=mock",
      },
    },
    env,
  );
  await expectRedirect(response, "/login");
});

test("closed production stays unavailable before auth and public pages remain unaffected", async () => {
  const closed = { APP_ENV: "production", PUBLIC_BETA_ENABLED: "false" } as Env;
  const app = application(true);
  const response = await app.request("/app", undefined, closed);
  expect(response.status).toBe(503);
  expect(response.headers.get("cache-control")).toContain("private, no-store");
  expect(await response.text()).toContain("공개 베타를 준비하고 있어요.");
  for (const path of ["/", "/login", "/consent", "/lawyers", "/app-icon.svg"])
    expect((await app.request(path, undefined, closed)).status).toBe(200);
});
