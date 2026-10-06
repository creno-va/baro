import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type {
  V2LawyerApplication,
  V2ModerationReport,
  V2PortfolioAsset,
  V2ProfileContent,
  V2ProfileRevision,
  V2VerificationAsset,
} from "../src/contracts/v2";
import {
  createEnvelopeCipher,
  type EncryptionContext,
  type EnvelopeCipher,
} from "../src/server/crypto";
import { createV2Core } from "../src/server/db/v2-core";
import { createV2LawyersRepository } from "../src/server/db/v2-lawyers";
import { createV2StorageRepository } from "../src/server/db/v2-storage";
import { application, publicLawyer } from "./fixtures/contracts/v2";
import { createTestDatabase } from "./helpers/d1";

// Real AES-GCM and generated migrations; every database is SQLite :memory:.
// SQL seeds establish historical/adversarial states, while assertions call the
// exported repository methods. No identity cipher or migration repair is used.
const now = "2026-10-06T00:00:00.000Z";
const epoch = Date.parse(now);
const owner = { ownerId: "owner_synthetic", now };
const reviewer = { ownerId: "reviewer_synthetic", now };
const stranger = { ownerId: "stranger_synthetic", now };
const profileId = "lawyer_1";
const appId = "application_synthetic";
const sessionId = "review_session_synthetic";
const hash = publicLawyer.assets[0]?.contentHash ?? "b".repeat(64);
const otherHash = "c".repeat(64);
const admission = {
  operationId: "publication_operation_synthetic",
  key: "synthetic_publication_key_0001",
  requestHash: hash,
};
const approvedApplication = {
  expectedRevision: 1,
  decision: "approved" as const,
  reason: "Synthetic manual review only",
  checklist: { identity: true as const, lawyerLicense: true as const, office: true as const },
};
const approvedProfile = {
  expectedRevision: 2,
  decision: "approved" as const,
  reason: "Synthetic publication review only",
  checklist: {
    identityMatches: true as const,
    officeMatches: true as const,
    personalDataReviewed: true as const,
    advertisingReviewed: true as const,
    assetsSanitized: true as const,
  },
};

type Hook = (context: EncryptionContext) => void;
let database: Awaited<ReturnType<typeof createTestDatabase>>;
let cipher: EnvelopeCipher;
let core: ReturnType<typeof createV2Core>;
let repository: ReturnType<typeof createV2LawyersRepository>;
let storage: ReturnType<typeof createV2StorageRepository>;
let beforeEncrypt: Hook | undefined;
let beforeDecrypt: Hook | undefined;
let afterDecrypt: Hook | undefined;

