import { expect, test } from "bun:test";
import { CURRENT_POLICY_VERSIONS } from "../src/contracts/consent";
import { mobileAuthExchangeResponseSchema } from "../src/contracts/mobile-auth";
import { api } from "../src/server/api";
import { nativeAuthChallenge } from "../src/server/auth/native-codes";
import { nativeAuthCallbackBase } from "../src/server/auth/native-expo";
import { SESSION_UPDATE_SECONDS } from "../src/server/auth/policy";
import { createOAuthFixture, responseCookies } from "./helpers/oauth";

const verifier = "a".repeat(43);
for (const provider of ["google", "naver", "kakao"] as const)
  test(`${provider} actual state/proxy/callback/SQL grant exchanges into the existing private Hono session`, async () => {
    const f = await createOAuthFixture(provider);
    try {
      const base = nativeAuthCallbackBase(f.env.APP_ENV);
      if (!base) throw new Error("SYNTHETIC_NATIVE_ENV_INVALID");
      const callback = new URL(base);
      const attemptId = crypto.randomUUID();
      callback.searchParams.set("attemptId", attemptId);
      callback.searchParams.set("challenge", await nativeAuthChallenge(verifier));
      const started = await f.begin(callback.href, callback.href);
      expect(started.response.status).toBe(200);
      const proxy = await f.auth.handler(
        new Request(
          `${f.env.BETTER_AUTH_URL}/api/auth/expo-authorization-proxy?${new URLSearchParams({ authorizationURL: started.url.href })}`,
        ),
      );
      expect(proxy.status).toBe(302);
      expect(proxy.headers.get("location")).toBe(started.url.href);
      const response = await f.callback(started.state, responseCookies(proxy));
      expect(response.status).toBe(302);
      const returned = new URL(response.headers.get("location") ?? "");
      expect(`${returned.protocol}//${returned.host}${returned.pathname}`).toBe(base);
      expect(returned.searchParams.get("attemptId")).toBe(attemptId);
      expect([...returned.searchParams.keys()].sort()).toEqual(["attemptId", "code"]);
      const input = { code: returned.searchParams.get("code"), attemptId, verifier };
      const exchange = (body: unknown, origin?: string) =>
        api.request(
          "/mobile/auth/exchange",
          {
            method: "POST",
            headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
            body: JSON.stringify(body),
          },
          f.env,
        );
      expect((await exchange(input)).status).toBe(403);
      expect(
        (await exchange({ ...input, verifier: "b".repeat(43) }, f.env.BETTER_AUTH_URL)).status,
      ).toBe(401);
      const accepted = await exchange(input, f.env.BETTER_AUTH_URL);
      expect(accepted.status).toBe(200);
      expect(mobileAuthExchangeResponseSchema.parse(await accepted.clone().json()).status).toBe(
        "accepted",
      );
      expect(accepted.headers.get("cache-control")).toContain("no-store");
      const cookie = responseCookies(accepted);
      expect(cookie.length).toBeGreaterThan(0);
      const session = await api.request("/me/session", { headers: { cookie } }, f.env);
      const view = (await session.json()) as {
        user: { id: string; accountType: string };
        needsConsent: boolean;
      };
      expect(view.user.accountType).toBe("customer");
      expect(view.needsConsent).toBe(true);
      const consent = (origin?: string) =>
        api.request(
          "/me/consent",
          {
            method: "PUT",
            headers: { cookie, "content-type": "application/json", ...(origin ? { origin } : {}) },
            body: JSON.stringify({ ...CURRENT_POLICY_VERSIONS, over14Confirmed: true }),
          },
          f.env,
        );
      expect((await consent()).status).toBe(403);
      expect((await consent(f.env.BETTER_AUTH_URL)).status).toBe(200);
      const role = (origin?: string) =>
        api.request(
          "/me/account-type",
          {
            method: "PUT",
            headers: { cookie, "content-type": "application/json", ...(origin ? { origin } : {}) },
            body: JSON.stringify({ accountType: "lawyer" }),
          },
          f.env,
        );
      expect((await role()).status).toBe(403);
      expect((await role(f.env.BETTER_AUTH_URL)).status).toBe(200);
      const deletion = await api.request("/me/deletion", { headers: { cookie } }, f.env);
      expect(((await deletion.json()) as { recentOAuth: boolean }).recentOAuth).toBe(true);
      const replay = await exchange(input, f.env.BETTER_AUTH_URL);
      expect(replay.status).toBe(401);
      expect(replay.headers.get("set-cookie")).toBeNull();
      // The non-auth Hono path must return the sliding cookie, without rewriting OAuth freshness.
      const before = await f.auth.api.getSession({ headers: new Headers({ cookie }) });
      if (!before) throw new Error("SYNTHETIC_SESSION_MISSING");
      expect(before.session.oauthAuthenticatedAt).toBeInstanceOf(Date);
      f.database.sqlite
        .query("UPDATE session SET updated_at=?,expires_at=? WHERE id=?")
        .run(Date.now() - SESSION_UPDATE_SECONDS * 1000 - 1, Date.now() + 1000, before.session.id);
      const refreshed = await api.request("/me/session", { headers: { cookie } }, f.env);
      expect(refreshed.headers.getSetCookie().length).toBeGreaterThan(0);
      expect(((await refreshed.json()) as { needsConsent: boolean }).needsConsent).toBe(false);
      const after = await f.auth.api.getSession({
        headers: new Headers({ cookie: responseCookies(refreshed) }),
      });
      expect(after?.session.oauthAuthenticatedAt).toEqual(before.session.oauthAuthenticatedAt);
      const signedOut = await f.auth.handler(
        new Request(`${f.env.BETTER_AUTH_URL}/api/auth/sign-out`, {
          method: "POST",
          headers: { cookie, origin: f.env.BETTER_AUTH_URL, "content-type": "application/json" },
          body: "{}",
        }),
      );
      expect(signedOut.status).toBe(200);
      const expired = await api.request("/me/session", { headers: { cookie } }, f.env);
      expect(((await expired.json()) as { user: unknown }).user).toBeNull();
    } finally {
      f.database.close();
    }
  });

