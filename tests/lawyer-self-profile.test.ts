import { afterEach, expect, test } from "bun:test";
import { Hono } from "hono";
import { createMockLawyers, type LawyerMockStore } from "../src/client/api/mock/lawyers";
import type { ApiEnvironment } from "../src/server/api/errors";
import { createDirectoryApi } from "../src/server/api/v2/directory";
import { createLawyersApi } from "../src/server/api/v2/lawyers";
import { saveAccountType } from "../src/server/auth/account-type";
import { createCaseDataCipher } from "../src/server/crypto";
import { createV2Core } from "../src/server/db/v2-core";
import { createSelfProfileService } from "../src/server/modules/lawyers/self-profile";
import {
  selfDirectoryPageSchema,
  selfProfileSchema,
} from "../src/server/modules/lawyers/self-profile-contract";
import { createTestDatabase } from "./helpers/d1";
import { seedTestSession } from "./helpers/session";

const complete = {
  name: "합성변호사",
  introduction: "사실관계 정리를 돕는 합성 프로필",
  officeName: "합성사무실",
  address: "서울 서초구 합성로 1",
  region: "seoul" as const,
  practiceAreas: ["civil" as const],
  email: "lawyer@example.invalid",
  portfolio: [{ id: "activity-1", title: "합성 공개 활동", url: "https://example.com/portfolio" }],
};
test("text portfolio keeps its own body through encrypted save, reconnect, publication, edit and removal", async () => {
  const f = await fixture();
  const service = createSelfProfileService(f.core);
  const blank = await service.getMine(f.owner.userId);
  const text = "제목과 다른 본문입니다.\n<script>실행하지 않는 글</script>";
  const saved = await service.saveMine(f.owner.userId, {
    ...blank,
    ...complete,
    portfolio: [{ id: "text-work", title: "작성한 활동", text, url: null }],
  });
  expect((await createSelfProfileService(f.core).getMine(f.owner.userId)).portfolio[0]?.text).toBe(
    text,
  );
  const published = await service.publishMine(f.owner.userId, true, saved.revision, saved.id);
  expect((await service.get(saved.id)).portfolio[0]).toMatchObject({ title: "작성한 활동", text });
  const edited = await service.saveMine(f.owner.userId, {
    ...published,
    portfolio: [{ ...published.portfolio[0], text: "수정한 본문" }],
  });
  expect((await service.get(saved.id)).portfolio[0]?.text).toBe("수정한 본문");
  await service.saveMine(f.owner.userId, { ...edited, portfolio: [] });
  expect((await service.get(saved.id)).portfolio).toEqual([]);
  expect(
    selfProfileSchema.safeParse({
      ...saved,
      portfolio: [{ id: "long", title: "길이", text: "가".repeat(5001), url: null }],
    }).success,
  ).toBe(false);
  expect(selfProfileSchema.parse({ ...saved, ...complete }).portfolio[0]).not.toHaveProperty(
    "text",
  );
});

test("renewal permits existing own profile/assets reads, blocks mutation and public visibility, creates no new profile", async () => {
  const f = await fixture();
  const service = createSelfProfileService(f.core);
  const blank = await service.getMine(f.owner.userId);
  const saved = await service.saveMine(f.owner.userId, { ...blank, ...complete });
  const published = await service.publishMine(f.owner.userId, true, saved.revision, saved.id);
  f.db.sqlite
    .query("UPDATE user_consents SET privacy_version='stale' WHERE user_id=?")
    .run(f.owner.userId);
  expect(
    selfProfileSchema.parse(await (await f.request("/v2/me/lawyer/self-profile")).json()),
  ).toEqual(published);
  expect((await f.request("/v2/me/lawyer/self-profile/assets")).status).toBe(200);
  expect(
    (await f.request("/v2/me/lawyer/self-profile", f.owner, "PUT", { profile: published })).status,
  ).toBe(403);
  expect(
    (
      await f.request("/v2/me/lawyer/self-profile/publication", f.owner, "POST", {
        published: true,
        profileId: published.id,
        expectedRevision: published.revision,
        consent: true,
      })
    ).status,
  ).toBe(403);
  expect((await f.request(`/v2/lawyers/self-service/${published.id}`)).status).toBe(404);
  expect((await f.request("/v2/me/lawyer/self-profile", f.noConsent)).status).toBe(403);
  expect(
    f.db.sqlite.query("SELECT id FROM v2_profiles WHERE owner_id=?").get(f.noConsent.userId),
  ).toBeNull();
  expect((await f.request("/v2/me/lawyer/self-profile", f.other)).status).toBe(403);
});

