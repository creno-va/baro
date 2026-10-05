import { describe, expect, test } from "bun:test";
import { cleanupAuthData } from "../src/server/auth/cleanup";
import {
  AUTH_RETENTION_MS,
  hasRecentOAuthAuthentication,
  RECENT_OAUTH_MS,
  SESSION_EXPIRES_SECONDS,
  SESSION_UPDATE_SECONDS,
} from "../src/server/auth/policy";
import { createOAuthFixture, responseCookies } from "./helpers/oauth";

for (const provider of ["google", "naver", "kakao"] as const) {
  describe(`${provider} real-SQL callback`, () => {
    test("success stores no provider tokens or IP/UA; repeat sign-in updates account safely", async () => {
      const fixture = await createOAuthFixture(provider);
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          const started = await fixture.begin();
          expect(started.response.status).toBe(200);
          const response = await fixture.callback(started.state, started.cookie);
          expect(response.status).toBe(302);
          expect(response.headers.get("location")).toBe("/consent");
          const session = await fixture.auth.api.getSession({
            headers: new Headers({ cookie: responseCookies(response) }),
          });
          expect(session).not.toBeNull();
          expect(hasRecentOAuthAuthentication(session?.session ?? null)).toBe(true);
          expect(
            fixture.database.sqlite
              .query(
                "SELECT access_token,refresh_token,id_token,access_token_expires_at,refresh_token_expires_at FROM account",
              )
              .all(),
          ).toEqual([
            {
              access_token: null,
              refresh_token: null,
              id_token: null,
              access_token_expires_at: null,
              refresh_token_expires_at: null,
            },
          ]);
          expect(
            fixture.database.sqlite
              .query("SELECT ip_address,user_agent FROM session WHERE id=?")
              .get(session?.session.id ?? ""),
          ).toEqual({ ip_address: null, user_agent: null });
          expect(session?.session.expiresAt.getTime() ?? 0).toBeCloseTo(
            (session?.session.createdAt.getTime() ?? 0) + SESSION_EXPIRES_SECONDS * 1_000,
            -3,
          );
        }
        expect(fixture.exchanges()).toBe(2);
        expect(
          fixture.database.sqlite.query("SELECT count(*) AS count FROM account").get(),
        ).toEqual({ count: 1 });
      } finally {
        fixture.database.close();
      }
    });

    test("cancel, mismatched state, missing cookie, expired state and replay create no session", async () => {
      const fixture = await createOAuthFixture(provider);
      try {
        for (const failure of ["cancel", "state", "cookie", "expired"] as const) {
          const started = await fixture.begin();
          if (failure === "expired") {
            fixture.database.sqlite.exec(
              "UPDATE verification SET value=json_set(value,'$.expiresAt',1)",
            );
          }
          const response = await fixture.callback(
            failure === "state" ? "mismatch" : started.state,
            failure === "cookie" ? "" : started.cookie,
            failure === "cancel" ? "access_denied" : undefined,
          );
          expect(response.status).toBe(302);
          expect(
            new URL(response.headers.get("location") ?? "", fixture.env.BETTER_AUTH_URL).pathname,
          ).toBe("/login");
          expect(
            fixture.database.sqlite.query("SELECT count(*) AS count FROM session").get(),
          ).toEqual({ count: 0 });
        }
        expect(fixture.exchanges()).toBe(0);
        const started = await fixture.begin();
        expect(
          (await fixture.callback(started.state, started.cookie)).headers.get("location"),
        ).toBe("/consent");
        const replay = await fixture.callback(started.state, started.cookie);
        expect(replay.headers.get("location")).toContain("state_mismatch");
        expect(fixture.exchanges()).toBe(1);
      } finally {
        fixture.database.close();
      }
    });

    test("expired sessions fail; daily sliding refresh never refreshes OAuth authentication", async () => {
      const fixture = await createOAuthFixture(provider);
      try {
        const started = await fixture.begin();
        const response = await fixture.callback(started.state, started.cookie);
        const headers = new Headers({ cookie: responseCookies(response) });
        const session = (await fixture.auth.api.getSession({ headers }))?.session;
        expect(session).toBeDefined();
        const now = Date.now();
        const oldOAuth = now - RECENT_OAUTH_MS - 1;
        fixture.database.sqlite
          .query("UPDATE session SET oauth_authenticated_at=?,updated_at=?,expires_at=?")
          .run(
            oldOAuth,
            now - SESSION_UPDATE_SECONDS * 1_000 - 1,
            now + (SESSION_EXPIRES_SECONDS - SESSION_UPDATE_SECONDS) * 1_000 - 1,
          );
        const refreshed = (await fixture.auth.api.getSession({ headers }))?.session;
        expect(refreshed?.updatedAt.getTime() ?? 0).toBeGreaterThanOrEqual(now);
        expect(refreshed?.oauthAuthenticatedAt?.getTime()).toBe(oldOAuth);
        expect(hasRecentOAuthAuthentication(refreshed ?? null)).toBe(false);
        fixture.database.sqlite.exec("UPDATE session SET expires_at=1");
        expect(await fixture.auth.api.getSession({ headers })).toBeNull();
      } finally {
        fixture.database.close();
      }
    });
  });
}

