import { expect, test } from "bun:test";
import { Hono } from "hono";
import type { ApiEnvironment } from "../src/server/api/errors";
import { createDirectoryApi } from "../src/server/api/v2/directory";
import { createLawyersApi } from "../src/server/api/v2/lawyers";
import { saveAccountType } from "../src/server/auth/account-type";
import { createV2DeletionRepository } from "../src/server/db/v2-deletion";
import { createSelfProfileService } from "../src/server/modules/lawyers/self-profile";
import { selfAssetUrl } from "../src/server/modules/lawyers/self-profile-contract";
import { signedSessionCookie, testEnvironment } from "./helpers/d1";
import { selfAssetFixture } from "./helpers/lawyer-self-assets";
import { seedTestSession } from "./helpers/session";

async function publishedFixture(pdf = false) {
  const f = await selfAssetFixture({ pdf });
  await saveAccountType(f.db.binding, f.actor.ownerId, "lawyer");
  expect(
    await f.processing.sanitize(f.params, f.lease, new AbortController().signal),
  ).toMatchObject({ status: "ready" });
  const service = createSelfProfileService(f.core, () => f.actor.now);
  const blank = await service.getMine(f.actor.ownerId);
  const saved = await service.saveMine(f.actor.ownerId, {
    ...blank,
    name: "합성",
    introduction: "합성 소개",
    officeName: "합성 사무실",
    address: "서울 합성로 1",
    region: "seoul",
    practiceAreas: ["civil"],
    email: "synthetic@example.invalid",
    ...(pdf
      ? {
          portfolio: [
            {
              id: "activity",
              title: "합성 PDF 자료",
              assetId: f.params.assetId,
              url: selfAssetUrl(blank.id, f.params.assetId),
            },
          ],
        }
      : { photoAssetId: f.params.assetId, photoUrl: selfAssetUrl(blank.id, f.params.assetId) }),
  });
  const profile = await service.publishMine(f.actor.ownerId, true, saved.revision, saved.id);
  const app = new Hono<ApiEnvironment>()
    .use("*", async (c, next) => {
      c.set("requestId", "synthetic_self_assets");
      await next();
    })
    .route(
      "/lawyers",
      createDirectoryApi({
        clock: () => f.actor.now,
        selfAssetDecoder: f.processing.openSanitized,
      }),
    );
  const path = `/lawyers/self-service/${profile.id}/assets/${f.params.assetId}`;
  const request = (url = path) =>
    app.request(
      url,
      {},
      {
        ...testEnvironment(f.db.binding),
        CASE_DATA_KEY_V1: btoa("k".repeat(32)).replace(/=+$/, ""),
        CASE_PRIVATE_R2: f.bucketPort,
      },
    );
  return { ...f, service, profile, request, path };
}

test("existing asset upload/sanitizer feeds persisted self profile; only its published sanitized bytes are public", async () => {
  const f = await publishedFixture();
  expect(await createSelfProfileService(f.core).getMine(f.actor.ownerId)).toEqual(f.profile);
  const response = await f.request();
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("content-type")).toBe("image/jpeg");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(f.output);
  expect(
    (await f.request(f.path.replace(f.params.assetId, "foreign-or-original-asset"))).status,
  ).toBe(404);
  await f.service.publishMine(f.actor.ownerId, false, f.profile.revision, f.profile.id);
  expect((await f.request()).status).toBe(404);
});

test("existing PDF portfolio pipeline publishes only the linked sanitized attachment and revokes it on deletion", async () => {
  const f = await publishedFixture(true);
  const response = await f.request();
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/pdf");
  expect(response.headers.get("content-disposition")).toBe('attachment; filename="portfolio.pdf"');
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(f.output);
  expect(await createV2DeletionRepository(f.core).asset(f.actor, f.params.assetId, 3)).toBeTruthy();
  expect((await f.request()).status).toBe(404);
});