test("domain mock keeps existing reads after renewal and denies writes, uploads and foreign access", async () => {
  let store: LawyerMockStore | null = null;
  let needsConsent = false;
  let id = "owner";
  const api = createMockLawyers({
    read: () => store,
    write: (next) => {
      store = next;
    },
    session: async () => ({ user: { id, name: "합성", accountType: "lawyer" }, needsConsent }),
  });
  const blank = await api.getMine();
  const saved = await api.saveMine({
    ...blank,
    ...complete,
    portfolio: [{ id: "text", title: "제목", text: "본문", url: null }],
  });
  const asset = await api.uploadAsset({
    profileId: saved.id,
    file: new File(["synthetic"], "fixture.pdf", { type: "application/pdf" }),
    purpose: "portfolio",
  });
  needsConsent = true;
  expect(await api.getMine()).toEqual(saved);
  expect(await api.assets()).toHaveLength(1);
  expect(
    (await api.assetBlob({ profileId: saved.id, assetId: asset.id, privateRead: true })).type,
  ).toBe("application/pdf");
  await expect(api.saveMine(saved)).rejects.toThrow("필수 동의");
  await expect(
    api.publishMine(true, { profileId: saved.id, expectedRevision: saved.revision }),
  ).rejects.toThrow("필수 동의");
  await expect(
    api.uploadAsset({ profileId: saved.id, file: new File(["x"], "x.pdf"), purpose: "portfolio" }),
  ).rejects.toThrow("필수 동의");
  id = "foreign";
  await expect(api.getMine()).rejects.toThrow("새 프로필");
  await expect(
    api.assetBlob({ profileId: saved.id, assetId: asset.id, privateRead: true }),
  ).rejects.toThrow();
});
test("mock owner edit/publish/refresh/directory share one profile; customers cannot edit", async () => {
  let serialized: string | null = null;
  let user: { id: string; name: string; accountType: string } | null = {
    id: "synthetic-lawyer",
    name: "합성",
    accountType: "lawyer",
  };
  const context = {
    read: () => (serialized ? (JSON.parse(serialized) as LawyerMockStore) : null),
    write: (state: LawyerMockStore) => {
      serialized = JSON.stringify(state);
    },
    session: async () => ({ user, needsConsent: false }),
  };
  let api = createMockLawyers(context);
  const blank = await api.getMine();
  expect(blank.verificationStatus).toBe("self_declared");
  await expect(
    api.publishMine(true, { profileId: blank.id, expectedRevision: blank.revision }),
  ).rejects.toThrow();
  const saved = await api.saveMine({ ...blank, ...complete, verificationStatus: "verified" });
  expect(await api.saveMine({ ...blank, ...complete, verificationStatus: "verified" })).toEqual(
    saved,
  );
  expect(saved.verificationStatus).toBe("self_declared");
  const stale = { ...saved, name: "old tab" };
  const published = await api.publishMine(true, {
    profileId: saved.id,
    expectedRevision: saved.revision,
  });
  expect(await api.get(published.id)).toEqual(published);
  api = createMockLawyers(context);
  expect(await api.getMine()).toEqual(published);
  expect(await api.list({ region: "seoul", practiceArea: "civil", query: "합성변호사" })).toEqual([
    published,
  ]);
  await expect(api.saveMine(stale)).rejects.toThrow();
  await api.publishMine(false, { profileId: published.id, expectedRevision: published.revision });
  expect(await api.list({ query: "합성변호사" })).toEqual([]);
  await expect(api.get(published.id)).rejects.toThrow();
  user = { id: "customer", name: "고객", accountType: "customer" };
  await expect(api.getMine()).rejects.toThrow();
  user = { id: "other-lawyer", name: "타인", accountType: "lawyer" };
  await expect(api.saveMine(published)).rejects.toThrow();
});

