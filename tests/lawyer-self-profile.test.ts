import { afterEach, expect, test } from "bun:test";
import { Hono } from "hono";
import { createMockLawyers, type LawyerMockStore } from "../src/client/api/mock/lawyers";
import type { ApiEnvironment } from "../src/server/api/errors";
import { createDirectoryApi } from "../src/server/api/v2/directory";
import { createLawyersApi } from "../src/server/api/v2/lawyers";
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
  await expect(api.publishMine(true)).rejects.toThrow();
  const saved = await api.saveMine({ ...blank, ...complete, verificationStatus: "verified" });
  expect(await api.saveMine({ ...blank, ...complete, verificationStatus: "verified" })).toEqual(
    saved,
  );
  expect(saved.verificationStatus).toBe("self_declared");
  const stale = { ...saved, name: "old tab" };
  const published = await api.publishMine(true);
  expect(await api.get(published.id)).toEqual(published);
  api = createMockLawyers(context);
  expect(await api.getMine()).toEqual(published);
  expect(await api.list({ region: "seoul", practiceArea: "civil", query: "합성변호사" })).toEqual([
    published,
  ]);
  await expect(api.saveMine(stale)).rejects.toThrow();
  await api.publishMine(false);
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
    { published: true, expectedRevision: saved.revision, consent: false },
  );
  expect(withoutConsent.status).toBe(400);
  const publication = await f.request("/v2/me/lawyer/self-profile/publication", f.owner, "POST", {
    published: true,
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

test("self directory advances filtered empty pages and returns profiles beyond the first page", async () => {
  const f = await fixture();
  const service = createSelfProfileService(f.core);
  const profiles = [];
  for (const user of [f.owner, f.noConsent]) {
    const blank = await service.getMine(user.userId);
    const saved = await service.saveMine(user.userId, { ...blank, ...complete, name: user.userId });
    profiles.push(await service.publishMine(user.userId, true, saved.revision));
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