test("recent OAuth fails closed for missing, future, stale and expired timestamps", () => {
  const now = Date.now();
  expect(
    hasRecentOAuthAuthentication(
      { expiresAt: new Date(Number.NaN), oauthAuthenticatedAt: new Date(now) },
      now,
    ),
  ).toBe(false);
  for (const stamp of [
    null,
    new Date(now + 1),
    new Date(now - RECENT_OAUTH_MS - 1),
    new Date(Number.NaN),
  ]) {
    expect(
      hasRecentOAuthAuthentication(
        { expiresAt: new Date(now + 1), oauthAuthenticatedAt: stamp },
        now,
      ),
    ).toBe(false);
  }
  expect(
    hasRecentOAuthAuthentication(
      { expiresAt: new Date(now), oauthAuthenticatedAt: new Date(now) },
      now,
    ),
  ).toBe(false);
  expect(
    hasRecentOAuthAuthentication(
      { expiresAt: new Date(now + 1), oauthAuthenticatedAt: new Date(now - RECENT_OAUTH_MS) },
      now,
    ),
  ).toBe(true);
});

test("expired and old security records are cleaned without deleting users or current sessions", async () => {
  const fixture = await createOAuthFixture("google");
  try {
    const started = await fixture.begin();
    await fixture.callback(started.state, started.cookie);
    const now = Date.now();
    const user = fixture.database.sqlite.query("SELECT id FROM user").get() as { id: string };
    for (const kind of ["expired", "old"] as const) {
      const created = kind === "old" ? now - AUTH_RETENTION_MS : now;
      const expiry = kind === "expired" ? now : now + 3_600_000;
      fixture.database.sqlite
        .query(
          "INSERT INTO session(id,user_id,token,created_at,updated_at,expires_at) VALUES(?,?,?,?,?,?)",
        )
        .run(kind, user.id, kind, created, now, expiry);
      fixture.database.sqlite
        .query(
          "INSERT INTO verification(id,identifier,value,created_at,updated_at,expires_at) VALUES(?,?,?,?,?,?)",
        )
        .run(kind, kind, "synthetic", created, now, expiry);
    }
    await cleanupAuthData(fixture.database.binding, now);
    await cleanupAuthData(fixture.database.binding, now);
    expect(fixture.database.sqlite.query("SELECT count(*) AS count FROM session").get()).toEqual({
      count: 1,
    });
    expect(
      fixture.database.sqlite.query("SELECT count(*) AS count FROM verification").get(),
    ).toEqual({ count: 0 });
    expect(fixture.database.sqlite.query("SELECT count(*) AS count FROM user").get()).toEqual({
      count: 1,
    });
  } finally {
    fixture.database.close();
  }
});

test("same email does not implicitly link another provider", async () => {
  const fixture = await createOAuthFixture("google");
  try {
    const now = Date.now();
    fixture.database.sqlite
      .query(
        "INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES('existing','Synthetic','google@example.test',1,?,?)",
      )
      .run(now, now);
    const started = await fixture.begin();
    const response = await fixture.callback(started.state, started.cookie);
    expect(response.headers.get("location")).toContain("account_not_linked");
    expect(fixture.database.sqlite.query("SELECT count(*) AS count FROM account").get()).toEqual({
      count: 0,
    });
    expect(fixture.database.sqlite.query("SELECT count(*) AS count FROM session").get()).toEqual({
      count: 0,
    });
  } finally {
    fixture.database.close();
  }
});