const databases: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
async function fixture() {
  const db = await createTestDatabase();
  databases.push(db);
  const owner = await seedTestSession(db, { consent: true });
  const other = await seedTestSession(db, { consent: true });
  const noConsent = await seedTestSession(db, { consent: false });
  for (const user of [owner, noConsent])
    db.sqlite
      .query(
        "INSERT INTO v2_role_bindings(owner_id,role,granted_at) VALUES(?,'lawyer_applicant',?)",
      )
      .run(user.userId, new Date().toISOString());
  const env = { ...owner.env, CASE_DATA_KEY_V1: btoa("k".repeat(32)).replace(/=+$/, "") };
  const core = createV2Core(db.binding, await createCaseDataCipher(env));
  const app = new Hono<ApiEnvironment>()
    .use("*", async (c, next) => {
      c.set("requestId", "synthetic_request");
      await next();
    })
    .route("/v2/me", createLawyersApi())
    .route("/v2/lawyers", createDirectoryApi());
  const request = (
    path: string,
    user = owner,
    method = "GET",
    body?: unknown,
    origin = env.BETTER_AUTH_URL,
  ) =>
    app.request(
      path,
      {
        method,
        headers: { cookie: user.cookie, origin, "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      env,
    );
  return { db, owner, other, noConsent, env, core, app, request };
}
test("real API stores encrypted self profiles, records publication consent, hides and cleans up", async () => {
  const f = await fixture();
  const blank = selfProfileSchema.parse(
    await (await f.request("/v2/me/lawyer/self-profile")).json(),
  );
  expect(blank.published).toBe(false);
  const savedResponse = await f.request("/v2/me/lawyer/self-profile", f.owner, "PUT", {
    profile: { ...blank, ...complete, verificationStatus: "verified" },
  });
  expect(savedResponse.status).toBe(200);
  const saved = selfProfileSchema.parse(await savedResponse.json());
  expect(
    selfProfileSchema.parse(
      await (
        await f.request("/v2/me/lawyer/self-profile", f.owner, "PUT", {
          profile: { ...blank, ...complete, verificationStatus: "verified" },
        })
      ).json(),
    ),
  ).toEqual(saved);
  expect(saved.verificationStatus).toBe("self_declared");
  expect((await f.request("/v2/lawyers/self-service")).status).toBe(200);
  expect(
    selfDirectoryPageSchema.parse(await (await f.request("/v2/lawyers/self-service")).json()).items,
  ).toEqual([]);
  const withoutConsent = await f.request(
    "/v2/me/lawyer/self-profile/publication",
    f.owner,
    "POST",
    { published: true, profileId: saved.id, expectedRevision: saved.revision, consent: false },
  );
  expect(withoutConsent.status).toBe(400);
  const publication = await f.request("/v2/me/lawyer/self-profile/publication", f.owner, "POST", {
    published: true,
    profileId: saved.id,
    expectedRevision: saved.revision,
    consent: true,
  });
  expect(publication.status).toBe(200);
  const published = selfProfileSchema.parse(await publication.json());
  expect(
    selfDirectoryPageSchema.parse(
      await (
        await f.request("/v2/lawyers/self-service?region=seoul&legalField=civil&name=합성")
      ).json(),
    ).items,
  ).toEqual([published]);
  expect(
    selfProfileSchema.parse(
      await (await f.request(`/v2/lawyers/self-service/${published.id}`)).json(),
    ),
  ).toEqual(published);
  expect(await createSelfProfileService(f.core).getMine(f.owner.userId)).toEqual(published);
  const rows = f.db.sqlite.query("SELECT encrypted_payload FROM v2_private_parts").all() as {
    encrypted_payload: string;
  }[];
  expect(rows.some((r) => r.encrypted_payload.includes(complete.name))).toBe(false);
  expect(
    f.db.sqlite.query("SELECT role FROM v2_role_bindings WHERE owner_id=?").all(f.owner.userId),
  ).toEqual([{ role: "lawyer_applicant" }]);
  expect(
    (await f.request("/v2/me/lawyer/self-profile", f.owner, "PUT", { profile: saved })).status,
  ).toBe(409);
  const hidden = await f.request("/v2/me/lawyer/self-profile/publication", f.owner, "POST", {
    published: false,
    profileId: published.id,
    expectedRevision: published.revision,
    consent: false,
  });
  expect(hidden.status).toBe(200);
  expect(
    selfDirectoryPageSchema.parse(await (await f.request("/v2/lawyers/self-service")).json()).items,
  ).toEqual([]);
  expect((await f.request(`/v2/lawyers/self-service/${published.id}`)).status).toBe(404);
  f.db.sqlite.query("DELETE FROM user WHERE id=?").run(f.owner.userId);
  expect(
    f.db.sqlite
      .query("SELECT count(*) AS n FROM v2_private_snapshots WHERE target_id=?")
      .get(published.id),
  ).toEqual({ n: 0 });
});

test("selected lawyer accounts manage self-declared profiles without qualification roles", async () => {
  const f = await fixture();
  await saveAccountType(f.db.binding, f.other.userId, "lawyer");
  await saveAccountType(f.db.binding, f.noConsent.userId, "lawyer");
  expect((await f.request("/v2/me/lawyer/self-profile", f.noConsent)).status).toBe(403);
  const blankResponse = await f.request("/v2/me/lawyer/self-profile", f.other);
  expect(blankResponse.status).toBe(200);
  const blank = selfProfileSchema.parse(await blankResponse.json());
  const savedResponse = await f.request("/v2/me/lawyer/self-profile", f.other, "PUT", {
    profile: { ...blank, ...complete, verificationStatus: "verified" },
  });
  expect(savedResponse.status).toBe(200);
  const saved = selfProfileSchema.parse(await savedResponse.json());
  const publication = await f.request("/v2/me/lawyer/self-profile/publication", f.other, "POST", {
    published: true,
    profileId: saved.id,
    expectedRevision: saved.revision,
    consent: true,
  });
  expect(publication.status).toBe(200);
  const published = selfProfileSchema.parse(await publication.json());
  expect(published.verificationStatus).toBe("self_declared");
  expect(
    f.db.sqlite.query("SELECT role FROM v2_role_bindings WHERE owner_id=?").all(f.other.userId),
  ).toEqual([]);
  expect(
    selfProfileSchema.parse(await (await f.request("/v2/me/lawyer/self-profile", f.other)).json()),
  ).toEqual(published);
  expect(
    selfDirectoryPageSchema.parse(await (await f.request("/v2/lawyers/self-service")).json()).items,
  ).toEqual([published]);
  expect((await f.request(`/v2/lawyers/self-service/${published.id}`)).status).toBe(200);

  await saveAccountType(f.db.binding, f.other.userId, "customer");
  expect((await f.request("/v2/me/lawyer/self-profile", f.other)).status).toBe(403);
  expect((await f.request(`/v2/lawyers/self-service/${published.id}`)).status).toBe(404);
  expect(
    selfDirectoryPageSchema.parse(await (await f.request("/v2/lawyers/self-service")).json()).items,
  ).toEqual([]);
  await expect(
    createSelfProfileService(f.core).saveMine(f.other.userId, {
      ...published,
      name: "권한 변경 뒤 합성 수정",
    }),
  ).rejects.toThrow("STALE_REVISION");

  await saveAccountType(f.db.binding, f.other.userId, "lawyer");
  expect((await f.request(`/v2/lawyers/self-service/${published.id}`)).status).toBe(200);
  f.db.sqlite
    .query("INSERT INTO v2_tombstones(target_kind,target_id,deleted_at) VALUES('account',?,?)")
    .run(f.other.userId, new Date().toISOString());
  expect((await f.request("/v2/me/lawyer/self-profile", f.other)).status).toBe(403);
  expect((await f.request(`/v2/lawyers/self-service/${published.id}`)).status).toBe(404);
});

test("customer preference overrides legacy lawyer access while preserving existing roles", async () => {
  const f = await fixture();
  expect((await f.request("/v2/me/lawyer/self-profile")).status).toBe(200);
  await saveAccountType(f.db.binding, f.owner.userId, "customer");
  expect((await f.request("/v2/me/lawyer/self-profile")).status).toBe(403);
  expect(
    f.db.sqlite.query("SELECT role FROM v2_role_bindings WHERE owner_id=?").all(f.owner.userId),
  ).toEqual([{ role: "lawyer_applicant" }]);
  await saveAccountType(f.db.binding, f.owner.userId, "lawyer");
  expect((await f.request("/v2/me/lawyer/self-profile")).status).toBe(200);
});

test("self directory advances filtered empty pages and returns profiles beyond the first page", async () => {
  const f = await fixture();
  const service = createSelfProfileService(f.core);
  const profiles = [];
  // This directory fixture needs current consent for both publishing owners.
  f.db.sqlite
    .query(
      "INSERT INTO user_consents SELECT ?,terms_version,privacy_version,ai_notice_version,over_14_confirmed,consented_at FROM user_consents WHERE user_id=?",
    )
    .run(f.noConsent.userId, f.owner.userId);
  for (const user of [f.owner, f.noConsent]) {
    const blank = await service.getMine(user.userId);
    const saved = await service.saveMine(user.userId, { ...blank, ...complete, name: user.userId });
    profiles.push(await service.publishMine(user.userId, true, saved.revision, saved.id));
  }
  profiles.sort((a, b) => a.id.localeCompare(b.id));
  const firstProfile = profiles[0];
  const wanted = profiles[1];
  if (!firstProfile || !wanted) throw new Error("Expected two synthetic profiles");
  const first = selfDirectoryPageSchema.parse(
    await (await f.request(`/v2/lawyers/self-service?limit=1&name=${wanted.name}`)).json(),
  );
  expect(first.items).toEqual([]);
  expect(first.nextCursor).toBe(firstProfile.id);
  const second = selfDirectoryPageSchema.parse(
    await (
      await f.request(
        `/v2/lawyers/self-service?limit=1&name=${wanted.name}&cursor=${first.nextCursor}`,
      )
    ).json(),
  );
  expect(second.items).toEqual([wanted]);
  expect(second.nextCursor).toBeNull();
});
test("self API denies wrong role, missing consent, cross-owner, origin and production gate", async () => {
  const f = await fixture();
  expect((await f.request("/v2/me/lawyer/self-profile", f.other)).status).toBe(403);
  expect((await f.request("/v2/me/lawyer/self-profile", f.noConsent)).status).toBe(403);
  expect(
    (await f.request("/v2/me/lawyer/self-profile", f.owner, "PUT", {}, "https://outside.invalid"))
      .status,
  ).toBe(403);
  const mine = selfProfileSchema.parse(
    await (await f.request("/v2/me/lawyer/self-profile")).json(),
  );
  expect(
    (
      await f.request("/v2/me/lawyer/self-profile", f.owner, "PUT", {
        profile: { ...mine, id: "another-profile" },
      })
    ).status,
  ).toBe(404);
  expect(
    (
      await f.request("/v2/me/lawyer/self-profile", f.owner, "PUT", {
        profile: { ...mine, website: "javascript:alert(1)" },
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await f.app.request(
        "/v2/lawyers/self-service",
        {},
        { ...f.env, APP_ENV: "production", PUBLIC_BETA_ENABLED: "false" },
      )
    ).status,
  ).toBe(503);
});

test("publication is bound to the displayed profile and current consent, including role changes", async () => {
  const f = await fixture();
  await saveAccountType(f.db.binding, f.other.userId, "lawyer");
  const mine = selfProfileSchema.parse(
    await (await f.request("/v2/me/lawyer/self-profile")).json(),
  );
  const saved = selfProfileSchema.parse(
    await (
      await f.request("/v2/me/lawyer/self-profile", f.owner, "PUT", {
        profile: { ...mine, ...complete },
      })
    ).json(),
  );
  const other = selfProfileSchema.parse(
    await (await f.request("/v2/me/lawyer/self-profile", f.other)).json(),
  );
  const otherSaved = selfProfileSchema.parse(
    await (
      await f.request("/v2/me/lawyer/self-profile", f.other, "PUT", {
        profile: { ...other, ...complete },
      })
    ).json(),
  );
  expect(otherSaved.revision).toBe(saved.revision);
  expect(
    (
      await f.request("/v2/me/lawyer/self-profile/publication", f.other, "POST", {
        profileId: saved.id,
        published: true,
        expectedRevision: saved.revision,
        consent: true,
      })
    ).status,
  ).toBe(404);
  const missing = await f.request("/v2/me/lawyer/self-profile/publication", f.other, "POST", {
    published: true,
    expectedRevision: saved.revision,
    consent: true,
  });
  expect(missing.status).toBe(400);
  const missingBody = (await missing.json()) as { error: { code: string } };
  expect(missingBody.error.code).toBe("VALIDATION_ERROR");
  expect(await createSelfProfileService(f.core).getMine(f.other.userId)).toEqual(otherSaved);
  const valid = {
    published: true,
    profileId: otherSaved.id,
    expectedRevision: otherSaved.revision,
    consent: true,
  };
  const normal = await f.request("/v2/me/lawyer/self-profile/publication", f.other, "POST", valid);
  expect(normal.status).toBe(200);
  const otherPublished = selfProfileSchema.parse(await normal.json());
  expect(otherPublished.published).toBe(true);
  expect(otherPublished.revision).toBe(otherSaved.revision + 1);
  const replay = await f.request("/v2/me/lawyer/self-profile/publication", f.other, "POST", valid);
  expect(replay.status).toBe(200);
  expect(selfProfileSchema.parse(await replay.json())).toEqual(otherPublished);
  expect(
    (
      await f.request("/v2/me/lawyer/self-profile/publication", f.owner, "POST", {
        profileId: saved.id,
        published: true,
        expectedRevision: saved.revision,
        consent: true,
      })
    ).status,
  ).toBe(200);
  f.db.sqlite
    .query("UPDATE user_consents SET privacy_version='old-version' WHERE user_id=?")
    .run(f.owner.userId);
  expect((await f.request(`/v2/lawyers/self-service/${saved.id}`)).status).toBe(404);
  expect((await f.request("/v2/me/lawyer/self-profile", f.owner)).status).toBe(200);
});
