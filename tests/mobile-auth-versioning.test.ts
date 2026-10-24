import { expect, test } from "bun:test";
import { deletionAccessSchema, deletionAccessV2Schema } from "../src/contracts/deletion";
import {
  legacyMobileAuthProviderSchema,
  MOBILE_AUTH_CONTRACT_HEADER,
  mobileAuthCapabilitiesSchema,
  mobileReauthPrepareSchema,
  mobileReauthPrepareV2Schema,
} from "../src/contracts/mobile-auth";
import { api } from "../src/server/api";
import { createTestDatabase } from "./helpers/d1";
import { seedTestSession } from "./helpers/session";

const legacy = legacyMobileAuthProviderSchema.options.slice();
const proof = { attemptId: crypto.randomUUID(), challenge: "a".repeat(43) };

test("anonymous capability reports only implemented providers without session or provider IO", async () => {
  const db = await createTestDatabase();
  try {
    const owner = await seedTestSession(db);
    const before = db.sqlite.query("SELECT COUNT(*) AS n FROM app_metadata").get();
    const response = await api.request("/mobile/auth/capabilities", {}, owner.env);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(mobileAuthCapabilitiesSchema.parse(await response.json())).toEqual({
      contractVersion: 2,
      providers: legacy,
    });
    expect(db.sqlite.query("SELECT COUNT(*) AS n FROM app_metadata").get()).toEqual(before);
  } finally {
    db.close();
  }
});

test("installed legacy clients keep strict deletion responses even with a future Apple linked account", async () => {
  const db = await createTestDatabase();
  try {
    const owner = await seedTestSession(db, { oauthAuthenticatedAt: Date.now() });
    for (const provider of [...legacy, "apple"])
      db.sqlite
        .query(
          "INSERT INTO account(id,user_id,provider_id,account_id,created_at,updated_at) VALUES(?,?,?,?,1,1)",
        )
        .run(crypto.randomUUID(), owner.userId, provider, `synthetic-${provider}`);
    // A different owner must never supply the available reauthentication methods.
    const peer = await seedTestSession(db);
    for (const version of [undefined, "1", "2"] as const) {
      const headers = {
        cookie: owner.cookie,
        ...(version ? { [MOBILE_AUTH_CONTRACT_HEADER]: version } : {}),
      };
      const response = await api.request("/me/deletion", { headers }, owner.env);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(response.headers.get("vary")).toContain(MOBILE_AUTH_CONTRACT_HEADER);
      const value = await response.json();
      if (version === "2") {
        expect(deletionAccessV2Schema.parse(value).providers).toEqual([...legacy, "apple"]);
        expect(deletionAccessSchema.safeParse(value).success).toBe(false);
      } else {
        expect(deletionAccessSchema.parse(value).providers).toEqual(legacy);
        // A new client cannot mistake an old server's legacy response for a v2 response.
        expect(deletionAccessV2Schema.safeParse(value).success).toBe(false);
      }
      const other = await api.request(
        "/me/deletion",
        { headers: { ...headers, cookie: peer.cookie } },
        owner.env,
      );
      expect(((await other.json()) as { providers: string[] }).providers).toEqual([]);
    }
    for (const version of ["0", "3", "2, 2", "02"]) {
      const response = await api.request(
        "/me/deletion",
        { headers: { cookie: owner.cookie, [MOBILE_AUTH_CONTRACT_HEADER]: version } },
        owner.env,
      );
      expect(response.status).toBe(400);
    }
    expect(
      (
        await api.request(
          "/me/deletion",
          { headers: { [MOBILE_AUTH_CONTRACT_HEADER]: "2" } },
          owner.env,
        )
      ).status,
    ).toBe(401);
  } finally {
    db.close();
  }
});

test("v2 reauthentication keeps owner, linked-provider and Origin guards; unavailable Apple cannot arm a grant", async () => {
  const db = await createTestDatabase();
  try {
    const owner = await seedTestSession(db);
    db.sqlite
      .query(
        "INSERT INTO account(id,user_id,provider_id,account_id,created_at,updated_at) VALUES(?,?,'google','synthetic',1,1)",
      )
      .run(crypto.randomUUID(), owner.userId);
    const call = (
      version: string | undefined,
      provider: string,
      cookie = owner.cookie,
      origin = owner.env.BETTER_AUTH_URL,
    ) =>
      api.request(
        "/mobile/auth/reauth/prepare",
        {
          method: "POST",
          headers: {
            cookie,
            origin,
            "content-type": "application/json",
            ...(version ? { [MOBILE_AUTH_CONTRACT_HEADER]: version } : {}),
          },
          body: JSON.stringify({ ...proof, attemptId: crypto.randomUUID(), provider }),
        },
        owner.env,
      );
    expect((await call("2", "google")).status).toBe(200);
    expect((await call("2", "naver")).status).toBe(401);
    expect((await call("2", "google", "")).status).toBe(401);
    expect((await call("2", "google", owner.cookie, "https://attacker.example.test")).status).toBe(
      403,
    );
    const before = db.sqlite.query("SELECT key,value FROM app_metadata ORDER BY key").all();
    expect((await call(undefined, "apple")).status).toBe(400);
    expect((await call("1", "apple")).status).toBe(400);
    expect((await call("2", "apple")).status).toBe(503);
    expect((await call("2, 2", "google")).status).toBe(400);
    expect(db.sqlite.query("SELECT key,value FROM app_metadata ORDER BY key").all()).toEqual(
      before,
    );
  } finally {
    db.close();
  }
});

test("Apple is additive only in v2; strict schemas reject downgrade, duplicates and credential fields", () => {
  expect(mobileReauthPrepareSchema.safeParse({ ...proof, provider: "apple" }).success).toBe(false);
  expect(mobileReauthPrepareV2Schema.parse({ ...proof, provider: "apple" }).provider).toBe("apple");
  for (const extra of [
    { accessToken: "synthetic" },
    { ownerId: "synthetic" },
    { contractVersion: 1 },
  ])
    expect(
      mobileReauthPrepareV2Schema.safeParse({ ...proof, provider: "apple", ...extra }).success,
    ).toBe(false);
  expect(
    mobileAuthCapabilitiesSchema.safeParse({ contractVersion: 2, providers: ["apple", "apple"] })
      .success,
  ).toBe(false);
  expect(
    mobileAuthCapabilitiesSchema.safeParse({ contractVersion: 3, providers: legacy }).success,
  ).toBe(false);
  expect(
    deletionAccessV2Schema.safeParse({
      contractVersion: 2,
      ownerTag: "a".repeat(64),
      recentOAuth: false,
      authenticatedAt: null,
      providers: ["apple", "apple"],
    }).success,
  ).toBe(false);
});