test("cleanup failure remains observable without exposing adapter SQL, tokens or cause", async () => {
  const database = {
    prepare() {
      throw new Error("SQL synthetic-token private-parameters");
    },
  } as unknown as D1Database;
  const error = await cleanupAuthData(database).catch((failure: unknown) => failure);
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toBe("AUTH_CLEANUP_FAILED");
  expect((error as Error).cause).toBeUndefined();
  expect((error as Error).stack).toBeUndefined();
});

test("ordinary session creation cannot impersonate OAuth and server updates cannot refresh authentication", async () => {
  const fixture = await createOAuthFixture("google");
  try {
    const start = await fixture.begin();
    const callback = await fixture.callback(start.state, start.cookie);
    const headers = new Headers({ cookie: responseCookies(callback) });
    const original = (await fixture.auth.api.getSession({ headers }))?.session;
    if (!original) throw new Error("Synthetic session missing");
    await fixture.context.internalAdapter.updateSession(original.token, {
      oauthAuthenticatedAt: new Date(Date.now() + 60_000),
      ipAddress: "192.0.2.1",
      userAgent: "Synthetic",
    });
    const updated = (await fixture.auth.api.getSession({ headers }))?.session;
    expect(updated?.oauthAuthenticatedAt?.getTime()).toBe(original.oauthAuthenticatedAt?.getTime());
    expect(updated?.ipAddress).toBeNull();
    expect(updated?.userAgent).toBeNull();
    const ordinary = await fixture.context.internalAdapter.createSession(original.userId, false, {
      oauthAuthenticatedAt: new Date(),
    });
    expect(hasRecentOAuthAuthentication(ordinary)).toBe(false);
  } finally {
    fixture.database.close();
  }
});

test("daily refresh interval and retention cap are enforced by real session reads", async () => {
  const fixture = await createOAuthFixture("google");
  try {
    const start = await fixture.begin();
    const callback = await fixture.callback(start.state, start.cookie);
    const headers = new Headers({ cookie: responseCookies(callback) });
    const session = (await fixture.auth.api.getSession({ headers }))?.session;
    expect((await fixture.auth.api.getSession({ headers }))?.session.updatedAt).toEqual(
      session?.updatedAt,
    );
    const now = Date.now();
    const created = now - AUTH_RETENTION_MS + 3_600_000;
    fixture.database.sqlite
      .query("UPDATE session SET created_at=?,expires_at=?")
      .run(created, now + 1_000);
    const refreshed = (await fixture.auth.api.getSession({ headers }))?.session;
    expect(refreshed?.expiresAt.getTime()).toBe(created + AUTH_RETENTION_MS);
    expect(refreshed?.oauthAuthenticatedAt?.getTime()).toBe(
      session?.oauthAuthenticatedAt?.getTime(),
    );
  } finally {
    fixture.database.close();
  }
});

test("OAuth and sign-out reject cross-origin requests and sign-out revokes the SQL session", async () => {
  const fixture = await createOAuthFixture("google");
  try {
    const start = await fixture.begin();
    const callback = await fixture.callback(start.state, start.cookie);
    const cookie = responseCookies(callback);
    for (const path of ["sign-in/social", "sign-out"]) {
      const forbidden = await fixture.auth.handler(
        new Request(`${fixture.env.BETTER_AUTH_URL}/api/auth/${path}`, {
          method: "POST",
          headers: {
            cookie,
            origin: "https://attacker.example",
            "content-type": "application/json",
          },
          body: JSON.stringify({ provider: "google", callbackURL: "/consent" }),
        }),
      );
      expect(forbidden.status).toBe(403);
    }
    const response = await fixture.auth.handler(
      new Request(`${fixture.env.BETTER_AUTH_URL}/api/auth/sign-out`, {
        method: "POST",
        headers: {
          cookie,
          origin: fixture.env.BETTER_AUTH_URL,
          "content-type": "application/json",
        },
        body: "{}",
      }),
    );
    expect(response.status).toBe(200);
    expect(await fixture.auth.api.getSession({ headers: new Headers({ cookie }) })).toBeNull();
  } finally {
    fixture.database.close();
  }
});