beforeEach(async () => {
  database = await createTestDatabase();
  beforeEncrypt = undefined;
  beforeDecrypt = undefined;
  afterDecrypt = undefined;
  const syntheticKey = btoa(String.fromCharCode(...new Uint8Array(32).fill(17)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  cipher = await createEnvelopeCipher({
    activeKeyId: "synthetic",
    keys: { synthetic: syntheticKey },
  });
  const observedCipher: EnvelopeCipher = {
    async encrypt(value, context) {
      beforeEncrypt?.(context);
      return cipher.encrypt(value, context);
    },
    async decrypt(value, context) {
      beforeDecrypt?.(context);
      const plaintext = await cipher.decrypt(value, context);
      afterDecrypt?.(context);
      return plaintext;
    },
  };
  core = createV2Core(database.binding, observedCipher);
  repository = createV2LawyersRepository(core);
  storage = createV2StorageRepository(core);
  for (const actor of [owner, reviewer, stranger]) {
    database.sqlite
      .query("INSERT INTO user(id,name,email,created_at,updated_at) VALUES(?,?,?,?,?)")
      .run(actor.ownerId, "Synthetic account", `${actor.ownerId}@invalid.test`, epoch, epoch);
    database.sqlite
      .query("INSERT INTO v2_billing_principals(id,owner_id,created_at) VALUES(?,?,?)")
      .run(`principal_${actor.ownerId}`, actor.ownerId, now);
    database.sqlite
      .query("INSERT INTO v2_storage_usage(principal_id) VALUES(?)")
      .run(`principal_${actor.ownerId}`);
  }
  database.sqlite
    .query("INSERT INTO v2_profiles(id,owner_id,revision,created_at,updated_at) VALUES(?,?,?,?,?)")
    .run(profileId, owner.ownerId, 2, now, now);
  database.sqlite
    .query("INSERT INTO v2_role_bindings(owner_id,role,granted_at) VALUES(?,?,?)")
    .run(reviewer.ownerId, "moderator", now);
  database.sqlite
    .query(
      "INSERT INTO session(id,expires_at,token,created_at,updated_at,user_id,oauth_authenticated_at) VALUES(?,?,?,?,?,?,?)",
    )
    .run(
      sessionId,
      epoch + 600_000,
      "synthetic_session_token",
      epoch,
      epoch,
      reviewer.ownerId,
      epoch,
    );
});

afterEach(() => {
  if (database) {
    expect(database.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
    database.close();
  }
});

async function seedApplication(status: "submitted" | "approved" = "approved") {
  if (application.status === "draft") throw new Error("Expected complete synthetic fixture");
  const value: V2LawyerApplication = {
    schemaVersion: "2",
    id: appId,
    applicantId: owner.ownerId,
    revision: 1,
    createdAt: now,
    status: "submitted",
    submittedAt: now,
    content: structuredClone(application.content),
  };
  const envelope = await core.encrypt("v2_applications", appId, owner.ownerId, 1, value);
  database.sqlite
    .query(
      "INSERT INTO v2_applications(id,owner_id,revision,status,encrypted_payload,submitted_at,decided_at,reviewer_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
    )
    .run(
      appId,
      owner.ownerId,
      1,
      status,
      envelope,
      now,
      status === "approved" ? now : null,
      status === "approved" ? reviewer.ownerId : null,
      now,
    );
  if (status === "approved") {
    await seedDecision("application", appId, 1, approvedApplication);
    database.sqlite
      .query("INSERT INTO v2_role_bindings(owner_id,role,granted_at) VALUES(?,?,?)")
      .run(owner.ownerId, "verified_lawyer", now);
  }
}

async function seedDecision(
  kind: "application" | "profile",
  id: string,
  revision: number,
  decision: { reason: string; checklist?: Record<string, boolean> },
) {
  const decisionId = `decision_${kind}_${revision}`;
  const envelope = await core.encrypt(
    "v2_moderation_decisions",
    decisionId,
    owner.ownerId,
    revision,
    { reason: decision.reason, ...(decision.checklist ? { checklist: decision.checklist } : {}) },
  );
  database.sqlite
    .query(
      "INSERT INTO v2_moderation_decisions(id,target_kind,target_id,target_revision,reviewer_id,owner_id,decision,encrypted_payload,oauth_authenticated_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      decisionId,
      kind,
      id,
      revision,
      reviewer.ownerId,
      owner.ownerId,
      "approve",
      envelope,
      now,
      now,
    );
}

async function seedRevision(
  status: "draft" | "submitted" | "approved" = "approved",
  revision = 2,
  content: V2ProfileContent = structuredClone(publicLawyer.content),
) {
  const id = `revision_${revision}`;
  const value: V2ProfileRevision =
    status === "draft"
      ? { schemaVersion: "2", id, profileId, revision, createdAt: now, status, content }
      : {
          schemaVersion: "2",
          id,
          profileId,
          revision,
          createdAt: now,
          status: "submitted",
          content,
          submittedAt: now,
        };
  const envelope = await core.encrypt("v2_profile_revisions", id, owner.ownerId, revision, value);
  database.sqlite
    .query(
      "INSERT INTO v2_profile_revisions(id,profile_id,revision,status,application_id,encrypted_payload,submitted_at,decided_at,reviewer_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      id,
      profileId,
      revision,
      status,
      status === "draft" ? null : appId,
      envelope,
      status === "draft" ? null : now,
      status === "approved" ? now : null,
      status === "approved" ? reviewer.ownerId : null,
      now,
    );
  if (status === "approved") await seedDecision("profile", id, revision, approvedProfile);
  return id;
}

async function seedBlob(input: {
  id: string;
  assetId?: string;
  ownerId?: string;
  kind?: string;
  visibility?: "private" | "staging" | "public";
  contentHash?: string;
  bytes?: number;
  sourceBlobId?: string;
  sourceAssetRevision?: number;
  approvedRevisionId?: string;
}) {
  const blobOwner = input.ownerId ?? owner.ownerId;
  const reservationId = `reservation_${input.id}`;
  database.sqlite
    .query(
      "INSERT INTO v2_storage_reservations(id,principal_id,operation_id,target_id,entity_id,kind,byte_length,state,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
    )
    .run(
      reservationId,
      `principal_${blobOwner}`,
      "synthetic_blob_operation",
      input.id,
      input.assetId ?? "photo_1",
      "lawyer_asset",
      input.bytes ?? 100,
      "stored",
      now,
    );
  const metadata = await core.encrypt("v2_blobs", input.id, blobOwner, 1, {
    contentHash: input.contentHash ?? hash,
  });
  database.sqlite
    .query(
      "INSERT INTO v2_blobs(id,principal_id,reservation_id,kind,visibility,state,object_key,logical_bytes,cipher_bytes,cipher_hash,key_version,encrypted_payload,source_blob_id,source_asset_revision,approved_revision_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      input.id,
      `principal_${blobOwner}`,
      reservationId,
      input.kind ?? "profile_photo_sanitized",
      input.visibility ?? "staging",
      "stored",
      `synthetic/${input.id}`,
      input.bytes ?? 100,
      116,
      hash,
      input.visibility === "public" ? null : "synthetic",
      metadata,
      input.visibility === "public" ? (input.sourceBlobId ?? "sanitized_photo_1") : null,
      input.visibility === "public" ? (input.sourceAssetRevision ?? 2) : null,
      input.visibility === "public" ? (input.approvedRevisionId ?? "revision_2") : null,
      now,
    );
  database.sqlite
    .query("UPDATE v2_storage_usage SET stored_bytes=stored_bytes+? WHERE principal_id=?")
    .run(input.bytes ?? 100, `principal_${blobOwner}`);
  return input.id;
}

async function seedAsset(
  input: {
    id?: string;
    purpose?: string;
    kind?: "image" | "pdf";
    state?: "reserved" | "ready";
    revision?: number;
  } = {},
) {
  const id = input.id ?? "photo_1";
  const purpose = input.purpose ?? "profile_photo";
  const ready = (input.state ?? "ready") === "ready";
  const kind = input.kind ?? "image";
  const revision = input.revision ?? (ready ? 2 : 1);
  const sanitizedId = `sanitized_${id}`;
  const asset: V2PortfolioAsset = {
    id,
    revision,
    kind,
    status: ready ? "ready" : "reserved",
    byteLength: 100,
    originalHash: ready ? hash : null,
    sanitizedDerivative: ready
      ? {
          id: sanitizedId,
          contentHash: hash,
          byteLength: 100,
          format: kind === "pdf" ? "pdf" : "png",
        }
      : null,
    currentJobId: null,
    failure: null,
  };
  if (ready)
    await seedBlob({
      id: sanitizedId,
      assetId: id,
      kind: purpose === "profile_photo" ? "profile_photo_sanitized" : "portfolio_sanitized",
    });
  const value = ready
    ? asset
    : {
        request: {
          name: "Synthetic upload",
          byteLength: 100,
          mediaType: kind === "pdf" ? "application/pdf" : "image/png",
          purpose,
        },
      };
  const envelope = await core.encrypt("v2_assets", id, owner.ownerId, revision, value);
  database.sqlite
    .query(
      "INSERT INTO v2_assets(id,owner_id,profile_id,revision,purpose,state,sanitized_blob_id,encrypted_payload,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
    )
    .run(
      id,
      owner.ownerId,
      profileId,
      revision,
      purpose,
      ready ? "ready" : "reserved",
      ready ? sanitizedId : null,
      envelope,
      now,
    );
  return asset;
}

async function seedPublication() {
  await seedApplication();
  await seedAsset();
  await seedRevision();
  database.sqlite
    .query(
      "INSERT INTO v2_profile_revision_assets(revision_id,asset_id,asset_revision,ordinal) VALUES(?,?,?,?)",
    )
    .run("revision_2", "photo_1", 2, 0);
}

async function seedVerification(id = "verification_synthetic", linked = true) {
  const value: V2VerificationAsset = {
    id,
    purpose: "lawyer_license",
    status: "ready",
    byteLength: 100,
    contentHash: hash,
  };
  const originalId = await seedBlob({
    id: `original_${id}`,
    assetId: id,
    kind: "verification",
    visibility: "private",
  });
  const envelope = await core.encrypt("v2_assets", id, owner.ownerId, 2, value);
  database.sqlite
    .query(
      "INSERT INTO v2_assets(id,owner_id,profile_id,revision,purpose,state,original_blob_id,encrypted_payload,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
    )
    .run(id, owner.ownerId, profileId, 2, value.purpose, "ready", originalId, envelope, now);
  if (linked)
    database.sqlite
      .query("INSERT INTO v2_application_assets(application_id,asset_id) VALUES(?,?)")
      .run(appId, id);
  return value;
}

function storePublicSnapshot() {
  database.sqlite
    .query("UPDATE v2_profiles SET approved_revision_id=? WHERE id=?")
    .run("revision_2", profileId);
  database.sqlite
    .query(
      "INSERT INTO v2_public_profiles(profile_id,revision_id,approved_revision,content_json,published_at) VALUES(?,?,?,?,?)",
    )
    .run(profileId, "revision_2", 2, JSON.stringify(publicLawyer), now);
}

function report(id = "report_synthetic"): V2ModerationReport {
  return {
    id,
    profileId,
    profileRevision: 2,
    kind: "other",
    status: "open",
    resolution: null,
    revision: 1,
    createdAt: now,
  };
}

async function expectBlocked(operation: Promise<unknown>, checkedBatch = false) {
  // A count CHECK can intentionally abort an atomic batch. Only callers with
  // explicit rollback assertions and a passing publication control allow it.
  let result: unknown;
  try {
    result = await operation;
  } catch (error) {
    if (checkedBatch) {
      expect(["REPOSITORY_INPUT_INVALID", "DB_OPERATION_FAILED"]).toContain(
        (error as { code: string }).code,
      );
    } else expect(error).toMatchObject({ code: "REPOSITORY_INPUT_INVALID" });
    return;
  }
  expect(result).toBe(false);
}

describe("v2 lawyer asset ownership and immutable revisions", () => {
  test("valid owned sanitized upload stores matching DTO/AAD revision with real encryption", async () => {
    await seedAsset({ state: "reserved" });
    await seedBlob({ id: "original_photo", kind: "profile_photo_original", visibility: "private" });
    await seedBlob({ id: "sanitized_photo" });
    const value: V2PortfolioAsset = {
      id: "photo_1",
      revision: 2,
      kind: "image",
      status: "ready",
      byteLength: 100,
      originalHash: hash,
      sanitizedDerivative: {
        id: "sanitized_photo",
        contentHash: hash,
        byteLength: 100,
        format: "png",
      },
      currentJobId: null,
      failure: null,
    };
    expect(
      await repository.saveAsset(owner, value.id, 1, value, "original_photo", "sanitized_photo"),
    ).toBe(true);
    const row = database.sqlite
      .query("SELECT revision,encrypted_payload FROM v2_assets WHERE id=?")
      .get(value.id) as { revision: number; encrypted_payload: string };
    expect(row.revision).toBe(2);
    expect(row.encrypted_payload).not.toContain("originalHash");
    expect(
      JSON.parse(
        await cipher.decrypt(row.encrypted_payload, {
          table: "v2_assets",
          column: "encrypted_payload",
          rowId: value.id,
          userId: owner.ownerId,
          revision: 2,
        }),
      ),
    ).toEqual(value);
    await expect(
      cipher.decrypt(row.encrypted_payload, {
        table: "v2_assets",
        column: "encrypted_payload",
        rowId: value.id,
        userId: stranger.ownerId,
        revision: 2,
      }),
    ).rejects.toMatchObject({ code: "CRYPTO_DECRYPT_FAILED" });
  });

  test.each([
    "revision",
    "purpose",
    "kind",
    "other_asset",
    "other_owner",
    "original_hash",
    "derivative_hash",
  ])("rejects %s mismatch without advancing the reserved asset", async (defect) => {
    const verification = defect === "purpose";
    await seedAsset({ state: "reserved", purpose: verification ? "identity" : "profile_photo" });
    await seedBlob({
      id: "original_photo",
      kind: verification ? "verification" : "profile_photo_original",
      visibility: "private",
      assetId: defect === "other_asset" ? "another_asset" : "photo_1",
      ownerId: defect === "other_owner" ? stranger.ownerId : owner.ownerId,
    });
    if (!verification) await seedBlob({ id: "sanitized_photo" });
    const value = verification
      ? {
          id: "photo_1",
          purpose: "lawyer_license",
          status: "ready",
          byteLength: 100,
          contentHash: hash,
        }
      : {
          id: "photo_1",
          revision: defect === "revision" ? 999 : 2,
          kind: defect === "kind" ? "pdf" : "image",
          status: "ready",
          byteLength: 100,
          originalHash: defect === "original_hash" ? otherHash : hash,
          sanitizedDerivative: {
            id: "sanitized_photo",
            contentHash: defect === "derivative_hash" ? otherHash : hash,
            byteLength: 100,
            format: defect === "kind" ? "pdf" : "png",
          },
          currentJobId: null,
          failure: null,
        };
    await expectBlocked(
      repository.saveAsset(
        owner,
        "photo_1",
        1,
        value,
        "original_photo",
        verification ? null : "sanitized_photo",
      ),
    );
    expect(
      database.sqlite.query("SELECT revision,state FROM v2_assets WHERE id=?").get("photo_1"),
    ).toEqual({ revision: 1, state: "reserved" });
  });

  test("profile photo and portfolio references must agree with actual ready asset kinds", async () => {
    await seedApplication();
    await seedAsset({ purpose: "profile_photo", kind: "pdf" });
    await seedRevision("draft");
    await expectBlocked(repository.submitProfile(owner, profileId, 2, appId));
    expect(
      database.sqlite.query("SELECT status FROM v2_profile_revisions WHERE id=?").get("revision_2"),
    ).toEqual({ status: "draft" });
    expect(
      database.sqlite.query("SELECT count(*) AS count FROM v2_profile_revision_assets").get(),
    ).toEqual({ count: 0 });
  });

  test("an image portfolio reference cannot submit a ready PDF asset", async () => {
    await seedApplication();
    await seedAsset();
    await seedAsset({ id: "portfolio_pdf", purpose: "portfolio", kind: "pdf" });
    const content = structuredClone(publicLawyer.content);
    content.portfolio = [
      {
        id: "portfolio_item",
        kind: "image",
        title: "Synthetic image claim",
        caption: null,
        assetId: "portfolio_pdf",
      },
    ];
    await seedRevision("draft", 2, content);
    await expectBlocked(repository.submitProfile(owner, profileId, 2, appId));
    expect(
      database.sqlite.query("SELECT status FROM v2_profile_revisions WHERE id=?").get("revision_2"),
    ).toEqual({ status: "draft" });
  });

  test("asset revision changing while the submitted snapshot encrypts aborts all references", async () => {
    await seedApplication();
    await seedAsset();
    await seedRevision("draft");
    beforeEncrypt = (context) => {
      if (context.table !== "v2_profile_revisions") return;
      beforeEncrypt = undefined;
      database.sqlite.query("UPDATE v2_assets SET revision=3 WHERE id=?").run("photo_1");
    };
    await expectBlocked(repository.submitProfile(owner, profileId, 2, appId), true);
    expect(
      database.sqlite.query("SELECT status FROM v2_profile_revisions WHERE id=?").get("revision_2"),
    ).toEqual({ status: "draft" });
    expect(
      database.sqlite.query("SELECT count(*) AS count FROM v2_profile_revision_assets").get(),
    ).toEqual({ count: 0 });
  });

  test("valid image profile can submit only once against the immutable draft revision", async () => {
    await seedApplication();
    await seedAsset();
    await seedRevision("draft");
    expect(await repository.submitProfile(owner, profileId, 2, appId)).toBe(true);
    expect(await repository.submitProfile(owner, profileId, 2, appId)).toBe(false);
    expect((await repository.readProfileRevision(owner, profileId, 2))?.status).toBe("submitted");
    expect(await repository.readProfileRevision(stranger, profileId, 2)).toBeNull();
  });
});

describe("v2 moderator authorization and CAS", () => {
  test("authorized recent OAuth reviewer can decide once and grant verified role", async () => {
    await seedApplication("submitted");
    expect(
      await repository.decideApplication(reviewer, sessionId, appId, approvedApplication),
    ).toBe(true);
    expect((await repository.readApplication(owner, appId))?.status).toBe("approved");
    expect(await repository.roles(owner)).toContain("verified_lawyer");
    await expectBlocked(
      repository.decideApplication(reviewer, sessionId, appId, approvedApplication),
    );
    expect(
      database.sqlite.query("SELECT count(*) AS count FROM v2_moderation_decisions").get(),
    ).toEqual({ count: 1 });
  });

  test.each(["role", "expired_session", "old_oauth", "future_oauth", "target_withdrawn"])(
    "rechecks %s atomically after encryption yields",
    async (boundary) => {
      await seedApplication("submitted");
      beforeEncrypt = (context) => {
        if (context.table !== "v2_moderation_decisions") return;
        beforeEncrypt = undefined;
        if (boundary === "role")
          database.sqlite
            .query("DELETE FROM v2_role_bindings WHERE owner_id=?")
            .run(reviewer.ownerId);
        if (boundary === "expired_session")
          database.sqlite.query("UPDATE session SET expires_at=? WHERE id=?").run(epoch, sessionId);
        if (boundary === "old_oauth")
          database.sqlite
            .query("UPDATE session SET oauth_authenticated_at=? WHERE id=?")
            .run(epoch - 600_001, sessionId);
        if (boundary === "future_oauth")
          database.sqlite
            .query("UPDATE session SET oauth_authenticated_at=? WHERE id=?")
            .run(epoch + 1, sessionId);
        if (boundary === "target_withdrawn")
          database.sqlite
            .query("UPDATE v2_applications SET status='withdrawn',withdrawn_at=? WHERE id=?")
            .run(now, appId);
      };
      expect(
        await repository.decideApplication(reviewer, sessionId, appId, approvedApplication),
      ).toBe(false);
      expect(
        database.sqlite.query("SELECT count(*) AS count FROM v2_moderation_decisions").get(),
      ).toEqual({ count: 0 });
      expect(await repository.roles(owner)).not.toContain("verified_lawyer");
    },
  );

  test("role alone never permits self-review or another user's session", async () => {
    await seedApplication("submitted");
    database.sqlite
      .query("INSERT INTO v2_role_bindings(owner_id,role,granted_at) VALUES(?,?,?)")
      .run(owner.ownerId, "moderator", now);
    database.sqlite
      .query(
        "INSERT INTO session(id,expires_at,token,created_at,updated_at,user_id,oauth_authenticated_at) VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        "owner_session",
        epoch + 600_000,
        "owner_synthetic_token",
        epoch,
        epoch,
        owner.ownerId,
        epoch,
      );
    await expectBlocked(
      repository.decideApplication(owner, "owner_session", appId, approvedApplication),
    );
    await expectBlocked(
      repository.decideApplication(reviewer, "owner_session", appId, approvedApplication),
    );
    expect(
      database.sqlite.query("SELECT count(*) AS count FROM v2_moderation_decisions").get(),
    ).toEqual({ count: 0 });
  });

  test("stale expected application revision cannot create a decision", async () => {
    await seedApplication("submitted");
    await expectBlocked(
      repository.decideApplication(reviewer, sessionId, appId, {
        ...approvedApplication,
        expectedRevision: 2,
      }),
    );
    expect(
      database.sqlite.query("SELECT count(*) AS count FROM v2_moderation_decisions").get(),
    ).toEqual({ count: 0 });
  });

  test("deleted reviewer account does not destroy immutable approval history", async () => {
    await seedApplication();
    await seedRevision();
    database.sqlite.query("DELETE FROM user WHERE id=?").run(reviewer.ownerId);
    expect(await repository.readApplication(owner, appId)).toMatchObject({
      status: "approved",
      reviewerId: reviewer.ownerId,
    });
    expect(await repository.readProfileRevision(owner, profileId, 2)).toMatchObject({
      status: "approved",
      reviewerId: reviewer.ownerId,
    });
  });
});

describe("v2 public profile qualification and asset provenance", () => {
  test("owner withdrawal removes qualification and closes public visibility with CAS", async () => {
    await seedPublication();
    storePublicSnapshot();
    expect(await repository.withdrawApplication(stranger, appId, 1)).toBe(false);
    expect(await repository.withdrawApplication(owner, appId, 2)).toBe(false);
    expect(await repository.withdrawApplication(owner, appId, 1)).toBe(true);
    expect(await repository.withdrawApplication(owner, appId, 1)).toBe(false);
    expect(await repository.roles(owner)).not.toContain("verified_lawyer");
    expect(await repository.readApplication(owner, appId)).toMatchObject({ status: "withdrawn" });
    expect(await repository.publicProfile(profileId)).toBeNull();
  });

  test("moderator revocation needs recent OAuth, writes one audit and blocks publication", async () => {
    await seedPublication();
    storePublicSnapshot();
    expect(await repository.revokeVerification(stranger, sessionId, owner.ownerId, appId, 1)).toBe(
      false,
    );
    database.sqlite
      .query("UPDATE session SET oauth_authenticated_at=? WHERE id=?")
      .run(epoch - 600_001, sessionId);
    expect(await repository.revokeVerification(reviewer, sessionId, owner.ownerId, appId, 1)).toBe(
      false,
    );
    database.sqlite
      .query("UPDATE session SET oauth_authenticated_at=? WHERE id=?")
      .run(epoch, sessionId);
    expect(await repository.revokeVerification(reviewer, sessionId, owner.ownerId, appId, 1)).toBe(
      true,
    );
    expect(await repository.revokeVerification(reviewer, sessionId, owner.ownerId, appId, 1)).toBe(
      false,
    );
    expect(await repository.roles(owner)).not.toContain("verified_lawyer");
    expect(await repository.publicProfile(profileId)).toBeNull();
    expect(database.sqlite.query("SELECT role,action FROM v2_role_audit").all()).toEqual([
      { role: "verified_lawyer", action: "revoke" },
    ]);
  });

  test("public-copy registration reserves owned storage and binds approved source before publication", async () => {
    await seedPublication();
    const reservationId = "new_public_copy_reservation";
    expect(
      await storage.reserveAssetCopy(owner, {
        id: reservationId,
        assetId: "photo_1",
        profileId,
        assetRevision: 2,
        byteLength: 100,
        artifactId: "new_public_copy",
      }),
    ).toBe(true);
    const copy = {
      id: "new_public_copy",
      reservationId,
      kind: "public_copy" as const,
      visibility: "public" as const,
      logicalBytes: 100,
      cipherBytes: 100,
      cipherHash: hash,
      contentHash: hash,
      keyVersion: null,
    };
    const provenance = {
      assetId: "photo_1",
      assetRevision: 2,
      approvedRevisionId: "revision_2",
      sourceBlobId: "sanitized_photo_1",
    };
    expect(await storage.registerApprovedPublicCopy(owner, copy, provenance)).toBe(true);
    expect(await repository.publishApproved(owner, publicLawyer, { photo_1: copy.id })).toBe(true);
    expect(await repository.publicProfile(profileId)).toEqual(publicLawyer);
    expect(
      database.sqlite
        .query(
          "SELECT source_blob_id,source_asset_revision,approved_revision_id FROM v2_blobs WHERE id=?",
        )
        .get(copy.id),
    ).toEqual({
      source_blob_id: provenance.sourceBlobId,
      source_asset_revision: 2,
      approved_revision_id: provenance.approvedRevisionId,
    });
  });

  test.each(["wrong_hash", "stale_revision", "pending_approval", "foreign_owner", "revoked"])(
    "public-copy registration blocks %s before any public blob exists",
    async (boundary) => {
      await seedPublication();
      const reservationId = "new_public_copy_reservation";
      expect(
        await storage.reserveAssetCopy(owner, {
          id: reservationId,
          assetId: "photo_1",
          profileId,
          assetRevision: 2,
          byteLength: 100,
          artifactId: "new_public_copy",
        }),
      ).toBe(true);
      if (boundary === "pending_approval") {
        await seedRevision("submitted", 3);
      }
      if (boundary === "revoked")
        expect(await repository.withdrawApplication(owner, appId, 1)).toBe(true);
      const copy = {
        id: "new_public_copy",
        reservationId,
        kind: "public_copy" as const,
        visibility: "public" as const,
        logicalBytes: 100,
        cipherBytes: 100,
        cipherHash: hash,
        contentHash: boundary === "wrong_hash" ? otherHash : hash,
        keyVersion: null,
      };
      const actor = boundary === "foreign_owner" ? stranger : owner;
      let privateDecryptions = 0;
      if (boundary === "foreign_owner")
        beforeDecrypt = () => {
          privateDecryptions += 1;
        };
      // Owner authorization must precede decrypting the private source metadata.
      await expectBlocked(
        storage.registerApprovedPublicCopy(actor, copy, {
          assetId: "photo_1",
          assetRevision: boundary === "stale_revision" ? 3 : 2,
          approvedRevisionId: boundary === "pending_approval" ? "revision_3" : "revision_2",
          sourceBlobId: "sanitized_photo_1",
        }),
      );
      if (boundary === "foreign_owner") expect(privateDecryptions).toBe(0);
      expect(
        database.sqlite
          .query("SELECT count(*) AS count FROM v2_blobs WHERE visibility='public'")
          .get(),
      ).toEqual({ count: 0 });
    },
  );

  test("matching owned public copy publishes one approved profile with real encrypted hash metadata", async () => {
    await seedPublication();
    await seedBlob({ id: "public_photo", kind: "public_copy", visibility: "public" });
    expect(await repository.publishApproved(owner, publicLawyer, { photo_1: "public_photo" })).toBe(
      true,
    );
    expect(await repository.publicProfile(profileId)).toEqual(publicLawyer);
    expect(database.sqlite.query("SELECT count(*) AS count FROM v2_public_assets").get()).toEqual({
      count: 1,
    });
  });

  test("previous approved profile remains public while next revision is pending", async () => {
    await seedPublication();
    storePublicSnapshot();
    database.sqlite.query("UPDATE v2_profiles SET revision=3 WHERE id=?").run(profileId);
    const content = {
      ...structuredClone(publicLawyer.content),
      introduction: "Synthetic pending text must remain private",
    };
    await seedRevision("submitted", 3, content);
    expect(await repository.publicProfile(profileId)).toEqual(publicLawyer);
  });

  test("sanitized source deleted during public metadata decryption cannot publish a partial snapshot", async () => {
    await seedPublication();
    await seedBlob({ id: "public_photo", kind: "public_copy", visibility: "public" });
    afterDecrypt = (context) => {
      if (context.table !== "v2_blobs" || context.rowId !== "public_photo") return;
      afterDecrypt = undefined;
      database.sqlite
        .query("UPDATE v2_blobs SET state='deleting' WHERE id=?")
        .run("sanitized_photo_1");
    };
    await expectBlocked(
      repository.publishApproved(owner, publicLawyer, { photo_1: "public_photo" }),
      true,
    );
    expect(await repository.publicProfile(profileId)).toBeNull();
    expect(database.sqlite.query("SELECT count(*) AS count FROM v2_public_assets").get()).toEqual({
      count: 0,
    });
    expect(database.sqlite.query("SELECT count(*) AS count FROM v2_public_profiles").get()).toEqual(
      { count: 0 },
    );
  });

  test.each(["withdrawn", "revoked_role"])(
    "%s qualification blocks public visibility and publication retry",
    async (state) => {
      await seedPublication();
      storePublicSnapshot();
      if (state === "withdrawn")
        database.sqlite
          .query("UPDATE v2_applications SET status='withdrawn',withdrawn_at=? WHERE id=?")
          .run(now, appId);
      else
        database.sqlite
          .query("DELETE FROM v2_role_bindings WHERE owner_id=? AND role='verified_lawyer'")
          .run(owner.ownerId);
      expect(await repository.publicProfile(profileId)).toBeNull();
      await seedBlob({ id: "public_photo", kind: "public_copy", visibility: "public" });
      expect(
        await repository.publishApproved(owner, publicLawyer, { photo_1: "public_photo" }),
      ).toBe(false);
    },
  );

  test.each([
    "foreign_owner",
    "different_asset",
    "changed_hash",
    "stale_asset_revision",
    "wrong_source_blob",
    "wrong_source_revision",
    "wrong_approved_revision",
  ])("public copy rejects %s and publishes no partial snapshot", async (boundary) => {
    await seedPublication();
    if (boundary === "wrong_source_blob") await seedBlob({ id: "unrelated_sanitized" });
    if (boundary === "wrong_approved_revision") await seedRevision("submitted", 3);
    await seedBlob({
      id: "public_photo",
      kind: "public_copy",
      visibility: "public",
      ownerId: boundary === "foreign_owner" ? stranger.ownerId : owner.ownerId,
      assetId: boundary === "different_asset" ? "other_asset" : "photo_1",
      contentHash: boundary === "changed_hash" ? otherHash : hash,
      sourceBlobId: boundary === "wrong_source_blob" ? "unrelated_sanitized" : "sanitized_photo_1",
      sourceAssetRevision: boundary === "wrong_source_revision" ? 3 : 2,
      approvedRevisionId: boundary === "wrong_approved_revision" ? "revision_3" : "revision_2",
    });
    if (boundary === "stale_asset_revision")
      database.sqlite.query("UPDATE v2_assets SET revision=3 WHERE id=?").run("photo_1");
    await expectBlocked(
      repository.publishApproved(owner, publicLawyer, { photo_1: "public_photo" }),
      true,
    );
    expect(await repository.publicProfile(profileId)).toBeNull();
    expect(database.sqlite.query("SELECT count(*) AS count FROM v2_public_assets").get()).toEqual({
      count: 0,
    });
    expect(database.sqlite.query("SELECT count(*) AS count FROM v2_public_profiles").get()).toEqual(
      { count: 0 },
    );
    expect(
      database.sqlite
        .query("SELECT approved_revision_id FROM v2_profiles WHERE id=?")
        .get(profileId),
    ).toEqual({ approved_revision_id: null });
    expect(database.sqlite.query("SELECT count(*) AS count FROM v2_mutation_claims").get()).toEqual(
      { count: 0 },
    );
  });

  test("revocation during review prevents approval/outbox even with a fresh moderator session", async () => {
    await seedApplication();
    await seedRevision("submitted");
    beforeEncrypt = (context) => {
      if (context.table !== "v2_moderation_decisions") return;
      beforeEncrypt = undefined;
      database.sqlite
        .query("DELETE FROM v2_role_bindings WHERE owner_id=? AND role='verified_lawyer'")
        .run(owner.ownerId);
    };
    expect(
      await repository.decideProfile(reviewer, sessionId, profileId, approvedProfile, admission),
    ).toBe(false);
    expect(
      database.sqlite.query("SELECT status FROM v2_profile_revisions WHERE id=?").get("revision_2"),
    ).toEqual({ status: "submitted" });
    expect(database.sqlite.query("SELECT count(*) AS count FROM v2_outbox").get()).toEqual({
      count: 0,
    });
  });
});

describe("v2 private reads and report moderation", () => {
  test("moderator can read only submitted linked verification assets, and owners retain their own read", async () => {
    await seedApplication("submitted");
    const value = await seedVerification();
    await seedVerification("unlinked_verification", false);
    await seedAsset();
    database.sqlite
      .query("INSERT INTO v2_application_assets(application_id,asset_id) VALUES(?,?)")
      .run(appId, "photo_1");
    expect(await repository.readAsset(owner, value.id)).toEqual(value);
    expect(await repository.readAsset(stranger, value.id)).toBeNull();
    expect(
      await repository.readSubmittedVerification(reviewer, sessionId, appId, value.id),
    ).toEqual(value);
    expect(
      await repository.readSubmittedVerification(stranger, sessionId, appId, value.id),
    ).toBeNull();
    expect(
      await repository.readSubmittedVerification(owner, sessionId, appId, value.id),
    ).toBeNull();
    expect(
      await repository.readSubmittedVerification(
        reviewer,
        sessionId,
        appId,
        "unlinked_verification",
      ),
    ).toBeNull();
    expect(
      await repository.readSubmittedVerification(reviewer, sessionId, appId, "photo_1"),
    ).toBeNull();
    expect(await repository.readApplication(reviewer, appId)).toBeNull();
    expect(await repository.withdrawApplication(owner, appId, 1)).toBe(true);
    expect(
      await repository.readSubmittedVerification(reviewer, sessionId, appId, value.id),
    ).toBeNull();
  });

  test.each(["role_revoked", "oauth_expired", "application_withdrawn", "asset_deleted"])(
    "moderator private verification read reauthorizes after decrypt when %s",
    async (boundary) => {
      await seedApplication("submitted");
      const value = await seedVerification();
      afterDecrypt = (context) => {
        if (context.table !== "v2_assets" || context.rowId !== value.id) return;
        afterDecrypt = undefined;
        if (boundary === "role_revoked")
          database.sqlite
            .query("DELETE FROM v2_role_bindings WHERE owner_id=?")
            .run(reviewer.ownerId);
        if (boundary === "oauth_expired")
          database.sqlite
            .query("UPDATE session SET oauth_authenticated_at=? WHERE id=?")
            .run(epoch - 600_001, sessionId);
        if (boundary === "application_withdrawn")
          database.sqlite
            .query("UPDATE v2_applications SET status='withdrawn',withdrawn_at=? WHERE id=?")
            .run(now, appId);
        if (boundary === "asset_deleted")
          database.sqlite
            .query("INSERT INTO v2_tombstones(target_kind,target_id,deleted_at) VALUES(?,?,?)")
            .run("asset", value.id, now);
      };
      expect(
        await repository.readSubmittedVerification(reviewer, sessionId, appId, value.id),
      ).toBeNull();
    },
  );

  test("owner asset read stops after a profile tombstone appears during decryption", async () => {
    const asset = await seedAsset();
    afterDecrypt = (context) => {
      if (context.table !== "v2_assets") return;
      afterDecrypt = undefined;
      database.sqlite
        .query("INSERT INTO v2_tombstones(target_kind,target_id,deleted_at) VALUES(?,?,?)")
        .run("profile", profileId, now);
    };
    expect(await repository.readAsset(owner, asset.id)).toBeNull();
  });

  test.each(["profile", "account"])(
    "rechecks %s tombstone after decrypt before returning private revision",
    async (kind) => {
      await seedRevision("draft");
      afterDecrypt = (context) => {
        if (context.table !== "v2_profile_revisions") return;
        afterDecrypt = undefined;
        database.sqlite
          .query("INSERT INTO v2_tombstones(target_kind,target_id,deleted_at) VALUES(?,?,?)")
          .run(kind, kind === "profile" ? profileId : owner.ownerId, now);
      };
      expect(await repository.readProfileRevision(owner, profileId, 2)).toBeNull();
    },
  );

  test("ordinary user can open a report but cannot create a resolved decision", async () => {
    await seedPublication();
    storePublicSnapshot();
    expect(await repository.saveModerationReport(stranger, report(), null)).toBe(true);
    const resolved = {
      ...report("resolved_report"),
      status: "resolved" as const,
      resolution: "Synthetic resolution",
    };
    await expectBlocked(repository.saveModerationReport(stranger, resolved, null));
    expect(
      database.sqlite.query("SELECT count(*) AS count FROM v2_moderation_reports").get(),
    ).toEqual({ count: 1 });
  });

  test("stale and duplicate report writes cannot claim successful CAS", async () => {
    await seedPublication();
    storePublicSnapshot();
    expect(await repository.saveModerationReport(stranger, report(), null)).toBe(true);
    expect(await repository.saveModerationReport(stranger, report(), null)).toBe(false);
    const updated = { ...report(), status: "reviewing" as const, revision: 2 };
    expect(await repository.saveModerationReport(reviewer, updated, 1, sessionId)).toBe(true);
    expect(await repository.saveModerationReport(reviewer, updated, 1, sessionId)).toBe(false);
    expect(
      database.sqlite
        .query("SELECT revision,state FROM v2_moderation_reports WHERE id=?")
        .get(updated.id),
    ).toEqual({ revision: 2, state: "reviewing" });
  });
});

test("owner publication withdrawal preserves reviewed history and journals public-copy cleanup until receipt", async () => {
  await seedPublication();
  await seedBlob({ id: "public_photo", kind: "public_copy", visibility: "public" });
  expect(await repository.publishApproved(owner, publicLawyer, { photo_1: "public_photo" })).toBe(
    true,
  );
  expect(await repository.withdrawProfile(stranger, profileId, 2, "publication")).toBe(false);
  expect(await repository.withdrawProfile(owner, profileId, 1, "publication")).toBe(false);
  expect(await repository.publicProfile(profileId)).toEqual(publicLawyer);
  expect(await repository.withdrawProfile(owner, profileId, 2, "publication")).toBe(true);
  expect(await repository.withdrawProfile(owner, profileId, 2, "publication")).toBe(false);
  expect(await repository.publicProfile(profileId)).toBeNull();
  expect(
    database.sqlite.query("SELECT status FROM v2_profile_revisions WHERE id='revision_2'").get(),
  ).toEqual({ status: "withdrawn" });
  expect(database.sqlite.query("SELECT state FROM v2_blobs WHERE id='public_photo'").get()).toEqual(
    { state: "deleting" },
  );
  expect(
    database.sqlite
      .query(
        "SELECT count(*) AS n FROM v2_deletion_targets WHERE kind='blob' AND target_id='public_photo'",
      )
      .get(),
  ).toEqual({ n: 1 });
});

test("owner withdraws the approved pointer using current profile revision while preserving a newer draft", async () => {
  await seedPublication();
  await seedBlob({ id: "public_photo", kind: "public_copy", visibility: "public" });
  expect(await repository.publishApproved(owner, publicLawyer, { photo_1: "public_photo" })).toBe(
    true,
  );
  expect(
    await repository.saveProfileDraft(owner, profileId, 2, "new_draft", publicLawyer.content),
  ).toBe(true);
  const draft = await repository.readProfileRevision(owner, profileId, 3);
  expect(await repository.withdrawApprovedProfile(stranger, profileId, 3)).toBe(false);
  expect(await repository.withdrawApprovedProfile(owner, profileId, 2)).toBe(false);
  expect(await repository.withdrawApprovedProfile(owner, profileId, 3)).toBe(true);
  expect(await repository.withdrawApprovedProfile(owner, profileId, 3)).toBe(false);
  expect(await repository.publicProfile(profileId)).toBeNull();
  expect(await repository.readProfileRevision(owner, profileId, 3)).toEqual(draft);
  expect(
    database.sqlite
      .query("SELECT revision,approved_revision_id FROM v2_profiles WHERE id=?")
      .get(profileId),
  ).toEqual({ revision: 3, approved_revision_id: null });
  expect(
    database.sqlite.query("SELECT status FROM v2_profile_revisions WHERE id='new_draft'").get(),
  ).toEqual({ status: "draft" });
  expect(
    database.sqlite.query("SELECT status FROM v2_profile_revisions WHERE id='revision_2'").get(),
  ).toEqual({ status: "withdrawn" });
  expect(database.sqlite.query("SELECT state FROM v2_blobs WHERE id='public_photo'").get()).toEqual(
    { state: "deleting" },
  );
});