test("ready own upload preview works before profile attachment while public and foreign access remain denied", async () => {
  const f = await publishedFixture();
  await f.service.saveMine(f.actor.ownerId, { ...f.profile, photoAssetId: null, photoUrl: null });
  expect((await f.request()).status).toBe(404);
  f.db.sqlite
    .query("UPDATE session SET expires_at=? WHERE user_id=?")
    .run(Date.now() + 3600000, f.actor.ownerId);
  const token = (
    f.db.sqlite.query("SELECT token FROM session WHERE user_id=?").get(f.actor.ownerId) as {
      token: string;
    }
  ).token;
  const cookie = await signedSessionCookie(token, testEnvironment(f.db.binding).BETTER_AUTH_SECRET);
  const other = await seedTestSession(f.db, { consent: true });
  await saveAccountType(f.db.binding, other.userId, "lawyer");
  const app = new Hono<ApiEnvironment>().route(
    "/me",
    createLawyersApi({ selfAssetDecoder: f.processing.openSanitized }),
  );
  const request = (cookie: string) =>
    app.request(
      `/me/lawyer/self-profile/assets/${f.params.assetId}/content`,
      { headers: { cookie } },
      {
        ...testEnvironment(f.db.binding),
        CASE_DATA_KEY_V1: btoa("k".repeat(32)).replace(/=+$/, ""),
        CASE_PRIVATE_R2: f.bucketPort,
      },
    );
  const own = await request(cookie);
  expect(own.status).toBe(200);
  expect(new Uint8Array(await own.arrayBuffer())).toEqual(f.output);
  expect((await request(other.cookie)).status).toBe(404);
  await saveAccountType(f.db.binding, f.actor.ownerId, "customer");
  expect((await request(cookie)).status).toBe(403);
});

test("ready asset owner/purpose and deletion/current consent gates protect self publication and in-flight streams", async () => {
  const f = await publishedFixture();
  const wrong = {
    ...f.profile,
    portfolio: [
      {
        id: "activity",
        title: "wrong-purpose",
        assetId: f.params.assetId,
        url: selfAssetUrl(f.profile.id, f.params.assetId),
      },
    ],
  };
  await expect(f.service.saveMine(f.actor.ownerId, wrong)).rejects.toThrow("ASSET_NOT_READY");
  const response = await f.request();
  expect(response.status).toBe(200);
  await saveAccountType(f.db.binding, f.actor.ownerId, "customer");
  await expect(response.arrayBuffer()).rejects.toThrow();
  expect((await f.request()).status).toBe(404);
  await saveAccountType(f.db.binding, f.actor.ownerId, "lawyer");
  f.db.sqlite
    .query("UPDATE user_consents SET privacy_version='stale' WHERE user_id=?")
    .run(f.actor.ownerId);
  expect((await f.request()).status).toBe(404);
});

test("stream revision fences avoid snapshot decryption and support own uploads before the first save", async () => {
  const f = await publishedFixture();
  let decryptions = 0;
  const sessionId = (
    f.db.sqlite.query("SELECT id FROM session WHERE user_id=?").get(f.actor.ownerId) as {
      id: string;
    }
  ).id;
  const service = createSelfProfileService(
    {
      ...f.core,
      decrypt: async (...args: Parameters<typeof f.core.decrypt>) => {
        decryptions++;
        return f.core.decrypt(...args);
      },
    },
    () => f.actor.now,
  );
  expect(await service.isCurrent(f.actor.ownerId, f.profile, true)).toBe(true);
  expect(await service.isCurrent(f.actor.ownerId, f.profile, false)).toBe(false);
  expect(await service.isCurrent(f.actor.ownerId, f.profile, false, sessionId)).toBe(true);
  f.db.sqlite
    .query("UPDATE session SET expires_at=? WHERE id=?")
    .run(Date.parse(f.actor.now), sessionId);
  expect(await service.isCurrent(f.actor.ownerId, f.profile, false, sessionId)).toBe(false);
  f.db.sqlite
    .query("UPDATE session SET expires_at=? WHERE id=?")
    .run(Date.parse(f.actor.now) + 3600000, sessionId);
  await saveAccountType(f.db.binding, f.actor.ownerId, "customer");
  expect(await service.isCurrent(f.actor.ownerId, f.profile, false, sessionId)).toBe(false);
  await saveAccountType(f.db.binding, f.actor.ownerId, "lawyer");
  expect(decryptions).toBe(0);
  await f.service.publishMine(f.actor.ownerId, false, f.profile.revision, f.profile.id);
  expect(await service.isCurrent(f.actor.ownerId, f.profile, true)).toBe(false);
  expect(await service.isCurrent(f.actor.ownerId, f.profile, false, sessionId)).toBe(false);
  const fresh = await selfAssetFixture();
  await saveAccountType(fresh.db.binding, fresh.actor.ownerId, "lawyer");
  const freshSession = (
    fresh.db.sqlite.query("SELECT id FROM session WHERE user_id=?").get(fresh.actor.ownerId) as {
      id: string;
    }
  ).id;
  const freshService = createSelfProfileService(fresh.core, () => fresh.actor.now);
  const blank = await freshService.getMine(fresh.actor.ownerId);
  expect(await freshService.isCurrent(fresh.actor.ownerId, blank, false, freshSession)).toBe(true);
  expect(await freshService.isCurrent(fresh.actor.ownerId, blank, true)).toBe(false);
});

