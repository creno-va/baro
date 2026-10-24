import { expect, test } from "bun:test";
import { betterAuth } from "better-auth";
import { supportsIdTokenSignIn } from "better-auth/oauth2";
import { apple, google } from "better-auth/social-providers";
import { CURRENT_POLICY_VERSIONS } from "../src/contracts/consent";
import { api } from "../src/server/api";
import { getAuth } from "../src/server/auth";
import { saveAccountType } from "../src/server/auth/account-type";
import { bindAppleIdentity, findAppleLinkedIdentity } from "../src/server/auth/apple-identity";
import { createTestDatabase, testEnvironment } from "./helpers/d1";
import { responseCookies } from "./helpers/oauth";
import { seedTestSession } from "./helpers/session";

const audience = "synthetic-service-id",
  nonce = "a".repeat(32);
const keys = await crypto.subtle.generateKey(
  {
    name: "RSASSA-PKCS1-v1_5",
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: "SHA-256",
  },
  false,
  ["sign", "verify"],
);
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
async function token(changes: Record<string, unknown> = {}, alg = "RS256") {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: "https://appleid.apple.com",
    aud: audience,
    sub: "synthetic-apple-subject",
    iat: now,
    exp: now + 300,
    nonce,
    email: "synthetic@privaterelay.appleid.com",
    email_verified: true,
    ...changes,
  };
  const message = `${encode({ alg, kid: "synthetic-key" })}.${encode(payload)}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    keys.privateKey,
    new TextEncoder().encode(message),
  );
  return `${message}.${Buffer.from(signature).toString("base64url")}`;
}
function provider() {
  const raw = apple({ clientId: audience, clientSecret: "synthetic-only" });
  let lookups = 0;
  raw.idToken = {
    ...raw.idToken,
    jwks: async () => {
      lookups++;
      return keys.publicKey;
    },
    issuer: "https://appleid.apple.com",
    audience,
  };
  return { raw, bound: bindAppleIdentity(raw), lookups: () => lookups };
}

test("Apple redirect carries the server nonce; existing providers pass through and client-submitted idToken is disabled", async () => {
  const p = provider(),
    other = google({ clientId: "synthetic", clientSecret: "synthetic" });
  expect(bindAppleIdentity(other)).toBe(other);
  expect(p.bound.requiresIdTokenNonce).toBe(true);
  expect(supportsIdTokenSignIn(p.bound)).toBe(false);
  const input = {
    state: "synthetic-state",
    codeVerifier: "b".repeat(64),
    redirectURI: "https://example.test/api/auth/callback/apple",
    idTokenNonce: nonce,
  };
  const url = await p.bound.createAuthorizationURL(input);
  expect(url.origin + url.pathname).toBe("https://appleid.apple.com/auth/authorize");
  expect(url.searchParams.get("nonce")).toBe(nonce);
  expect(url.searchParams.get("response_mode")).toBe("form_post");
  expect(url.searchParams.get("redirect_uri")).toBe(input.redirectURI);
  await expect(
    p.bound.createAuthorizationURL({ ...input, idTokenNonce: undefined }),
  ).rejects.toThrow("APPLE_AUTH_NONCE_REQUIRED");
});
test("real RSA signature/claims/nonce verification precedes profile decoding, including first name and private relay", async () => {
  const p = provider();
  const info = await p.bound.getUserInfo({
    idToken: await token(),
    expectedIdTokenNonce: nonce,
    user: { name: { firstName: "Synthetic", lastName: "Person" } },
  });
  expect(info?.user).toMatchObject({
    name: "Synthetic Person",
    email: "synthetic@privaterelay.appleid.com",
    emailVerified: true,
  });
  expect(p.lookups()).toBe(1);
  // A standalone binder has no account adapter; even its missing-email profile must first verify.
  const returning = await p.bound.getUserInfo({
    idToken: await token({ email: undefined, email_verified: undefined }),
    expectedIdTokenNonce: nonce,
  });
  expect(returning?.user.email).toBeUndefined();
  expect(returning?.data).toMatchObject({ sub: "synthetic-apple-subject" });
});
test("missing email resolves only the verified immutable subject and preserves local verification without overriding an Apple claim", async () => {
  const p = provider();
  let lookups = 0;
  const bound = bindAppleIdentity(p.raw, async (subject) => {
    lookups++;
    expect(subject).toBe("synthetic-apple-subject");
    return { ownerId: "synthetic-owner", email: "stored@example.test", emailVerified: true };
  });
  const missing = await token({ email: undefined, email_verified: undefined });
  expect(
    await bound.getUserInfo({ idToken: missing, expectedIdTokenNonce: "b".repeat(32) }),
  ).toBeNull();
  expect(lookups).toBe(0);
  const found = await bound.getUserInfo({ idToken: missing, expectedIdTokenNonce: nonce });
  expect(found?.user).toMatchObject({ email: "stored@example.test", emailVerified: false });
  expect(lookups).toBe(1);
  const claimed = await bound.getUserInfo({ idToken: await token(), expectedIdTokenNonce: nonce });
  expect(claimed?.user.email).toBe("synthetic@privaterelay.appleid.com");
  expect(lookups).toBe(1);
  expect(
    await bindAppleIdentity(p.raw, async () => null).getUserInfo({
      idToken: missing,
      expectedIdTokenNonce: nonce,
    }),
  ).toBeNull();
});
test("linked-subject SQL separates providers/owners, preserves verification and denies deleted or unlinked accounts without creating users", async () => {
  const db = await createTestDatabase();
  try {
    const owner = await seedTestSession(db),
      peer = await seedTestSession(db);
    for (const [providerId, userId] of [
      ["apple", owner.userId],
      ["google", peer.userId],
    ])
      db.sqlite
        .query(
          "INSERT INTO account(id,user_id,provider_id,account_id,created_at,updated_at) VALUES(?,?,?,'synthetic-linked-subject',1,1)",
        )
        .run(crypto.randomUUID(), userId, providerId);
    const expectedEmail = `${owner.userId}@example.test`;
    expect(await findAppleLinkedIdentity(db.binding, "synthetic-linked-subject")).toEqual({
      ownerId: owner.userId,
      email: expectedEmail,
      emailVerified: true,
    });
    for (const subject of ["unknown", "' OR 1=1 --", ""])
      expect(await findAppleLinkedIdentity(db.binding, subject)).toBeNull();
    db.sqlite.query("UPDATE user SET email_verified=0 WHERE id=?").run(owner.userId);
    expect(await findAppleLinkedIdentity(db.binding, "synthetic-linked-subject")).toEqual({
      ownerId: owner.userId,
      email: expectedEmail,
      emailVerified: false,
    });
    db.sqlite
      .query("INSERT INTO v2_tombstones(target_kind,target_id,deleted_at) VALUES('account',?,?)")
      .run(owner.userId, new Date().toISOString());
    expect(await findAppleLinkedIdentity(db.binding, "synthetic-linked-subject")).toBeNull();
    db.sqlite.query("DELETE FROM account WHERE provider_id='apple'").run();
    expect(await findAppleLinkedIdentity(db.binding, "synthetic-linked-subject")).toBeNull();
    expect(db.sqlite.query("SELECT COUNT(*) AS n FROM user").get()).toEqual({ n: 2 });
  } finally {
    db.close();
  }
});
for (const [name, changes] of Object.entries({
  issuer: { iss: "https://attacker.example.test" },
  audience: { aud: "wrong-service" },
  missingNonce: { nonce: undefined },
  differentNonce: { nonce: "b".repeat(32) },
  expired: { exp: 1 },
  missingExpiry: { exp: undefined },
  missingIssuedAt: { iat: undefined },
  old: { iat: Math.floor(Date.now() / 1000) - 3700 },
  emptySubject: { sub: "" },
  missingSubject: { sub: undefined },
}))
  test(`signed but invalid Apple claim is rejected: ${name}`, async () => {
    expect(
      await provider().bound.getUserInfo({
        idToken: await token(changes),
        expectedIdTokenNonce: nonce,
      }),
    ).toBeNull();
  });
test("tampered, unsigned, other algorithm, oversized token and missing server nonce fail closed without leaking credentials", async () => {
  const p = provider(),
    valid = await token(),
    parts = valid.split(".");
  const forged = `${parts[0]}.${encode({ sub: "peer", nonce })}.${parts[2]}`;
  for (const idToken of [
    forged,
    `${encode({ alg: "none" })}.${parts[1]}.`,
    await token({}, "HS256"),
  ])
    expect(await p.bound.getUserInfo({ idToken, expectedIdTokenNonce: nonce })).toBeNull();
  const before = p.lookups();
  expect(await p.bound.getUserInfo({ idToken: valid })).toBeNull();
  expect(
    await p.bound.getUserInfo({ idToken: "a".repeat(16_385), expectedIdTokenNonce: nonce }),
  ).toBeNull();
  expect(p.lookups()).toBe(before);
});
test("custom verifyIdToken cannot bypass the binding; concurrent attempts never share a nonce", async () => {
  const p = provider();
  p.raw.options.verifyIdToken = async () => true;
  const bound = bindAppleIdentity(p.raw),
    secondNonce = "b".repeat(32);
  expect(
    await bound.getUserInfo({
      idToken: `${encode({ alg: "none" })}.${encode({ sub: "peer", nonce })}.`,
      expectedIdTokenNonce: nonce,
    }),
  ).toBeNull();
  const [first, second] = await Promise.all([token(), token({ nonce: secondNonce })]);
  expect(
    (
      await Promise.all([
        bound.getUserInfo({ idToken: first, expectedIdTokenNonce: nonce }),
        bound.getUserInfo({ idToken: second, expectedIdTokenNonce: secondNonce }),
      ])
    ).every(Boolean),
  ).toBe(true);
  expect(await bound.getUserInfo({ idToken: first, expectedIdTokenNonce: secondNonce })).toBeNull();
});

test("fixture-only Apple registration uses real SDK POST/GET state and RSA validation; replay/tamper cannot create a session", async () => {
  const db = await createTestDatabase();
  try {
    const env = testEnvironment(db.binding),
      base = getAuth(env);
    expect((await base.$context).socialProviders.map((p) => p.id)).toEqual([
      "google",
      "naver",
      "kakao",
    ]);
    const auth = betterAuth({
      ...base.options,
      trustedOrigins: [env.BETTER_AUTH_URL, "https://appleid.apple.com"],
      socialProviders: { apple: { clientId: audience, clientSecret: "synthetic-only" } },
      plugins: [
        {
          id: "synthetic-apple-jwks",
          init(ctx) {
            const p = ctx.socialProviders.find((entry) => entry.id === "apple");
            if (!p) throw new Error("SYNTHETIC_APPLE_MISSING");
            p.idToken = {
              jwks: async () => keys.publicKey,
              issuer: "https://appleid.apple.com",
              audience,
            };
          },
        },
        ...(base.options.plugins ?? []),
      ],
    });
    const context = await auth.$context,
      p = context.socialProviders.find((entry) => entry.id === "apple");
    if (!p) throw new Error("SYNTHETIC_APPLE_MISSING");
    let expected = "",
      exchanges = 0,
      includeEmail = true,
      includeName = true,
      subject = "synthetic-apple-subject";
    p.validateAuthorizationCode = async () => {
      exchanges++;
      return {
        idToken: await token({
          nonce: expected,
          sub: subject,
          email: includeEmail ? "synthetic@privaterelay.appleid.com" : undefined,
          email_verified: includeEmail ? true : undefined,
        }),
        accessToken: "synthetic-access",
        refreshToken: "synthetic-refresh",
      };
    };
    const begin = async () => {
      const response = await auth.handler(
        new Request(`${env.BETTER_AUTH_URL}/api/auth/sign-in/social`, {
          method: "POST",
          headers: { origin: env.BETTER_AUTH_URL, "content-type": "application/json" },
          body: JSON.stringify({
            provider: "apple",
            callbackURL: "/consent",
            errorCallbackURL: "/login",
            disableRedirect: true,
          }),
        }),
      );
      const url = new URL(((await response.json()) as { url: string }).url);
      expected = url.searchParams.get("nonce") ?? "";
      expect(expected).toHaveLength(32);
      return { cookie: responseCookies(response), state: url.searchParams.get("state") ?? "" };
    };
    const callback = async (attempt: { cookie: string; state: string }) => {
      // Cross-site form POST has no Lax state cookie; SDK redirects to a top-level GET.
      const posted = await auth.handler(
        new Request(`${env.BETTER_AUTH_URL}/api/auth/callback/apple`, {
          method: "POST",
          headers: {
            origin: "https://appleid.apple.com",
            "content-type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            state: attempt.state,
            code: "synthetic-code",
            ...(includeName
              ? { user: JSON.stringify({ name: { firstName: "Synthetic", lastName: "Person" } }) }
              : {}),
          }),
        }),
      );
      expect(posted.status).toBe(302);
      const location = posted.headers.get("location");
      if (!location) throw new Error("SYNTHETIC_POST_REDIRECT_MISSING");
      return auth.handler(new Request(location, { headers: { cookie: attempt.cookie } }));
    };
    const first = await begin(),
      accepted = await callback(first);
    expect(new URL(accepted.headers.get("location") ?? "", env.BETTER_AUTH_URL).pathname).toBe(
      "/consent",
    );
    const session = await auth.api.getSession({
      headers: new Headers({ cookie: responseCookies(accepted) }),
    });
    expect(session?.user.email).toBe("synthetic@privaterelay.appleid.com");
    expect(session?.user.name).toBe("Synthetic Person");
    const firstSessionResponse = await api.request(
      "/me/session",
      { headers: { cookie: responseCookies(accepted) } },
      env,
    );
    expect(await firstSessionResponse.json()).toMatchObject({ needsConsent: true });
    // Apple is not in the production freshness allowlist until the remaining server producer is accepted.
    expect(session?.session.oauthAuthenticatedAt).toBeNull();
    const accounts = db.sqlite
      .query("SELECT access_token,refresh_token,id_token FROM account")
      .all();
    expect(accounts).toEqual([{ access_token: null, refresh_token: null, id_token: null }]);
    await callback(first);
    expect(exchanges).toBe(1);
    if (!session) throw new Error("SYNTHETIC_OWNER_MISSING");
    includeEmail = false;
    includeName = false;
    await saveAccountType(db.binding, session.user.id, "lawyer");
    db.sqlite
      .query(
        "INSERT INTO user_consents(user_id,terms_version,privacy_version,ai_notice_version,over_14_confirmed,consented_at) VALUES(?,?,?,?,1,?)",
      )
      .run(
        session.user.id,
        CURRENT_POLICY_VERSIONS.termsVersion,
        CURRENT_POLICY_VERSIONS.privacyVersion,
        CURRENT_POLICY_VERSIONS.aiNoticeVersion,
        new Date().toISOString(),
      );
    const verifiedReturning = await callback(await begin());
    const verifiedReturned = await auth.api.getSession({
      headers: new Headers({ cookie: responseCookies(verifiedReturning) }),
    });
    expect(verifiedReturned?.user.id).toBe(session.user.id);
    expect(verifiedReturned?.user.emailVerified).toBe(true);
    db.sqlite.query("UPDATE user SET email_verified=0 WHERE id=?").run(session.user.id);
    const returning = await callback(await begin());
    const returned = await auth.api.getSession({
      headers: new Headers({ cookie: responseCookies(returning) }),
    });
    expect(returned?.user.id).toBe(session.user.id);
    expect(returned?.user.email).toBe(session.user.email);
    expect(returned?.user.emailVerified).toBe(false);
    expect(returned?.user.name).toBe(session.user.name);
    const returningSessionResponse = await api.request(
      "/me/session",
      { headers: { cookie: responseCookies(returning) } },
      env,
    );
    expect(await returningSessionResponse.json()).toMatchObject({
      user: { id: session.user.id, accountType: "lawyer" },
      needsConsent: false,
    });
    subject = "unknown-subject";
    const unknown = await callback(await begin());
    expect(new URL(unknown.headers.get("location") ?? "", env.BETTER_AUTH_URL).pathname).toBe(
      "/login",
    );
    subject = "synthetic-apple-subject";
    const second = await begin();
    expected = "z".repeat(32);
    const denied = await callback(second);
    expect(new URL(denied.headers.get("location") ?? "", env.BETTER_AUTH_URL).pathname).toBe(
      "/login",
    );
    const beforeInvalidState = exchanges;
    const expired = await begin();
    db.sqlite.query("UPDATE verification SET value=json_set(value,'$.expiresAt',1)").run();
    const expiredResponse = await callback(expired);
    expect(
      new URL(expiredResponse.headers.get("location") ?? "", env.BETTER_AUTH_URL).pathname,
    ).toBe("/login");
    await callback({ cookie: expired.cookie, state: "synthetic-invalid-state" });
    expect(exchanges).toBe(beforeInvalidState);
    expect(db.sqlite.query("SELECT COUNT(*) AS n FROM session").get()).toEqual({ n: 3 });
    expect(db.sqlite.query("SELECT COUNT(*) AS n FROM user").get()).toEqual({ n: 1 });
    // Mutate the real SQL mapping after the verified lookup but before the SDK chooses/creates an owner.
    const profile = p.getUserInfo;
    let mutation: "unlink" | "move" | "delete" | null = null;
    const peer = await seedTestSession(db);
    p.getUserInfo = async (tokens) => {
      const result = await profile(tokens),
        action = mutation;
      mutation = null;
      if (!result || !action) throw new Error("SYNTHETIC_LINKED_RACE_REQUIRED");
      if (action === "unlink")
        db.sqlite.query("DELETE FROM account WHERE provider_id='apple'").run();
      if (action === "move")
        db.sqlite.query("UPDATE account SET user_id=? WHERE provider_id='apple'").run(peer.userId);
      if (action === "delete") db.sqlite.query("DELETE FROM user WHERE id=?").run(session.user.id);
      return result;
    };
    db.sqlite.query("UPDATE user SET email_verified=1 WHERE id=?").run(session.user.id);
    for (const action of ["unlink", "move", "delete"] as const) {
      mutation = action;
      const response = await callback(await begin());
      expect(
        new URL(response.headers.get("location") ?? "", env.BETTER_AUTH_URL).pathname,
      ).not.toBe("/consent");
      expect(
        db.sqlite.query("SELECT COUNT(*) AS n FROM session WHERE user_id=?").get(peer.userId),
      ).toEqual({ n: 1 });
      if (action === "unlink") {
        expect(
          db.sqlite.query("SELECT COUNT(*) AS n FROM account WHERE provider_id='apple'").get(),
        ).toEqual({ n: 0 });
        db.sqlite
          .query(
            "INSERT INTO account(id,user_id,provider_id,account_id,created_at,updated_at) VALUES(?,?,'apple','synthetic-apple-subject',1,1)",
          )
          .run(crypto.randomUUID(), session.user.id);
      }
      if (action === "move")
        db.sqlite
          .query("UPDATE account SET user_id=? WHERE provider_id='apple'")
          .run(session.user.id);
    }
    expect(db.sqlite.query("SELECT COUNT(*) AS n FROM user").get()).toEqual({ n: 1 });
    expect(
      db.sqlite.query("SELECT COUNT(*) AS n FROM user WHERE id=?").get(session.user.id),
    ).toEqual({ n: 0 });
    expect(db.sqlite.query("SELECT COUNT(*) AS n FROM session").get()).toEqual({ n: 1 });
  } finally {
    db.close();
  }
});
