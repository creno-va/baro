import { afterEach, expect, test } from "bun:test";
import { sha256 } from "@noble/hashes/sha2.js";
import { Hono } from "hono";
import type { ApiEnvironment } from "../src/server/api/errors";
import { createModerationApi } from "../src/server/api/v2/moderation";
import { createCaseDataCipher } from "../src/server/crypto";
import { createV2AccountingRepository } from "../src/server/db/v2-accounting";
import { createV2Core } from "../src/server/db/v2-core";
import { createV2LawyersRepository } from "../src/server/db/v2-lawyers";
import { hex } from "../src/server/modules/files/binary";
import type { OpenSanitizedAsset } from "../src/server/modules/lawyers/sanitized";
import { createModerationService } from "../src/server/modules/moderation/service";
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
  const env = { ...owner.env, CASE_DATA_KEY_V1: btoa("k".repeat(32)).replace(/=+$/, "") };
  const core = createV2Core(db.binding, await createCaseDataCipher(env));
  const repo = createV2LawyersRepository(core);
  const now = new Date().toISOString();
  db.sqlite
    .query("INSERT INTO v2_role_bindings(owner_id,role,granted_at) VALUES(?,'moderator',?)")
    .run(moderator.userId, now);
  if (application.status === "draft") throw new Error("Complete synthetic source required");
  const applicationId = crypto.randomUUID();
  const appEnvelope = await core.encrypt("v2_applications", applicationId, owner.userId, 1, {
    schemaVersion: "2",
    id: applicationId,
    applicantId: owner.userId,
    revision: 1,
    status: "submitted",
    createdAt: now,
    submittedAt: now,
    content: application.content,
  });
  db.sqlite
    .query(
      "INSERT INTO v2_applications(id,owner_id,revision,status,encrypted_payload,submitted_at,created_at) VALUES(?,?,1,'submitted',?,?,?)",
    )
    .run(applicationId, owner.userId, appEnvelope, now, now);
  await createModerationService(core).decideApplication(
    moderator.userId,
    moderator.sessionId,
    applicationId,
    {
      expectedRevision: 1,
      decision: "approved",
      reason: "Synthetic review",
      checklist: { identity: true, lawyerLicense: true, office: true },
    },
  );
  const profileId = crypto.randomUUID();
  expect(await repo.createProfile({ ownerId: owner.userId, now }, profileId)).toBe(true);
  const principal = await createV2AccountingRepository(core).ensurePrincipal({
    ownerId: owner.userId,
    now,
  });
  if (!principal) throw new Error("Synthetic principal required");
  const assetId = crypto.randomUUID(),
    sourceBlobId = crypto.randomUUID(),
    reservationId = crypto.randomUUID();
  const bytes = new Uint8Array([255, 216, 255, 217]);
  const hash = hex(sha256(bytes));
  // Synthetic upstream sanitizer receipt. This suite verifies signed-session
  // review access, not real image sanitization or human qualification evidence.
  const assetEnvelope = await core.encrypt("v2_assets", assetId, owner.userId, 1, {
    id: assetId,
    revision: 1,
    kind: "image",
    status: "ready",
    byteLength: bytes.length,
    originalHash: hash,
    sanitizedDerivative: {
      id: "synthetic_derivative",
      contentHash: hash,
      byteLength: bytes.length,
      format: "jpeg",
    },
    currentJobId: null,
    failure: null,
  });
  db.sqlite
    .query(
      "INSERT INTO v2_assets(id,owner_id,profile_id,purpose,state,encrypted_payload,created_at) VALUES(?,?,?,'profile_photo','reserved',?,?)",
    )
    .run(assetId, owner.userId, profileId, assetEnvelope, now);
  db.sqlite
    .query(
      "INSERT INTO v2_storage_reservations(id,principal_id,operation_id,target_id,entity_id,kind,byte_length,state,created_at) VALUES(?,?,'synthetic_upstream',?,?,'lawyer_asset',?,'stored',?)",
    )
    .run(reservationId, principal, sourceBlobId, assetId, bytes.length, now);
  const blobEnvelope = await core.encrypt("v2_blobs", sourceBlobId, owner.userId, 1, {
    contentHash: hash,
  });
  db.sqlite
    .query(
      "INSERT INTO v2_blobs(id,principal_id,reservation_id,kind,visibility,state,object_key,logical_bytes,cipher_bytes,cipher_hash,key_version,encrypted_payload,created_at) VALUES(?,?,?,'profile_photo_sanitized','staging','stored',?,?,?,?, 'synthetic_fixture_v1',?,?)",
    )
    .run(
      sourceBlobId,
      principal,
      reservationId,
      `staging/${sourceBlobId}`,
      bytes.length,
      bytes.length,
      hash,
      blobEnvelope,
      now,
    );
  db.sqlite
    .query("UPDATE v2_assets SET state='ready',sanitized_blob_id=? WHERE id=?")
    .run(sourceBlobId, assetId);
  const revisionId = crypto.randomUUID();
  expect(
    await repo.saveProfileDraft({ ownerId: owner.userId, now }, profileId, 1, revisionId, {
      ...structuredClone(publicLawyer.content),
      photoAssetId: assetId,
    }),
  ).toBe(true);
  expect(
    await repo.submitProfile({ ownerId: owner.userId, now }, profileId, 2, applicationId),
  ).toBe(true);
  let calls = 0,
    pulled = 0,
    cancelled = 0;
  let beforePull: (() => void) | undefined;
  let wrongReceipt = false,
    tampered = false;
  const openSanitized: OpenSanitizedAsset = async (input) => {
    calls++;
    expect(input).toEqual({
      ownerId: owner.userId,
      profileId,
      assetId,
      assetRevision: 1,
      sourceBlobId,
    });
    let sent = false;
    return {
      byteLength: bytes.length,
      contentHash: wrongReceipt ? "b".repeat(64) : hash,
      body: new ReadableStream<Uint8Array>(
        {
          pull(c) {
            pulled++;
            const callback = beforePull;
            beforePull = undefined;
            callback?.();
            if (sent) c.close();
            else {
              sent = true;
              c.enqueue(tampered ? new Uint8Array(bytes.length) : bytes.slice());
            }
          },
          cancel() {
            cancelled++;
          },
        },
        { highWaterMark: 0 },
      ),
    };
  };
  const app = new Hono<ApiEnvironment>()
    .use("*", async (c, next) => {
      c.set("requestId", "synthetic_request");
      await next();
    })
    .route("/moderation", createModerationApi({ dependencies: async () => ({ openSanitized }) }));
  const path = `/moderation/profile-revisions/${revisionId}/assets/${assetId}/content`;
  const request = (user = moderator, url = path) =>
    app.request(url, { headers: { cookie: user.cookie } }, env);
  return {
    db,
    owner,
    moderator,
    stranger,
    env,
    core,
    repo,
    profileId,
    revisionId,
    assetId,
    sourceBlobId,
    bytes,
    app,
    path,
    request,
    counts: () => ({ calls, pulled, cancelled }),
    beforePull: (fn: () => void) => {
      beforePull = fn;
    },
    wrongReceipt: () => {
      wrongReceipt = true;
    },
    tamper: () => {
      tampered = true;
    },
  };
}
test("submitted profile review streams only an exact linked sanitized receipt to a fresh moderator", async () => {
  const f = await fixture();
  expect((await f.request(f.owner)).status).toBe(403);
  expect((await f.request(f.stranger)).status).toBe(403);
  expect(
    (await f.request(f.moderator, f.path.replace(f.assetId, crypto.randomUUID()))).status,
  ).toBe(404);
  expect(
    (await f.request(f.moderator, f.path.replace(f.revisionId, crypto.randomUUID()))).status,
  ).toBe(404);
  expect(f.counts().calls).toBe(0);
  const response = await f.request();
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("image/jpeg");
  expect(response.headers.get("content-disposition")).toContain("attachment");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(f.bytes);
  f.db.sqlite
    .query("UPDATE session SET oauth_authenticated_at=? WHERE id=?")
    .run(Date.now() - 601000, f.moderator.sessionId);
  expect((await f.request()).status).toBe(403);
  expect(f.counts().calls).toBe(1);
});
test("missing trusted decoder and mismatched receipt fail without consuming sanitized bytes", async () => {
  const f = await fixture();
  const noPort = new Hono<ApiEnvironment>().route("/moderation", createModerationApi());
  expect(
    (await noPort.request(f.path, { headers: { cookie: f.moderator.cookie } }, f.env)).status,
  ).toBe(503);
  f.wrongReceipt();
  expect((await f.request()).status).toBe(409);
  expect(f.counts()).toEqual({ calls: 1, pulled: 0, cancelled: 1 });
});
test("moderator role or submission changes during read stop the stream before disclosure", async () => {
  for (const target of ["role", "submission", "asset"] as const) {
    const f = await fixture();
    const response = await f.request();
    f.beforePull(() => {
      if (target === "role")
        f.db.sqlite
          .query("DELETE FROM v2_role_bindings WHERE owner_id=? AND role='moderator'")
          .run(f.moderator.userId);
      else if (target === "submission")
        f.db.sqlite
          .query("UPDATE v2_profile_revisions SET status='withdrawn' WHERE id=?")
          .run(f.revisionId);
      else
        f.db.sqlite
          .query("INSERT INTO v2_tombstones VALUES('asset',?,?)")
          .run(f.assetId, new Date().toISOString());
    });
    await expect(response.arrayBuffer()).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(f.counts().calls).toBe(1);
  }
});
test("sanitized body hash mismatch rejects the final frame instead of trusting metadata", async () => {
  const f = await fixture();
  f.tamper();
  const response = await f.request();
  await expect(response.arrayBuffer()).rejects.toMatchObject({ code: "ASSET_NOT_READY" });
});