test("native proxy cannot redirect through an arbitrary provider or a foreign callback", async () => {
  const f = await createOAuthFixture("google");
  try {
    for (const authorizationURL of [
      "https://foreign.example.test/?state=synthetic",
      "https://accounts.google.com/o/oauth2/v2/auth?state=synthetic&redirect_uri=https://foreign.example.test/callback",
    ]) {
      const response = await f.auth.handler(
        new Request(
          `${f.env.BETTER_AUTH_URL}/api/auth/expo-authorization-proxy?${new URLSearchParams({ authorizationURL })}`,
        ),
      );
      expect(response.status).toBe(400);
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("set-cookie")).toBeNull();
    }
  } finally {
    f.database.close();
  }
});

test("malformed native callback never delivers a cookie or issues a grant", async () => {
  const f = await createOAuthFixture("google");
  try {
    const started = await f.begin(
      "baro-dev://other/path?cookie=untrusted",
      "baro-dev://other/path",
    );
    expect(started.response.status).toBe(200);
    const response = await f.callback(started.state, started.cookie);
    const returned = new URL(response.headers.get("location") ?? "");
    expect(returned.href).toBe("baro-dev://auth/callback?error=oauth");
    expect(returned.searchParams.has("cookie")).toBe(false);
    expect(
      f.database.sqlite
        .query("SELECT count(*) n FROM app_metadata WHERE key LIKE 'native-auth:v1:%'")
        .get(),
    ).toEqual({ n: 0 });
  } finally {
    f.database.close();
  }
});

test("missing server auth configuration remains a dependency error instead of invalid client proof", async () => {
  const f = await createOAuthFixture("google");
  try {
    const response = await api.request(
      "/mobile/auth/exchange",
      {
        method: "POST",
        headers: { origin: f.env.BETTER_AUTH_URL, "content-type": "application/json" },
        body: JSON.stringify({ attemptId: crypto.randomUUID(), code: "a".repeat(43), verifier }),
      },
      { ...f.env, BETTER_AUTH_SECRET: "" },
    );
    expect(response.status).toBe(503);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "DEPENDENCY_UNAVAILABLE",
    );
  } finally {
    f.database.close();
  }
});
