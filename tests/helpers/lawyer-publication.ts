import { afterEach, expect } from "bun:test";
import { sha256 } from "@noble/hashes/sha2.js";
import { createCaseDataCipher } from "../../src/server/crypto";
import { createV2AccountingRepository } from "../../src/server/db/v2-accounting";
import { createV2Core } from "../../src/server/db/v2-core";
import { createV2LawyersRepository } from "../../src/server/db/v2-lawyers";
import { hex } from "../../src/server/modules/files/binary";
import { createLawyerPublicationService } from "../../src/server/modules/lawyers/publication";
import { createModerationService } from "../../src/server/modules/moderation/service";
import { application, publicLawyer } from "../fixtures/contracts/v2";
import { createTestDatabase } from "./d1";
import { seedTestSession } from "./session";

const databases: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
function stream(bytes: Uint8Array) {
  let sent = false;
  return new ReadableStream<Uint8Array>(
    {
      pull(c) {
        if (sent) c.close();
        else {
          sent = true;
          c.enqueue(bytes.slice());
        }
      },
    },
    { highWaterMark: 0 },
  );
}
function fixed(length: number) {
  let size = 0;
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(b, c) {
      size += b.length;
      if (size > length) throw new Error("Invalid synthetic fixed length");
      c.enqueue(b);
    },
    flush() {
      if (size !== length) throw new Error("Invalid synthetic fixed length");
    },
  });
}
export async function publicationFixture() {
  const db = await createTestDatabase();
  databases.push(db);
  const owner = await seedTestSession(db, { consent: true });
  const moderator = await seedTestSession(db, { consent: true, oauthAuthenticatedAt: Date.now() });
  const env = { ...owner.env, CASE_DATA_KEY_V1: btoa("k".repeat(32)).replace(/=+$/, "") };
  const core = createV2Core(db.binding, await createCaseDataCipher(env));
  const repository = createV2LawyersRepository(core);
  const now = new Date().toISOString();
  db.sqlite
    .query("INSERT INTO v2_role_bindings(owner_id,role,granted_at) VALUES(?,'moderator',?)")
    .run(moderator.userId, now);
  const appId = crypto.randomUUID();
  if (application.status === "draft") throw new Error("Synthetic submitted source required");
  const app = {
    schemaVersion: "2",
    id: appId,
    applicantId: owner.userId,
    revision: 1,
    createdAt: now,
    status: "submitted",
    submittedAt: now,
    content: application.content,
  };
  const appEnvelope = await core.encrypt("v2_applications", appId, owner.userId, 1, app);
  db.sqlite
    .query(
      "INSERT INTO v2_applications(id,owner_id,revision,status,encrypted_payload,submitted_at,created_at) VALUES(?,?,1,'submitted',?,?,?)",
    )
    .run(appId, owner.userId, appEnvelope, now, now);
  await createModerationService(core).decideApplication(
    moderator.userId,
    moderator.sessionId,
    appId,
    {
      expectedRevision: 1,
      decision: "approved",
      reason: "Synthetic manual fixture",
      checklist: { identity: true, lawyerLicense: true, office: true },
    },
  );
  const profileId = crypto.randomUUID();
  expect(await repository.createProfile({ ownerId: owner.userId, now }, profileId)).toBe(true);
  const principal = await createV2AccountingRepository(core).ensurePrincipal({
    ownerId: owner.userId,
    now,
  });
  if (!principal) throw new Error("Synthetic principal required");
  const assetId = crypto.randomUUID();
  const sourceBlobId = crypto.randomUUID();
  const bytes = new Uint8Array([255, 216, 255, 217]);
  const hash = hex(sha256(bytes));
  const reservationId = crypto.randomUUID();
  // Synthetic #59 upstream receipt only. Actual sanitization stays separately
  // verified; all ciphertext metadata below uses real AES and generated SQLite.
  const asset = {
    id: assetId,
    revision: 1,
    kind: "image",
    status: "ready",
    byteLength: bytes.length,
    originalHash: hash,
    sanitizedDerivative: {
      id: sourceBlobId,
      contentHash: hash,
      byteLength: bytes.length,
      format: "jpeg",
    },
    currentJobId: null,
    failure: null,
  };
  const assetEnvelope = await core.encrypt("v2_assets", assetId, owner.userId, 1, asset);
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
  const sourceEnvelope = await core.encrypt("v2_blobs", sourceBlobId, owner.userId, 1, {
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
      sourceEnvelope,
      now,
    );
  db.sqlite
    .query("UPDATE v2_assets SET state='ready',sanitized_blob_id=? WHERE id=?")
    .run(sourceBlobId, assetId);
  db.sqlite
    .query("UPDATE v2_storage_usage SET stored_bytes=? WHERE principal_id=?")
    .run(bytes.length, principal);
  const content = { ...structuredClone(publicLawyer.content), photoAssetId: assetId };
  const revisionId = crypto.randomUUID();
  expect(
    await repository.saveProfileDraft(
      { ownerId: owner.userId, now },
      profileId,
      1,
      revisionId,
      content,
    ),
  ).toBe(true);
  expect(await repository.submitProfile({ ownerId: owner.userId, now }, profileId, 2, appId)).toBe(
    true,
  );
  await createModerationService(core).decideProfile(
    moderator.userId,
    moderator.sessionId,
    revisionId,
    {
      expectedRevision: 2,
      decision: "approved",
      reason: "Synthetic profile review",
      checklist: {
        identityMatches: true,
        officeMatches: true,
        personalDataReviewed: true,
        advertisingReviewed: true,
        assetsSanitized: true,
      },
    },
  );
  const objects = new Map<string, Uint8Array>();
  let count = 0;
  let bad = false;
  let afterPut: (() => Promise<void>) | undefined;
  let beforeStore: (() => Promise<void>) | undefined;
  let rejectedPut = false;
  let wrongHash = false;
  const bucket = {
    async put(key: string, body: ReadableStream<Uint8Array>) {
      count++;
      if (rejectedPut) throw new Error("Synthetic R2 rejected before consumption");
      const data = new Uint8Array(await new Response(body).arrayBuffer());
      await beforeStore?.();
      objects.set(key, data);
      await afterPut?.();
      return { key, size: bad ? data.length + 1 : data.length };
    },
    async head(key: string) {
      const data = objects.get(key);
      return data ? { key, size: data.length } : null;
    },
    async get(key: string) {
      const data = objects.get(key);
      return data ? { key, size: data.length, body: stream(data) } : null;
    },
    async delete(key: string) {
      objects.delete(key);
    },
  } as unknown as Pick<R2Bucket, "get" | "put" | "head" | "delete">;
  const deps = {
    publicBucket: bucket,
    fixedLengthStream: fixed,
    environment: "preview" as const,
    testOnlyUnmeteredStorage: true as const,
    openSanitized: async (input: {
      ownerId: string;
      profileId: string;
      assetId: string;
      assetRevision: number;
      sourceBlobId: string;
    }) => {
      expect(input).toEqual({
        ownerId: owner.userId,
        profileId,
        assetId,
        assetRevision: 1,
        sourceBlobId,
      });
      return {
        byteLength: bytes.length,
        contentHash: wrongHash ? "b".repeat(64) : hash,
        body: stream(bytes),
      };
    },
  };
  return {
    db,
    core,
    repository,
    owner,
    moderator,
    profileId,
    assetId,
    sourceBlobId,
    revisionId,
    bytes,
    objects,
    deps,
    service: createLawyerPublicationService(core, deps),
    count: () => count,
    setBad: () => {
      bad = true;
    },
    afterPut: (callback: () => Promise<void>) => {
      afterPut = callback;
    },
    beforeStore: (callback: () => Promise<void>) => {
      beforeStore = callback;
    },
    rejectPut: () => {
      rejectedPut = true;
    },
    wrongHash: () => {
      wrongHash = true;
    },
  };
}
