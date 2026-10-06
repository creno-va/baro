import { afterEach, expect, test } from "bun:test";
import { Hono } from "hono";
import { z } from "zod";
import {
  v2LawyerApplicationSchema,
  v2ProfileRevisionSchema,
  v2PublicLawyerSchema,
  v2SessionRolesSchema,
} from "../src/contracts/v2";
import type { ApiEnvironment } from "../src/server/api/errors";
import { createLawyersApi } from "../src/server/api/v2/lawyers";
import { createModerationApi } from "../src/server/api/v2/moderation";
import { createCaseDataCipher } from "../src/server/crypto";
import { createV2AccountingRepository } from "../src/server/db/v2-accounting";
import { createV2Core } from "../src/server/db/v2-core";
import { createV2LawyersRepository } from "../src/server/db/v2-lawyers";
import { application, publicLawyer } from "./fixtures/contracts/v2";
import { createTestDatabase } from "./helpers/d1";
import { seedTestSession } from "./helpers/session";

const databases: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
async function fixture() {
  const db = await createTestDatabase();
  databases.push(db);
  const owner = await seedTestSession(db, { consent: true, oauthAuthenticatedAt: Date.now() });
  const moderator = await seedTestSession(db, { consent: true, oauthAuthenticatedAt: Date.now() });
  const stranger = await seedTestSession(db, { consent: true, oauthAuthenticatedAt: Date.now() });
  db.sqlite
    .query("INSERT INTO v2_role_bindings(owner_id,role,granted_at) VALUES(?,'moderator',?)")
    .run(moderator.userId, new Date().toISOString());
  const env = { ...owner.env, CASE_DATA_KEY_V1: btoa("k".repeat(32)).replace(/=+$/, "") };
  const app = new Hono<ApiEnvironment>()
    .use("*", async (c, next) => {
      c.set("requestId", "synthetic_request");
      await next();
    })
    .route("/v2/me", createLawyersApi())
    .route("/v2/moderation", createModerationApi());
  const request = (
    path: string,
    user = owner,
    method = "GET",
    body?: unknown,
    extra: Record<string, string> = {},
  ) =>
    app.request(
      path,
      {
        method,
        headers: {
          cookie: user.cookie,
          origin: env.BETTER_AUTH_URL,
          "content-type": "application/json",
          ...extra,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      env,
    );
  return {
    db,
    owner,
    moderator,
    stranger,
    env,
    app,
    request,
    core: createV2Core(db.binding, await createCaseDataCipher(env)),
  };
}
test("signed session, CSRF, consent and SQL roles reject before reading asset stream", async () => {
  const f = await fixture();
  let pulled = 0;
  const send = (headers: Record<string, string>, env = f.env) =>
    f.app.request(
      new Request("http://localhost:4321/v2/me/lawyer/assets/synthetic/content", {
        method: "PUT",
        headers: {
          "content-type": "application/octet-stream",
          "content-length": "20",
          "if-match": "1",
          ...headers,
        },
        body: new ReadableStream(
          {
            pull(c) {
              pulled++;
              c.enqueue(new Uint8Array(20));
              c.close();
            },
          },
          { highWaterMark: 0 },
        ),
      }),
      undefined,
      env,
    );
  expect((await send({ origin: f.env.BETTER_AUTH_URL })).status).toBe(401);
  expect((await send({ cookie: f.owner.cookie, origin: "https://attacker.invalid" })).status).toBe(
    403,
  );
  f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.owner.userId);
  expect((await send({ cookie: f.owner.cookie, origin: f.env.BETTER_AUTH_URL })).status).toBe(403);
  expect(
    (await send({}, { ...f.env, APP_ENV: "production", PUBLIC_BETA_ENABLED: "false" })).status,
  ).toBe(503);
  expect(pulled).toBe(0);
  expect(
    (
      await f.request("/v2/moderation/applications", f.stranger, "GET", undefined, {
        "x-role": "moderator",
      })
    ).status,
  ).toBe(403);
  expect(
    (await f.request("/v2/me/lawyer/application", f.stranger, "POST", { role: "verified_lawyer" }))
      .status,
  ).toBe(400);
});
test("partial application drafts retain values, concurrent CAS admits once, roles are SQL-derived", async () => {
  const f = await fixture();
  const created = await f.request("/v2/me/lawyer/application", f.owner, "POST", {});
  expect(created.status).toBe(201);
  const initial = v2LawyerApplicationSchema.parse(await created.json());
  expect(initial.revision).toBe(1);
  expect(initial.content).toEqual({});
  const edits = await Promise.all(
    ["synthetic_name_a", "synthetic_name_b"].map((name) =>
      f.request("/v2/me/lawyer/application", f.owner, "PUT", {
        expectedRevision: 1,
        content: { name, office: { region: "seoul" }, verificationAssetIds: [] },
      }),
    ),
  );
  expect(edits.map((r) => r.status).sort()).toEqual([200, 409]);
  const current = v2LawyerApplicationSchema.parse(
    await (await f.request("/v2/me/lawyer/application")).json(),
  );
  expect(current.revision).toBe(2);
  expect(current.content.office).toEqual({ region: "seoul" });
  const next = await f.request("/v2/me/lawyer/application", f.owner, "PUT", {
    expectedRevision: 2,
    content: { office: { address: "Synthetic office" } },
  });
  expect(next.status).toBe(200);
  expect(v2LawyerApplicationSchema.parse(await next.json()).content.office).toEqual({
    region: "seoul",
    address: "Synthetic office",
  });
  expect(
    (await f.request("/v2/me/lawyer/application/submit", f.owner, "POST", { expectedRevision: 3 }))
      .status,
  ).toBe(409);
  expect(await (await f.request("/v2/me/lawyer/application", f.stranger)).json()).toBeNull();
  const roles = v2SessionRolesSchema.parse(await (await f.request("/v2/me/roles")).json());
  expect(roles.roles).toEqual(["user", "lawyer_applicant"]);
  expect(f.db.sqlite.query("SELECT count(*) AS n FROM v2_moderation_decisions").get()).toEqual({
    n: 0,
  });
});

// Historical submitted fixture establishes an existing encrypted review target.
// Review itself always uses signed-session API + real SQL decision transactions.
async function submitted(f: Awaited<ReturnType<typeof fixture>>) {
  if (application.status === "draft") throw new Error("Complete synthetic fixture required");
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const value = {
    schemaVersion: "2",
    content: structuredClone(application.content),
    id,
    applicantId: f.owner.userId,
    revision: 1,
    status: "submitted",
    createdAt: now,
    submittedAt: now,
  };
  const envelope = await f.core.encrypt("v2_applications", id, f.owner.userId, 1, value);
  f.db.sqlite
    .query(
      "INSERT INTO v2_applications(id,owner_id,revision,status,encrypted_payload,submitted_at,created_at) VALUES(?,?,1,'submitted',?,?,?)",
    )
    .run(id, f.owner.userId, envelope, now, now);
  return id;
}
const approval = {
  expectedRevision: 1,
  decision: "approved",
  reason: "Synthetic review fixture",
  checklist: { identity: true, lawyerLicense: true, office: true },
};
test("manual application decision requires fresh real OAuth session, exact reviewer and one CAS", async () => {
  const f = await fixture();
  const id = await submitted(f);
  const queue = await f.request("/v2/moderation/applications?limit=1", f.moderator);
  expect(queue.status).toBe(200);
  expect(
    z.object({ items: z.array(z.object({ id: z.string() })) }).parse(await queue.json()).items[0]
      ?.id,
  ).toBe(id);
  expect((await f.request(`/v2/moderation/applications/${id}`, f.owner)).status).toBe(403);
  f.db.sqlite
    .query("INSERT INTO v2_role_bindings(owner_id,role,granted_at) VALUES(?,'moderator',?)")
    .run(f.owner.userId, new Date().toISOString());
  expect(
    (await f.request(`/v2/moderation/applications/${id}/decision`, f.owner, "POST", approval))
      .status,
  ).toBe(409);
  f.db.sqlite
    .query("UPDATE session SET oauth_authenticated_at=? WHERE id=?")
    .run(Date.now() - 601_000, f.moderator.sessionId);
  const stale = await f.request(
    `/v2/moderation/applications/${id}/decision`,
    f.moderator,
    "POST",
    approval,
  );
  expect(stale.status).toBe(403);
  expect(
    z.object({ error: z.object({ code: z.string() }) }).parse(await stale.json()).error.code,
  ).toBe("REAUTHENTICATION_REQUIRED");
  f.db.sqlite
    .query("UPDATE session SET oauth_authenticated_at=? WHERE id=?")
    .run(Date.now(), f.moderator.sessionId);
  const races = await Promise.all(
    [1, 2].map(() =>
      f.request(`/v2/moderation/applications/${id}/decision`, f.moderator, "POST", approval),
    ),
  );
  expect(races.map((r) => r.status).sort()).toEqual([200, 409]);
  const roles = v2SessionRolesSchema.parse(await (await f.request("/v2/me/roles")).json());
  expect(roles.roles).toContain("verified_lawyer");
  expect(roles.roles).not.toContain("lawyer_applicant");
  expect((await f.request(`/v2/moderation/applications/${id}`, f.moderator)).status).toBe(404);
  expect(
    (
      await f.request(`/v2/moderation/applications/${id}/revoke`, f.moderator, "POST", {
        expectedRevision: 1,
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await f.request(`/v2/moderation/applications/${id}/revoke`, f.moderator, "POST", {
        expectedRevision: 1,
      })
    ).status,
  ).toBe(409);
  expect(
    v2SessionRolesSchema.parse(await (await f.request("/v2/me/roles")).json()).roles,
  ).not.toContain("verified_lawyer");
});
test("reject/resubmit creates immutable revision and untrusted public/status fields are rejected", async () => {
  const f = await fixture();
  const id = await submitted(f);
  expect(
    (
      await f.request(`/v2/moderation/applications/${id}/decision`, f.moderator, "POST", {
        expectedRevision: 1,
        decision: "rejected",
        reason: "Synthetic missing proof",
      })
    ).status,
  ).toBe(200);
  const edited = await f.request("/v2/me/lawyer/application", f.owner, "PUT", {
    expectedRevision: 1,
    content: { name: "Revised synthetic lawyer", verificationAssetIds: [] },
  });
  expect(edited.status).toBe(200);
  const value = v2LawyerApplicationSchema.parse(await edited.json());
  expect(value.id).not.toBe(id);
  expect(value.revision).toBe(2);
  expect(value.status).toBe("draft");
  expect(
    (
      await f.request("/v2/me/lawyer/profile", f.owner, "PUT", {
        expectedRevision: 1,
        content: { name: "Draft" },
        status: "approved",
      })
    ).status,
  ).toBe(400);
  expect((await f.request("/v2/moderation/applications?limit=21", f.moderator)).status).toBe(400);
  const prior = await createV2LawyersRepository(f.core).readApplication(
    { ownerId: f.owner.userId, now: new Date().toISOString() },
    id,
  );
  expect(prior?.status).toBe("rejected");
});
test("profile draft and rejected resubmission preserve the previous approved public pointer", async () => {
  const f = await fixture();
  const appId = await submitted(f);
  expect(
    (
      await f.request(
        `/v2/moderation/applications/${appId}/decision`,
        f.moderator,
        "POST",
        approval,
      )
    ).status,
  ).toBe(200);
  const repository = createV2LawyersRepository(f.core);
  const profileId = crypto.randomUUID();
  const now = new Date().toISOString();
  expect(await repository.createProfile({ ownerId: f.owner.userId, now }, profileId)).toBe(true);
  const photoId = crypto.randomUUID();
  const hash = "a".repeat(64);
  const photo = {
    id: photoId,
    revision: 1,
    kind: "image",
    status: "ready",
    byteLength: 100,
    originalHash: hash,
    sanitizedDerivative: {
      id: "synthetic_photo_derivative",
      contentHash: hash,
      byteLength: 100,
      format: "jpeg",
    },
    currentJobId: null,
    failure: null,
  };
  const photoEnvelope = await f.core.encrypt("v2_assets", photoId, f.owner.userId, 1, photo);
  // An upstream synthetic sanitization fixture supplies a historical ready
  // asset. The API cannot submit a ready flag, blob hash or public-copy receipt.
  f.db.sqlite
    .query(
      "INSERT INTO v2_assets(id,owner_id,profile_id,purpose,state,encrypted_payload,created_at) VALUES(?,?,?,'profile_photo','reserved',?,?)",
    )
    .run(photoId, f.owner.userId, profileId, photoEnvelope, now);
  const principal = await createV2AccountingRepository(f.core).ensurePrincipal({
    ownerId: f.owner.userId,
    now,
  });
  if (!principal) throw new Error("Synthetic principal required");
  const reservationId = crypto.randomUUID();
  const sanitizedId = crypto.randomUUID();
  f.db.sqlite
    .query(
      "INSERT INTO v2_storage_reservations(id,principal_id,operation_id,target_id,entity_id,kind,byte_length,state,created_at) VALUES(?,?, 'synthetic_historical_op',?,?,'lawyer_asset',100,'stored',?)",
    )
    .run(reservationId, principal, sanitizedId, photoId, now);
  const blobEnvelope = await f.core.encrypt("v2_blobs", sanitizedId, f.owner.userId, 1, {
    contentHash: hash,
  });
  f.db.sqlite
    .query(
      "INSERT INTO v2_blobs(id,principal_id,reservation_id,kind,visibility,state,object_key,logical_bytes,cipher_bytes,cipher_hash,key_version,encrypted_payload,created_at) VALUES(?,?,?,'profile_photo_sanitized','staging','stored',?,100,100,?,'synthetic_fixture_v1',?,?)",
    )
    .run(sanitizedId, principal, reservationId, `staging/${sanitizedId}`, hash, blobEnvelope, now);
  f.db.sqlite
    .query("UPDATE v2_assets SET state='ready',sanitized_blob_id=? WHERE id=?")
    .run(sanitizedId, photoId);
  const content = { ...structuredClone(publicLawyer.content), photoAssetId: photoId };
  const draft = await f.request("/v2/me/lawyer/profile", f.owner, "PUT", {
    expectedRevision: 1,
    content,
  });
  expect(draft.status).toBe(200);
  const current = v2ProfileRevisionSchema.parse(await draft.json());
  expect(current.revision).toBe(2);
  expect(
    (await f.request("/v2/me/lawyer/profile/submit", f.owner, "POST", { expectedRevision: 2 }))
      .status,
  ).toBe(200);
  const checklist = {
    identityMatches: true,
    officeMatches: true,
    personalDataReviewed: true,
    advertisingReviewed: true,
    assetsSanitized: true,
  };
  const approved = await f.request(
    `/v2/moderation/profile-revisions/${current.id}/decision`,
    f.moderator,
    "POST",
    { expectedRevision: 2, decision: "approved", reason: "Synthetic profile review", checklist },
  );
  expect(approved.status).toBe(200);
  expect(
    z.object({ publicationPending: z.boolean() }).parse(await approved.json()).publicationPending,
  ).toBe(true);
  const publicDto = {
    ...structuredClone(publicLawyer),
    id: profileId,
    content,
    assets: publicLawyer.assets.map((a) => ({ ...a, id: photoId })),
  };
  // Historical completed public-copy fixture only; actual R2 publication is a
  // separate trusted internal path and remains tested with its source receipts.
  f.db.sqlite
    .query(
      "INSERT INTO v2_public_profiles(profile_id,revision_id,approved_revision,content_json,published_at) VALUES(?,?,2,?,?)",
    )
    .run(profileId, current.id, JSON.stringify(publicDto), now);
  f.db.sqlite
    .query("UPDATE v2_profiles SET approved_revision_id=? WHERE id=?")
    .run(current.id, profileId);
  const edited = await f.request("/v2/me/lawyer/profile", f.owner, "PUT", {
    expectedRevision: 2,
    content: { introduction: "New draft awaiting manual review" },
  });
  expect(edited.status).toBe(200);
  const edit = v2ProfileRevisionSchema.parse(await edited.json());
  expect(edit.revision).toBe(3);
  const viewSchema = z.object({
    published: v2PublicLawyerSchema.nullable(),
    current: v2ProfileRevisionSchema.nullable(),
  });
  const before = viewSchema.parse(await (await f.request("/v2/me/lawyer/profile")).json());
  expect(before.published?.approvedRevision).toBe(2);
  expect(before.published?.content.introduction).toBe(content.introduction);
  expect(before.current?.content.introduction).toBe("New draft awaiting manual review");
  expect(
    (await f.request("/v2/me/lawyer/profile/submit", f.owner, "POST", { expectedRevision: 3 }))
      .status,
  ).toBe(200);
  expect(
    (
      await f.request(`/v2/moderation/profile-revisions/${edit.id}/decision`, f.moderator, "POST", {
        expectedRevision: 3,
        decision: "rejected",
        reason: "Synthetic changes require edits",
      })
    ).status,
  ).toBe(200);
  const rejected = viewSchema.parse(await (await f.request("/v2/me/lawyer/profile")).json());
  expect(rejected.current?.status).toBe("rejected");
  expect(rejected.published?.approvedRevision).toBe(2);
});
test("incomplete owned profile remains editable and submit yields a domain error rather than internal failure", async () => {
  const f = await fixture();
  const id = await submitted(f);
  expect(
    (await f.request(`/v2/moderation/applications/${id}/decision`, f.moderator, "POST", approval))
      .status,
  ).toBe(200);
  const draft = await f.request("/v2/me/lawyer/profile", f.owner, "PUT", {
    expectedRevision: 1,
    content: { name: "Synthetic partial profile" },
  });
  expect(draft.status).toBe(200);
  const submit = await f.request("/v2/me/lawyer/profile/submit", f.owner, "POST", {
    expectedRevision: 2,
  });
  expect(submit.status).toBe(409);
  expect(
    z.object({ error: z.object({ code: z.string() }) }).parse(await submit.json()).error.code,
  ).toBe("FILE_REJECTED");
  expect(
    (
      await f.request("/v2/me/lawyer/profile", f.owner, "PUT", {
        expectedRevision: 2,
        content: { introduction: "Continued draft" },
      })
    ).status,
  ).toBe(200);
});
