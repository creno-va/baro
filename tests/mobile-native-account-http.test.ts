import { expect, test } from "bun:test";
import { ApiError, createJsonRequester } from "@baro/api-client";
import { createSessionScope } from "@baro/client-core";
import { Hono } from "hono";
import { createNativeAccountClient } from "../apps/mobile/src/platform/account/client";
import { createCaseOperationStorage } from "../apps/mobile/src/platform/storage/case-operations";
import { accountDeleteApi } from "../src/server/api/account-delete";
import type { ApiEnvironment } from "../src/server/api/errors";
import { deletionOwnerTag } from "../src/server/modules/deletion/service";
import { createTestDatabase } from "./helpers/d1";
import { seedTestSession } from "./helpers/session";

const fingerprint = async (value: string) =>
  Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))).toString(
    "hex",
  );
async function fixture() {
  const db = await createTestDatabase(),
    now = Date.now();
  const owner = await seedTestSession(db, { consent: true, oauthAuthenticatedAt: now }),
    peer = await seedTestSession(db, { consent: true, oauthAuthenticatedAt: now });
  for (const user of [owner, peer])
    db.sqlite
      .query(
        "INSERT INTO account(id,user_id,provider_id,account_id,created_at,updated_at) VALUES(?,?,'google',?,1,1)",
      )
      .run(crypto.randomUUID(), user.userId, `synthetic-${user.userId}`);
  const env = {
    ...owner.env,
    APPLICATION_COST_LIMITS_ENABLED: "false",
    CASE_DATA_KEY_V1: btoa("a".repeat(32)).replace(/=+$/, ""),
  };
  const app = new Hono<ApiEnvironment>().route("/api/me", accountDeleteApi),
    records = new Map<string, string>(),
    statuses: number[] = [],
    writes: unknown[] = [];
  const tag = await deletionOwnerTag(env.BETTER_AUTH_SECRET, owner.userId);
  let cookie = owner.cookie,
    loseAck = false,
    switchAfterAccess = false,
    notified = 0,
    cleaned = 0;
  const storage = createCaseOperationStorage({
    namespace: "baro_preview_case_operations",
    fingerprint,
    storage: {
      get: async (key) => records.get(key) ?? null,
      set: async (key, value) => {
        records.set(key, value);
      },
      remove: async (key) => {
        records.delete(key);
      },
    },
  });
  const client = () => {
    const scope = createSessionScope();
    const request = createJsonRequester({
      scope,
      newKey: () => crypto.randomUUID(),
      transport: async (path, init) => {
        const headers = new Headers(init.headers);
        headers.set("cookie", cookie);
        headers.set("origin", env.BETTER_AUTH_URL);
        const response = await app.request(path, { ...init, headers }, env);
        if (switchAfterAccess && path.endsWith("/deletion")) cookie = peer.cookie;
        if (init.method === "DELETE") {
          writes.push(JSON.parse(String(init.body)));
          statuses.push(response.status);
          if (loseAck && response.status === 202)
            throw new ApiError("UNAVAILABLE", "합성 ACK 유실", true);
        }
        return response;
      },
    });
    return createNativeAccountClient({
      request,
      scope,
      signal: new AbortController().signal,
      ownerId: owner.userId,
      storage,
      fingerprint,
      newKey: () => crypto.randomUUID(),
      readReauthentication: async () => ({ ownerTag: tag, startedAt: now - 1000 }),
      reauthenticate: async () => {},
      onAccepted: () => {
        notified++;
      },
      cleanup: async ({ ensureCurrent }) => {
        ensureCurrent();
        cleaned++;
      },
    });
  };
  return {
    db,
    owner,
    peer,
    client,
    records,
    storage,
    statuses,
    writes,
    counts: () => ({ notified, cleaned }),
    loseAck: () => {
      loseAck = true;
    },
    switchAfterAccess: () => {
      switchAfterAccess = true;
    },
  };
}

test("actual signed account deletion loses ACK after primary SQL deletion: restart never claims success or blindly resends", async () => {
  const f = await fixture();
  try {
    const otherKey = `baro-reports-request:${"a".repeat(64)}`,
      otherValue = crypto.randomUUID();
    await f.storage.setItem(otherKey, otherValue);
    f.loseAck();
    await expect(f.client().deleteAccount("DELETE")).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(f.statuses).toEqual([202]);
    expect(f.writes).toEqual([{ confirmation: "DELETE" }]);
    expect(f.db.sqlite.query("SELECT count(*) n FROM user WHERE id=?").get(f.owner.userId)).toEqual(
      { n: 0 },
    );
    expect(f.db.sqlite.query("SELECT count(*) n FROM user WHERE id=?").get(f.peer.userId)).toEqual({
      n: 1,
    });
    expect(
      f.db.sqlite
        .query("SELECT count(*) n FROM deletion_jobs WHERE target_id=?")
        .get(f.owner.userId),
    ).toEqual({ n: 1 });
    const restarted = f.client();
    expect(await restarted.deletionState()).toBe("unconfirmed");
    await expect(restarted.deleteAccount("DELETE")).rejects.toMatchObject({
      reason: "UNCONFIRMED",
    });
    await expect(restarted.retryUnconfirmed("DELETE")).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    expect(f.statuses).toEqual([202]);
    expect(f.counts()).toEqual({ notified: 0, cleaned: 0 });
    expect(await f.storage.getItem(otherKey)).toBe(otherValue);
    expect(f.records.size).toBe(2);
  } finally {
    f.db.close();
  }
});

test("actual peer cookie replacement between freshness read and DELETE cannot delete or clean either account", async () => {
  const f = await fixture();
  try {
    f.switchAfterAccess();
    await expect(f.client().deleteAccount("DELETE")).rejects.toBeInstanceOf(ApiError);
    expect(f.statuses).toEqual([401]);
    expect(f.counts()).toEqual({ notified: 0, cleaned: 0 });
    expect(f.db.sqlite.query("SELECT count(*) n FROM user").get()).toEqual({ n: 2 });
    expect(f.db.sqlite.query("SELECT count(*) n FROM deletion_jobs").get()).toEqual({ n: 0 });
    expect(await f.client().deletionState()).toBe("unconfirmed");
  } finally {
    f.db.close();
  }
});
