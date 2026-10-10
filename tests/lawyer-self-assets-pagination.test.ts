import { expect, test } from "bun:test";
import { Hono } from "hono";
import { lawyerAssets } from "../src/client/api/lawyers";
import { createLawyersApi } from "../src/server/api/v2/lawyers";
import { saveAccountType } from "../src/server/auth/account-type";
import { signedSessionCookie, testEnvironment } from "./helpers/d1";
import { selfAssetFixture } from "./helpers/lawyer-self-assets";

test("self profile pages all 51 assets without hiding the oldest upload", async () => {
  const f = await selfAssetFixture({ advancingClock: true });
  await saveAccountType(f.db.binding, f.actor.ownerId, "lawyer");
  for (let i = 0; i < 50; i++)
    await f.assets.reserve(
      f.actor.ownerId,
      1,
      crypto.randomUUID(),
      {
        purpose: "portfolio",
        name: `synthetic-${i}.png`,
        byteLength: f.original.length,
        mediaType: "image/png",
      },
      "portfolio",
    );
  const count = f.db.sqlite
    .query("SELECT count(*) AS n FROM v2_assets WHERE owner_id=?")
    .get(f.actor.ownerId) as { n: number };
  expect(count.n).toBe(51);
  f.db.sqlite
    .query("UPDATE session SET expires_at=? WHERE user_id=?")
    .run(Date.now() + 3600000, f.actor.ownerId);
  const token = (
    f.db.sqlite.query("SELECT token FROM session WHERE user_id=?").get(f.actor.ownerId) as {
      token: string;
    }
  ).token;
  const env = {
    ...testEnvironment(f.db.binding),
    CASE_DATA_KEY_V1: btoa("k".repeat(32)).replace(/=+$/, ""),
    CASE_PRIVATE_R2: f.bucketPort,
  };
  const cookie = await signedSessionCookie(token, env.BETTER_AUTH_SECRET);
  const app = new Hono().route(
    "/api/v2/me",
    createLawyersApi({ selfAssetDecoder: f.processing.openSanitized }),
  );
  const response = await app.request(
    "/api/v2/me/lawyer/self-profile/assets",
    { headers: { cookie } },
    env,
  );
  expect(response.status).toBe(200);
  const list = (await response.json()) as { items: { id: string }[]; nextCursor: string | null };
  expect(list.items).toHaveLength(50);
  expect(list.nextCursor).toBeTruthy();
  expect(list.items.some((x) => x.id === f.params.assetId)).toBe(false);
  const next = await app.request(
    `/api/v2/me/lawyer/self-profile/assets?cursor=${encodeURIComponent(list.nextCursor ?? "")}`,
    { headers: { cookie } },
    env,
  );
  const second = (await next.json()) as { items: { id: string }[] };
  expect(second.items.map((x) => x.id)).toEqual([f.params.assetId]);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (path) =>
    app.request(String(path), { headers: { cookie } }, env)) as typeof fetch;
  try {
    const all = await lawyerAssets.list();
    expect(all).toHaveLength(51);
    expect(new Set(all.map((asset) => asset.id)).size).toBe(51);
    expect(all.some((asset) => asset.id === f.params.assetId)).toBe(true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
