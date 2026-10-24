import { expect, test } from "bun:test";
import { Hono } from "hono";
import {
  MOBILE_AUTH_CONTRACT_HEADER,
  mobileAuthExchangeResponseSchema,
} from "../src/contracts/mobile-auth";
import { mobileDeletionOutcomeSchema } from "../src/contracts/mobile-deletion";
import { api } from "../src/server/api";
import { getAuth } from "../src/server/auth";
import {
  APPLE_CALLBACK_BODY_BYTES,
  createAppleCallbackBoundary,
} from "../src/server/auth/apple-callback";
import { nativeAuthChallenge } from "../src/server/auth/native-codes";
import { nativeAuthCallbackBase } from "../src/server/auth/native-expo";
import { syntheticAppleConfiguration } from "./helpers/apple-configuration";
import { createTestDatabase, testEnvironment } from "./helpers/d1";
import { responseCookies } from "./helpers/oauth";

const workerApi = new Hono().route("/api", api);
const endpoint = "http://localhost:4321/api/auth/callback/apple",
  state = "a".repeat(32);
const boundary = createAppleCallbackBoundary();
async function inspect(request: Request) {
  return boundary.onRequest?.(request, {} as never);
}
for (const scenario of [
  "origin",
  "no-origin",
  "json",
  "query",
  "duplicate-state",
  "duplicate-code",
  "duplicate-ignored",
  "bad-state",
  "missing-code",
  "both",
  "oversized",
  "bad-name",
  "bad-utf8",
] as const)
  test(`Apple POST boundary rejects ambiguous/untrusted input without touching SDK or provider: ${scenario}`, async () => {
    const form = new URLSearchParams({ state, code: "synthetic-code" });
    if (scenario === "duplicate-state") form.append("state", state);
    if (scenario === "duplicate-code") form.append("code", "other-code");
    if (scenario === "duplicate-ignored") {
      form.append("id_token", "synthetic");
      form.append("id_token", "other");
    }
    if (scenario === "bad-state") form.set("state", "invalid");
    if (scenario === "missing-code") form.delete("code");
    if (scenario === "both") form.set("error", "access_denied");
    if (scenario === "bad-name")
      form.set("user", JSON.stringify({ name: { firstName: "a".repeat(129) } }));
    if (scenario === "oversized") form.set("id_token", "a".repeat(APPLE_CALLBACK_BODY_BYTES));
    const response = await inspect(
      new Request(endpoint + (scenario === "query" ? "?code=override" : ""), {
        method: "POST",
        headers: {
          ...(scenario === "no-origin"
            ? {}
            : {
                origin:
                  scenario === "origin"
                    ? "https://foreign.example.test"
                    : "https://appleid.apple.com",
              }),
          "content-type":
            scenario === "json" ? "application/json" : "application/x-www-form-urlencoded",
        },
        body: scenario === "bad-utf8" ? new Uint8Array([0xff]) : form.toString(),
      }),
    );
    if (!response || !("response" in response)) throw new Error("SYNTHETIC_EXPECTED_REJECTION");
    expect(response.response.status).toBe(scenario === "oversized" ? 413 : 400);
    expect(response.response.headers.get("cache-control")).toContain("no-store");
    expect(response.response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(await response.response.text()).not.toContain("synthetic-code");
  });

test("Apple form normalization strips frontchannel token/email/raw provider descriptions and preserves only bounded display names", async () => {
  for (const error of [false, true]) {
    const form = new URLSearchParams({
      state,
      ...(error
        ? { error: "synthetic-private-error", error_description: "synthetic-private-description" }
        : {
            code: "synthetic-code",
            id_token: "synthetic-frontchannel-token",
            user: JSON.stringify({
              email: "synthetic-private@example.test",
              name: { firstName: "Synthetic", lastName: "Person" },
            }),
          }),
    });
    const result = await inspect(
      new Request(endpoint, {
        method: "POST",
        headers: {
          origin: "https://appleid.apple.com",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
      }),
    );
    if (!result || !("request" in result)) throw new Error("SYNTHETIC_EXPECTED_REQUEST");
    const normalized = new URLSearchParams(await result.request.text());
    expect(Object.fromEntries(normalized)).toEqual(
      error
        ? { state, error: "access_denied" }
        : {
            state,
            code: "synthetic-code",
            user: JSON.stringify({ name: { firstName: "Synthetic", lastName: "Person" } }),
          },
    );
  }
});

const rsa = await crypto.subtle.generateKey(
  {
    name: "RSASSA-PKCS1-v1_5",
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: "SHA-256",
  },
  false,
  ["sign", "verify"],
);
const publicKey = {
  ...(await crypto.subtle.exportKey("jwk", rsa.publicKey)),
  kid: "synthetic-user-key",
  alg: "RS256",
  use: "sig",
};
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
async function idToken(nonce: string, email: boolean) {
  const seconds = Math.floor(Date.now() / 1000),
    value = `${encode({ alg: "RS256", kid: publicKey.kid })}.${encode({ iss: "https://appleid.apple.com", aud: "site.baro.synthetic", sub: "synthetic-real-sdk-subject", iat: seconds, exp: seconds + 300, nonce, ...(email ? { email: "synthetic@privaterelay.appleid.com", email_verified: true } : {}) })}`;
  return `${value}.${Buffer.from(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", rsa.privateKey, new TextEncoder().encode(value))).toString("base64url")}`;
}
for (const flow of [
  "login",
  "reauthentication",
  "deletion",
  "cancel",
  "wrong-cookie",
  "wrong-nonce",
] as const)
  test(`configured Apple uses production provider, proxy, bounded POST/GET state and RSA/nonce validation: ${flow}`, async () => {
    const db = await createTestDatabase(),
      originalFetch = globalThis.fetch;
    try {
      const env = Object.assign(testEnvironment(db.binding), syntheticAppleConfiguration()),
        auth = getAuth(env),
        p = (await auth.$context).socialProviders.find((value) => value.id === "apple");
      if (!p) throw new Error("SYNTHETIC_APPLE_NOT_CONFIGURED");
      let expected = "",
        email = true,
        exchanges = 0,
        revokes = 0;
      globalThis.fetch = (async (url) => {
        const value = String(url);
        if (value === "https://appleid.apple.com/auth/keys")
          return Response.json({ keys: [publicKey] });
        if (value === "https://appleid.apple.com/auth/revoke") {
          revokes++;
          expect(db.sqlite.query("SELECT count(*) n FROM user").get()).toEqual({ n: 0 });
          return new Response(null, { status: 200 });
        }
        throw new Error("SYNTHETIC_UNEXPECTED_NETWORK");
      }) as typeof fetch;
      p.validateAuthorizationCode = async () => {
        exchanges++;
        return {
          idToken: await idToken(expected, email),
          accessToken: "synthetic-access",
          refreshToken: "synthetic-refresh",
        };
      };
      const begin = async (callbackURL: string) => {
        const response = await auth.handler(
          new Request(`${env.BETTER_AUTH_URL}/api/auth/sign-in/social`, {
            method: "POST",
            headers: { origin: env.BETTER_AUTH_URL, "content-type": "application/json" },
            body: JSON.stringify({
              provider: "apple",
              callbackURL,
              errorCallbackURL: callbackURL,
              disableRedirect: true,
            }),
          }),
        );
        expect(response.status).toBe(200);
        const url = new URL(((await response.json()) as { url: string }).url);
        expected = url.searchParams.get("nonce") ?? "";
        const proxy = await auth.handler(
          new Request(
            `${env.BETTER_AUTH_URL}/api/auth/expo-authorization-proxy?${new URLSearchParams({ authorizationURL: url.href })}`,
          ),
        );
        expect(proxy.status).toBe(302);
        expect(proxy.headers.get("location")).toBe(url.href);
        return { cookie: responseCookies(proxy), state: url.searchParams.get("state") ?? "" };
      };
      const callback = async (
        start: { cookie: string; state: string },
        error = false,
        cookie = start.cookie,
      ) => {
        const posted = await workerApi.request(
          `${env.BETTER_AUTH_URL}/api/auth/callback/apple`,
          {
            method: "POST",
            headers: {
              origin: "https://appleid.apple.com",
              "content-type": "application/x-www-form-urlencoded",
              "sec-fetch-site": "cross-site",
              "sec-fetch-mode": "navigate",
              "sec-fetch-dest": "document",
            },
            body: new URLSearchParams({
              state: start.state,
              ...(error
                ? { error: "user_cancelled_authorize" }
                : {
                    code: "synthetic-code",
                    user: JSON.stringify({ name: { firstName: "Synthetic", lastName: "Person" } }),
                    id_token: "synthetic-ignored-frontchannel",
                  }),
            }).toString(),
          },
          env,
        );
        expect(posted.status).toBe(302);
        expect(posted.headers.get("referrer-policy")).toBe("no-referrer");
        const location = posted.headers.get("location");
        if (!location) throw new Error("SYNTHETIC_POST_REDIRECT_MISSING");
        expect(new URL(location).origin).toBe(env.BETTER_AUTH_URL);
        expect(location).not.toContain("synthetic-ignored-frontchannel");
        return auth.handler(new Request(location, { headers: { cookie } }));
      };
      const initial = await callback(await begin("/consent")),
        originalCookie = responseCookies(initial),
        owner = await auth.api.getSession({ headers: new Headers({ cookie: originalCookie }) });
      if (!owner) throw new Error("SYNTHETIC_OWNER_MISSING");
      expect(owner.session.oauthAuthenticatedAt).toBeInstanceOf(Date);
      email = false;
      const verifier = "a".repeat(43),
        attemptId = crypto.randomUUID(),
        challenge = await nativeAuthChallenge(verifier),
        target = new URL(nativeAuthCallbackBase(env.APP_ENV) ?? "");
      target.searchParams.set("attemptId", attemptId);
      target.searchParams.set("challenge", challenge);
      if (flow === "deletion" || flow === "reauthentication") {
        target.searchParams.set(
          "purpose",
          flow === "deletion" ? "delete-account" : "reauthenticate",
        );
        const prepared = await api.request(
          flow === "deletion" ? "/mobile/auth/deletion/prepare" : "/mobile/auth/reauth/prepare",
          {
            method: "POST",
            headers: {
              origin: env.BETTER_AUTH_URL,
              cookie: originalCookie,
              [MOBILE_AUTH_CONTRACT_HEADER]: "2",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              attemptId,
              challenge,
              provider: "apple",
              ...(flow === "deletion" ? { confirmation: "DELETE" } : {}),
            }),
          },
          env,
        );
        expect(prepared.status).toBe(200);
      }
      const start = await begin(target.href);
      if (flow === "wrong-nonce") expected = "z".repeat(32);
      const finished = await callback(
          start,
          flow === "cancel",
          flow === "wrong-cookie" ? "" : start.cookie,
        ),
        returned = new URL(finished.headers.get("location") ?? "");
      if (flow === "cancel" || flow === "wrong-cookie" || flow === "wrong-nonce") {
        expect(returned.searchParams.has("code")).toBe(false);
        expect(revokes).toBe(0);
        expect(db.sqlite.query("SELECT count(*) n FROM user").get()).toEqual({ n: 1 });
        expect(exchanges).toBe(flow === "wrong-nonce" ? 2 : 1);
      } else {
        expect([...returned.searchParams.keys()].sort()).toEqual(["attemptId", "code"]);
        const route =
          flow === "deletion" ? "/mobile/auth/deletion/exchange" : "/mobile/auth/exchange";
        const exchanged = await api.request(
          route,
          {
            method: "POST",
            headers: {
              origin: env.BETTER_AUTH_URL,
              [MOBILE_AUTH_CONTRACT_HEADER]: "2",
              "content-type": "application/json",
              ...(flow === "reauthentication" ? { cookie: originalCookie } : {}),
            },
            body: JSON.stringify({
              attemptId,
              verifier,
              code: returned.searchParams.get("code"),
              ...(flow === "reauthentication" ? { purpose: "reauthenticate" } : {}),
            }),
          },
          env,
        );
        expect(exchanged.status).toBe(200);
        if (flow === "deletion") {
          expect(mobileDeletionOutcomeSchema.parse(await exchanged.json()).appleRevocation).toBe(
            "confirmed",
          );
          expect(revokes).toBe(1);
          expect(
            await auth.api.getSession({ headers: new Headers({ cookie: originalCookie }) }),
          ).toBeNull();
        } else {
          expect(mobileAuthExchangeResponseSchema.parse(await exchanged.json()).status).toBe(
            "accepted",
          );
          expect(
            (
              await auth.api.getSession({
                headers: new Headers({ cookie: responseCookies(exchanged) }),
              })
            )?.user.id,
          ).toBe(owner.user.id);
          if (flow === "reauthentication") {
            const verified = await api.request(
              "/mobile/auth/reauth/verify",
              {
                method: "POST",
                headers: {
                  origin: env.BETTER_AUTH_URL,
                  cookie: responseCookies(exchanged),
                  [MOBILE_AUTH_CONTRACT_HEADER]: "2",
                  "content-type": "application/json",
                },
                body: JSON.stringify({ attemptId, verifier }),
              },
              env,
            );
            expect(verified.status).toBe(200);
          }
        }
      }
      const stored =
        JSON.stringify(db.sqlite.query("SELECT value FROM app_metadata").all()) +
        JSON.stringify(
          db.sqlite.query("SELECT access_token,refresh_token,id_token FROM account").all(),
        );
      for (const token of [
        "synthetic-access",
        "synthetic-refresh",
        "synthetic-ignored-frontchannel",
      ])
        expect(stored).not.toContain(token);
    } finally {
      globalThis.fetch = originalFetch;
      db.close();
    }
  });

test("Apple is trusted only for its exact POST callback; no Origin/CSRF bypass or proxy destination expansion", async () => {
  const db = await createTestDatabase();
  try {
    const env = Object.assign(testEnvironment(db.binding), syntheticAppleConfiguration()),
      auth = getAuth(env);
    const first = await auth.handler(
      new Request(`${env.BETTER_AUTH_URL}/api/auth/sign-in/social`, {
        method: "POST",
        headers: { origin: env.BETTER_AUTH_URL, "content-type": "application/json" },
        body: JSON.stringify({
          provider: "google",
          callbackURL: "/consent",
          disableRedirect: true,
        }),
      }),
    );
    const cookie = responseCookies(first);
    for (const path of ["sign-in/social", "sign-out"]) {
      const response = await auth.handler(
        new Request(`${env.BETTER_AUTH_URL}/api/auth/${path}`, {
          method: "POST",
          headers: {
            origin: "https://appleid.apple.com",
            cookie,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            provider: "google",
            callbackURL: "/consent",
            disableRedirect: true,
          }),
        }),
      );
      expect(response.status).toBe(403);
    }
    for (const destination of [
      "https://appleid.apple.com/auth/authorize?state=synthetic&redirect_uri=http://localhost:4321/api/auth/callback/google",
      "https://appleid.apple.com/foreign?state=synthetic&redirect_uri=http://localhost:4321/api/auth/callback/apple",
      "https://appleid.apple.com.evil.test/auth/authorize?state=synthetic&redirect_uri=http://localhost:4321/api/auth/callback/apple",
    ]) {
      const response = await auth.handler(
        new Request(
          `${env.BETTER_AUTH_URL}/api/auth/expo-authorization-proxy?${new URLSearchParams({ authorizationURL: destination })}`,
        ),
      );
      expect(response.status).toBe(400);
    }
    env.APPLE_AUTH_ENABLED = "false";
    const disabled = getAuth(env),
      destination = `https://appleid.apple.com/auth/authorize?${new URLSearchParams({ state, redirect_uri: `${env.BETTER_AUTH_URL}/api/auth/callback/apple` })}`;
    expect(
      (
        await disabled.handler(
          new Request(
            `${env.BETTER_AUTH_URL}/api/auth/expo-authorization-proxy?${new URLSearchParams({ authorizationURL: destination })}`,
          ),
        )
      ).status,
    ).toBe(400);
  } finally {
    db.close();
  }
});