test("photo plus all 30 portfolio assets save/publish within D1's 100 bound parameters", async () => {
  const f = await selfAssetFixture();
  await saveAccountType(f.db.binding, f.actor.ownerId, "lawyer");
  expect(
    await f.processing.sanitize(f.params, f.lease, new AbortController().signal),
  ).toMatchObject({ status: "ready" });
  const refs: { id: string; title: string; assetId: string; url: string }[] = [];
  for (let index = 0; index < 30; index++) {
    const reserved = await f.assets.reserve(
      f.actor.ownerId,
      1,
      crypto.randomUUID(),
      {
        purpose: "portfolio",
        name: "synthetic.png",
        byteLength: f.original.length,
        mediaType: "image/png",
      },
      "portfolio",
    );
    await f.assets.upload(
      f.actor.ownerId,
      reserved.assetId,
      1,
      f.original.length,
      new Response(f.original).body,
    );
    const jobId = crypto.randomUUID();
    expect(
      await f.jobs.admitAsset(f.actor, { assetId: reserved.assetId, assetRevision: 2, jobId }),
    ).toBe(true);
    const granted = await f.jobs.acquire(
      f.actor,
      jobId,
      crypto.randomUUID(),
      new Date(Date.parse(f.actor.now) + 300000).toISOString(),
    );
    if (!granted) throw new Error("synthetic lease missing");
    expect(
      await f
        .processingFor(jobId)
        .sanitize(
          { ...f.params, assetId: reserved.assetId, jobId },
          granted.lease,
          new AbortController().signal,
        ),
    ).toMatchObject({ status: "ready" });
    refs.push({
      id: `activity-${index}`,
      title: `합성 자료 ${index}`,
      assetId: reserved.assetId,
      url: selfAssetUrl(f.params.profileId, reserved.assetId),
    });
  }
  let maximum = 0;
  const service = createSelfProfileService(
    {
      ...f.core,
      statement(sql, args = []) {
        maximum = Math.max(maximum, args.length);
        expect(args.length).toBeLessThanOrEqual(100);
        return f.core.statement(sql, args);
      },
    },
    () => f.actor.now,
  );
  const blank = await service.getMine(f.actor.ownerId);
  const saved = await service.saveMine(f.actor.ownerId, {
    ...blank,
    name: "합성",
    introduction: "합성 소개",
    officeName: "합성 사무실",
    address: "서울 합성로 1",
    region: "seoul",
    practiceAreas: ["civil"],
    email: "synthetic@example.invalid",
    photoAssetId: f.params.assetId,
    photoUrl: selfAssetUrl(blank.id, f.params.assetId),
    portfolio: refs,
  });
  const profile = await service.publishMine(f.actor.ownerId, true, saved.revision, saved.id);
  expect((await service.getMine(f.actor.ownerId)).portfolio).toHaveLength(30);
  expect(await service.isCurrent(f.actor.ownerId, profile, true)).toBe(true);
  expect(maximum).toBe(67);
});
