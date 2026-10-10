import { afterEach, expect, test } from "bun:test";
import type {
  V2DirectoryQuery,
  V2LawyerApplication,
  V2PortfolioAsset,
  V2PublicLawyer,
} from "../src/contracts/v2";
import { createCaseDataCipher } from "../src/server/crypto";
import { createV2AccountingRepository } from "../src/server/db/v2-accounting";
import { createV2Core } from "../src/server/db/v2-core";
import {
  createV2DirectoryRepository,
  DIRECTORY_ROTATION_ALGORITHM,
} from "../src/server/db/v2-directory";
import { cleanupExpiredDirectorySnapshots } from "../src/server/db/v2-directory-cleanup";
import { createV2LawyersRepository } from "../src/server/db/v2-lawyers";
import { application, publicLawyer } from "./fixtures/contracts/v2";
import { createTestDatabase } from "./helpers/d1";
import { seedTestSession } from "./helpers/session";

const NOW = "2026-10-06T00:00:00.000Z";
const EXPIRES = "2026-10-06T00:05:00.000Z";
const HASH = "b".repeat(64);
const databases: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) {
    expect(db.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
    db.close();
  }
});
async function fixture() {
  const database = await createTestDatabase();
  databases.push(database);
  const cipher = await createCaseDataCipher({
    CASE_DATA_KEY_V1: btoa("d".repeat(32)).replace(/=+$/, ""),
  });
  const core = createV2Core(database.binding, cipher);
  const moderator = await seedTestSession(database, {
    now: Date.parse(NOW),
    consent: true,
    oauthAuthenticatedAt: Date.parse(NOW),
  });
  database.sqlite
    .query("INSERT INTO v2_role_bindings(owner_id,role,granted_at) VALUES(?,'moderator',?)")
    .run(moderator.userId, NOW);
  const reviewer = { ownerId: moderator.userId, now: NOW };
  const lawyers = createV2LawyersRepository(core);
  return {
    database,
    core,
    reviewer,
    sessionId: moderator.sessionId,
    lawyers,
    directory: createV2DirectoryRepository(core),
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
type Options = {
  name?: string;
  region?: V2PublicLawyer["content"]["office"]["region"];
  fields?: V2PublicLawyer["content"]["legalFields"];
};
// Only already-sanitized physical assets are SQL-seeded; real AES, application/profile
// submission, recent moderator approval and public projection publication use repositories.
// These synthetic manual decisions are not actual identity/legal/R2 approval evidence.
async function storedBlob(
  f: Fixture,
  ownerId: string,
  photoId: string,
  id: string,
  kind: string,
  visibility: "staging" | "public",
  sourceId: string | null,
  revisionId: string | null,
) {
  const principal = f.database.sqlite
    .query("SELECT id FROM v2_billing_principals WHERE owner_id=?")
    .get(ownerId) as { id: string };
  const reservationId = `reservation_${id}`;
  f.database.sqlite
    .query(
      "INSERT INTO v2_storage_reservations(id,principal_id,operation_id,target_id,entity_id,kind,byte_length,state,created_at) VALUES(?,?,?,?,?,'lawyer_asset',100,'stored',?)",
    )
    .run(reservationId, principal.id, `synthetic-${photoId}`, id, photoId, NOW);
  const payload = await f.core.encrypt("v2_blobs", id, ownerId, 1, { contentHash: HASH });
  f.database.sqlite
    .query(
      "INSERT INTO v2_blobs(id,principal_id,reservation_id,kind,visibility,state,object_key,logical_bytes,cipher_bytes,cipher_hash,key_version,encrypted_payload,source_blob_id,source_asset_revision,approved_revision_id,created_at) VALUES(?,?,?,?,?,'stored',?,100,116,?,?,?,?,?,?,?)",
    )
    .run(
      id,
      principal.id,
      reservationId,
      kind,
      visibility,
      `${visibility}/${id}`,
      HASH,
      visibility === "public" ? null : "1",
      payload,
      sourceId,
      sourceId ? 2 : null,
      revisionId,
      NOW,
    );
  f.database.sqlite
    .query("UPDATE v2_storage_usage SET stored_bytes=stored_bytes+100 WHERE principal_id=?")
    .run(principal.id);
}
async function published(f: Fixture, index: number, options: Options = {}) {
  const session = await seedTestSession(f.database, { now: Date.parse(NOW), consent: true });
  const actor = { ownerId: session.userId, now: NOW };
  await createV2AccountingRepository(f.core).ensurePrincipal(actor);
  const profileId = `profile_${String(index).padStart(4, "0")}`;
  const appId = `application_${index}`;
  const photoId = `photo_${index}`;
  const revisionId = `revision_${index}_2`;
  const sanitizedId = `sanitized_${photoId}`;
  const dto = structuredClone(publicLawyer);
  dto.id = profileId;
  dto.publishedAt = NOW;
  dto.content.name = options.name ?? `합성 변호사 ${index}`;
  dto.content.office.region = options.region ?? "seoul";
  dto.content.legalFields = options.fields ?? ["civil"];
  dto.content.photoAssetId = photoId;
  dto.assets = dto.assets.map((a) => ({ ...a, id: photoId, contentHash: HASH }));
  expect(await f.lawyers.createProfile(actor, profileId)).toBe(true);
  if (application.status === "draft")
    throw new Error("Synthetic complete application fixture required");
  const verification = structuredClone(application.content.assets[0]);
  if (!verification) throw new Error("Synthetic verification required");
  verification.id = `verification_${index}`;
  verification.contentHash = HASH;
  const verificationPayload = await f.core.encrypt(
    "v2_assets",
    verification.id,
    actor.ownerId,
    1,
    verification,
  );
  f.database.sqlite
    .query(
      "INSERT INTO v2_assets(id,owner_id,profile_id,revision,purpose,state,encrypted_payload,created_at) VALUES(?,?,?,1,?,'ready',?,?)",
    )
    .run(verification.id, actor.ownerId, profileId, verification.purpose, verificationPayload, NOW);
  const draft: V2LawyerApplication = {
    schemaVersion: "2",
    id: appId,
    applicantId: actor.ownerId,
    revision: 1,
    status: "draft",
    createdAt: NOW,
    content: {
      ...structuredClone(application.content),
      name: dto.content.name,
      office: dto.content.office,
      assets: [verification],
    },
  };
  expect(await f.lawyers.saveApplication(actor, draft, null)).toBe(true);
  expect(await f.lawyers.submitApplication(actor, appId, 1)).toBe(true);
  expect(
    await f.lawyers.decideApplication(f.reviewer, f.sessionId, appId, {
      expectedRevision: 1,
      decision: "approved",
      reason: "합성 수동 자격 검토",
      checklist: { identity: true, lawyerLicense: true, office: true },
    }),
  ).toBe(true);
  await storedBlob(
    f,
    actor.ownerId,
    photoId,
    sanitizedId,
    "profile_photo_sanitized",
    "staging",
    null,
    null,
  );
  const photo: V2PortfolioAsset = {
    id: photoId,
    revision: 2,
    kind: "image",
    status: "ready",
    byteLength: 100,
    originalHash: HASH,
    sanitizedDerivative: { id: sanitizedId, byteLength: 100, contentHash: HASH, format: "png" },
    currentJobId: null,
    failure: null,
  };
  const photoPayload = await f.core.encrypt("v2_assets", photoId, actor.ownerId, 2, photo);
  f.database.sqlite
    .query(
      "INSERT INTO v2_assets(id,owner_id,profile_id,revision,purpose,state,sanitized_blob_id,encrypted_payload,created_at) VALUES(?,?,?,2,'profile_photo','ready',?,?,?)",
    )
    .run(photoId, actor.ownerId, profileId, sanitizedId, photoPayload, NOW);
  expect(await f.lawyers.saveProfileDraft(actor, profileId, 1, revisionId, dto.content)).toBe(true);
  expect(await f.lawyers.submitProfile(actor, profileId, 2, appId)).toBe(true);
  expect(
    await f.lawyers.decideProfile(
      f.reviewer,
      f.sessionId,
      profileId,
      {
        expectedRevision: 2,
        decision: "approved",
        reason: "합성 게시 내용 검토",
        checklist: {
          identityMatches: true,
          officeMatches: true,
          personalDataReviewed: true,
          advertisingReviewed: true,
          assetsSanitized: true,
        },
      },
      { operationId: crypto.randomUUID(), key: crypto.randomUUID(), requestHash: HASH },
    ),
  ).toBe(true);
  const publicBlobId = `public_${photoId}_2`;
  await storedBlob(
    f,
    actor.ownerId,
    photoId,
    publicBlobId,
    "public_copy",
    "public",
    sanitizedId,
    revisionId,
  );
  expect(await f.lawyers.publishApproved(actor, dto, { [photoId]: publicBlobId })).toBe(true);
  return { actor, profileId, appId, revisionId, photoId, sanitizedId, publicBlobId, dto };
}
async function start(
  f: Fixture,
  query: V2DirectoryQuery = { limit: 20 },
  now = NOW,
  expiresAt = EXPIRES,
) {
  const id = crypto.randomUUID();
  const page = await f.directory.create(now, query, { id, expiresAt });
  if (!page) throw new Error("Synthetic directory snapshot missing");
  return { id, page };
}
function rawOrder(f: Fixture, id: string) {
  return f.database.sqlite
    .query("SELECT profile_id,ordinal FROM v2_directory_items WHERE snapshot_id=? ORDER BY ordinal")
    .all(id) as { profile_id: string; ordinal: number }[];
}
function cursorOrdinal(cursor: string) {
  return (
    JSON.parse(atob(cursor.replaceAll("-", "+").replaceAll("_", "/"))) as [string, number]
  )[1];
}
function hookScan(f: Fixture, run: () => void) {
  const original = f.core.statement;
  let fired = false;
  f.core.statement = (sql, values = []) => {
    const statement = original(sql, values);
    if (sql.includes("SELECT item.ordinal,item.profile_id,item.revision_id")) {
      const all = statement.all.bind(statement);
      statement.all = async <T>() => {
        const result = await all<T>();
        if (!fired) {
          fired = true;
          run();
        }
        return result;
      };
    }
    return statement;
  };
  return () => fired;
}

test("approved public filters remain literal, objective and never invent coverage or use private decryption", async () => {
  const f = await fixture();
  const a = await published(f, 0, {
    name: "홍 합성 Alpha_100%",
    region: "seoul",
    fields: ["civil", "family"],
  });
  await published(f, 1, { name: "김 합성 Alpha", region: "busan", fields: ["civil"] });
  await published(f, 2, { name: "이 합성", region: "seoul", fields: ["criminal"] });
  let decryptions = 0;
  const decrypt = f.core.cipher.decrypt.bind(f.core.cipher);
  f.core.cipher.decrypt = async (e, c) => {
    decryptions++;
    return decrypt(e, c);
  };
  const filtered = await start(f, {
    name: "alpha_100%",
    region: "seoul",
    legalField: "family",
    limit: 50,
  });
  expect(filtered.page.items.map((i) => i.id)).toEqual([a.profileId]);
  expect(filtered.page.rotation).toBe("disclosed_rotation");
  expect(filtered.page.nextCursor).toBeNull();
  const absent = await start(f, { region: "jeju", legalField: "tax", limit: 50 });
  expect(absent.page.items).toEqual([]);
  expect(absent.page.nextCursor).toBeNull();
  expect(decryptions).toBe(0);
});

test("daily KST rotation is stable within a snapshot and deterministic for the same public dataset", async () => {
  const f = await fixture();
  for (let i = 0; i < 5; i++) await published(f, i);
  const a = await start(f, { limit: 2 });
  const b = await start(f, { limit: 50 });
  expect(rawOrder(f, a.id)).toEqual(rawOrder(f, b.id));
  expect(
    f.database.sqlite
      .query(
        "SELECT rotation_day,rotation_algorithm,item_count FROM v2_directory_snapshots WHERE id=?",
      )
      .get(a.id),
  ).toEqual({
    rotation_day: "2026-10-06",
    rotation_algorithm: DIRECTORY_ROTATION_ALGORITHM,
    item_count: 5,
  });
  const ids = a.page.items.map((i) => i.id);
  let cursor = a.page.nextCursor;
  while (cursor) {
    const page = await f.directory.page(NOW, { limit: 2, cursor });
    if (!page) throw new Error("Synthetic pagination expired");
    ids.push(...page.items.map((i) => i.id));
    cursor = page.nextCursor;
  }
  expect(ids).toEqual(rawOrder(f, a.id).map((i) => i.profile_id));
  expect(new Set(ids).size).toBe(5);
  const order = rawOrder(f, a.id).map((i) => i.profile_id);
  const tomorrow = await start(
    f,
    { limit: 50 },
    "2026-10-06T15:00:00.000Z",
    "2026-10-06T15:05:00.000Z",
  );
  const firstId = order[0];
  if (!firstId) throw new Error("Synthetic rotation requires an approved profile");
  expect(tomorrow.page.items.map((i) => i.id)).toEqual([...order.slice(1), firstId]);
});

test("cursor expiry, query scope and canonical timestamps reject reuse outside the fixed snapshot", async () => {
  const f = await fixture();
  await published(f, 0);
  await published(f, 1);
  const s = await start(
    f,
    { region: "seoul", limit: 1 },
    "2026-10-06T00:00:00Z",
    "2026-10-06T00:05:00Z",
  );
  const cursor = s.page.nextCursor;
  if (!cursor) throw new Error("Synthetic two-item cursor required");
  expect(s.page.expiresAt).toBe(EXPIRES);
  expect(await f.directory.page(EXPIRES, { region: "seoul", limit: 1, cursor })).toBeNull();
  expect(
    await f.directory.page("2026-10-05T23:59:59.999Z", { region: "seoul", limit: 1, cursor }),
  ).toBeNull();
  expect(await f.directory.page(NOW, { region: "busan", limit: 1, cursor })).toBeNull();
  expect(
    await f.directory.page("2026-10-06T00:04:59.999Z", { region: "seoul", limit: 50, cursor }),
  ).not.toBeNull();
  await expect(f.directory.page(NOW, { limit: 20, cursor: "not_a_valid_cursor" })).rejects.toThrow(
    "REPOSITORY_INPUT_INVALID",
  );
  await expect(
    f.directory.create(
      NOW,
      { limit: 20 },
      { id: crypto.randomUUID(), expiresAt: "2026-10-06T00:05:00.001Z" },
    ),
  ).rejects.toThrow("REPOSITORY_INPUT_INVALID");
});

test("pending profile revisions never replace the last approved public card or filter name", async () => {
  const f = await fixture();
  const lawyer = await published(f, 0);
  const privateName = "미승인 비공개 초안";
  expect(
    await f.lawyers.saveProfileDraft(lawyer.actor, lawyer.profileId, 2, "pending_revision", {
      ...lawyer.dto.content,
      name: privateName,
    }),
  ).toBe(true);
  const s = await start(f, { limit: 50 });
  expect(s.page.items[0]?.approvedRevision).toBe(2);
  expect(s.page.items[0]?.content.name).toBe(lawyer.dto.content.name);
  expect((await start(f, { limit: 50, name: privateName })).page.items).toEqual([]);
});

test("withdrawn application, removed role and account/profile/asset tombstones never leak a card", async () => {
  for (const boundary of ["application", "role", "account", "profile", "asset", "publicBlob"]) {
    const f = await fixture();
    const a = await published(f, 0);
    const b = await published(f, 1);
    const s = await start(f, { limit: 1 });
    const remaining = rawOrder(f, s.id)[1];
    if (!remaining || !s.page.nextCursor) throw new Error("Synthetic remaining profile required");
    const target = remaining.profile_id === a.profileId ? a : b;
    if (boundary === "application")
      expect(await f.lawyers.withdrawApplication(target.actor, target.appId, 1)).toBe(true);
    if (boundary === "role")
      f.database.sqlite
        .query("DELETE FROM v2_role_bindings WHERE owner_id=? AND role='verified_lawyer'")
        .run(target.actor.ownerId);
    if (["account", "profile", "asset"].includes(boundary))
      f.database.sqlite
        .query("INSERT INTO v2_tombstones VALUES(?,?,?)")
        .run(
          boundary,
          boundary === "account"
            ? target.actor.ownerId
            : boundary === "profile"
              ? target.profileId
              : target.photoId,
          NOW,
        );
    if (boundary === "publicBlob")
      f.database.sqlite
        .query("UPDATE v2_blobs SET state='deleting' WHERE id=?")
        .run(target.publicBlobId);
    const next = await f.directory.page(NOW, { limit: 1, cursor: s.page.nextCursor });
    expect(next?.items).toEqual([]);
    expect(next?.nextCursor).toBeNull();
  }
});

test("revocation during the raw page query is rechecked by the final public-only group read", async () => {
  const f = await fixture();
  const a = await published(f, 0);
  const fired = hookScan(f, () =>
    f.database.sqlite
      .query("DELETE FROM v2_role_bindings WHERE owner_id=? AND role='verified_lawyer'")
      .run(a.actor.ownerId),
  );
  const s = await start(f, { limit: 50 });
  expect(fired()).toBe(true);
  expect(s.page.items).toEqual([]);
  expect(s.page.nextCursor).toBeNull();
});

test("missing raw windows advance scan ordinals and terminate without infinite empty pages", async () => {
  const f = await fixture();
  for (let i = 0; i < 103; i++) await published(f, i);
  const s = await start(f, { limit: 50 });
  expect(s.page.items.length).toBe(50);
  if (!s.page.nextCursor) throw new Error("Synthetic remaining pages required");
  const targets = rawOrder(f, s.id).filter((i) => i.ordinal >= 50);
  for (const target of targets)
    f.database.sqlite
      .query("INSERT INTO v2_tombstones VALUES('profile',?,?)")
      .run(target.profile_id, NOW);
  let cursor: string | null = s.page.nextCursor;
  let after = 49;
  let calls = 0;
  while (cursor) {
    const page = await f.directory.page(NOW, { limit: 20, cursor });
    if (!page) throw new Error("Synthetic snapshot expired");
    expect(page.items).toEqual([]);
    calls++;
    if (page.nextCursor) {
      const ordinal = cursorOrdinal(page.nextCursor);
      expect(ordinal).toBeGreaterThan(after);
      after = ordinal;
    }
    cursor = page.nextCursor;
    if (calls > 3) throw new Error("Cursor failed to terminate bounded windows");
  }
  expect(calls).toBe(3);
}, 30_000);

test("snapshot insertion is atomic and same-scope replay does not append duplicates", async () => {
  const f = await fixture();
  await published(f, 0);
  const id = crypto.randomUUID();
  f.database.sqlite.exec(
    "CREATE TRIGGER synthetic_directory_failure BEFORE INSERT ON v2_directory_items BEGIN SELECT RAISE(ABORT,'synthetic'); END",
  );
  await expect(f.directory.create(NOW, { limit: 20 }, { id, expiresAt: EXPIRES })).rejects.toThrow(
    "DB_OPERATION_FAILED",
  );
  expect(f.database.sqlite.query("SELECT count(*) n FROM v2_directory_snapshots").get()).toEqual({
    n: 0,
  });
  f.database.sqlite.exec("DROP TRIGGER synthetic_directory_failure");
  const first = await f.directory.create(NOW, { limit: 20 }, { id, expiresAt: EXPIRES });
  expect(await f.directory.create(NOW, { limit: 20 }, { id, expiresAt: EXPIRES })).toEqual(first);
  expect(rawOrder(f, id).length).toBe(1);
  expect(
    await f.directory.create("2026-10-06T00:00:01.000Z", { limit: 20 }, { id, expiresAt: EXPIRES }),
  ).toEqual(first);
});

test("newly approved providers do not shift an existing cursor and true empty filters stay empty", async () => {
  const f = await fixture();
  await published(f, 0);
  await published(f, 1);
  const s = await start(f, { limit: 1 });
  const before = rawOrder(f, s.id);
  if (!s.page.nextCursor) throw new Error("Synthetic two provider cursor required");
  await published(f, 2, { region: "jeju" });
  const page = await f.directory.page(NOW, { limit: 50, cursor: s.page.nextCursor });
  expect(page?.items.map((l) => l.id)).toEqual(before.slice(1).map((r) => r.profile_id));
  expect(rawOrder(f, s.id)).toEqual(before);
  expect((await start(f, { region: "jeju", limit: 50 })).page.items.map((l) => l.id)).toEqual([
    "profile_0002",
  ]);
});

test("publishing a new approved revision skips old snapshot pointers instead of substituting the new card", async () => {
  const f = await fixture();
  const first = await published(f, 0);
  const second = await published(f, 1);
  const s = await start(f, { limit: 1 });
  const targetId = rawOrder(f, s.id)[1]?.profile_id;
  if (!targetId || !s.page.nextCursor) throw new Error("Synthetic unvisited pointer required");
  const target = targetId === first.profileId ? first : second;
  const dto = structuredClone(target.dto);
  dto.approvedRevision = 3;
  dto.content.name = "새 합성 승인 이름";
  dto.assets = dto.assets.map((a) => ({ ...a, approvedRevision: 3 }));
  const revisionId = `revision_new_${target.profileId}`;
  expect(
    await f.lawyers.saveProfileDraft(target.actor, target.profileId, 2, revisionId, dto.content),
  ).toBe(true);
  expect(await f.lawyers.submitProfile(target.actor, target.profileId, 3, target.appId)).toBe(true);
  expect(
    await f.lawyers.decideProfile(
      f.reviewer,
      f.sessionId,
      target.profileId,
      {
        expectedRevision: 3,
        decision: "approved",
        reason: "합성 새 승인본",
        checklist: {
          identityMatches: true,
          officeMatches: true,
          personalDataReviewed: true,
          advertisingReviewed: true,
          assetsSanitized: true,
        },
      },
      { operationId: crypto.randomUUID(), key: crypto.randomUUID(), requestHash: HASH },
    ),
  ).toBe(true);
  const copyId = `public_${target.photoId}_3`;
  await storedBlob(
    f,
    target.actor.ownerId,
    target.photoId,
    copyId,
    "public_copy",
    "public",
    target.sanitizedId,
    revisionId,
  );
  expect(await f.lawyers.publishApproved(target.actor, dto, { [target.photoId]: copyId })).toBe(
    true,
  );
  const old = await f.directory.page(NOW, { limit: 1, cursor: s.page.nextCursor });
  expect(old?.items).toEqual([]);
  expect(old?.nextCursor).toBeNull();
  const fresh = await start(f, { name: dto.content.name, limit: 50 });
  expect(fresh.page.items.map((l) => [l.id, l.approvedRevision])).toEqual([[target.profileId, 3]]);
});

test("expiry changes during a page scan are included in the last SQL authorization read", async () => {
  const f = await fixture();
  await published(f, 0);
  await published(f, 1);
  const s = await start(f, { limit: 1 });
  if (!s.page.nextCursor) throw new Error("Synthetic cursor required");
  const fired = hookScan(f, () =>
    f.database.sqlite
      .query("UPDATE v2_directory_snapshots SET expires_at=? WHERE id=?")
      .run("2026-10-06T00:00:30.000Z", s.id),
  );
  expect(
    await f.directory.page("2026-10-06T00:01:00.000Z", { limit: 1, cursor: s.page.nextCursor }),
  ).toBeNull();
  expect(fired()).toBe(true);
});

test("every continuous page uses a constant bounded query count with no per-profile lookup", async () => {
  const f = await fixture();
  for (let i = 0; i < 61; i++) await published(f, i);
  const s = await start(f, { limit: 50 });
  if (!s.page.nextCursor) throw new Error("Synthetic second page required");
  const original = f.core.statement;
  let queries = 0;
  const limits: number[] = [];
  f.core.statement = (sql, values = []) => {
    queries++;
    if (sql.includes("ORDER BY item.ordinal LIMIT ?"))
      limits.push(Number(values[values.length - 1]));
    return original(sql, values);
  };
  const next = await f.directory.page(NOW, { limit: 50, cursor: s.page.nextCursor });
  expect(next?.items.length).toBe(11);
  expect(next?.nextCursor).toBeNull();
  expect(queries).toBe(3);
  expect(limits).toEqual([50]);
});

test("new searches prune expired snapshots and their items while preserving a live cursor", async () => {
  const f = await fixture();
  await published(f, 0);
  await published(f, 1);
  const expired = await start(f, { limit: 1 });
  const active = await start(f, { limit: 1 });
  f.database.sqlite
    .query("UPDATE v2_directory_snapshots SET expires_at=? WHERE id=?")
    .run("2026-10-06T00:00:01.000Z", expired.id);
  await f.directory.create(
    "2026-10-06T00:00:02.000Z",
    { limit: 1 },
    {
      id: crypto.randomUUID(),
      expiresAt: "2026-10-06T00:05:02.000Z",
    },
  );
  expect(
    f.database.sqlite.query("SELECT id FROM v2_directory_snapshots WHERE id=?").get(expired.id),
  ).toBeNull();
  expect(
    f.database.sqlite
      .query("SELECT snapshot_id FROM v2_directory_items WHERE snapshot_id=?")
      .all(expired.id),
  ).toEqual([]);
  expect(
    await f.directory.page("2026-10-06T00:00:02.000Z", {
      limit: 1,
      cursor: active.page.nextCursor ?? "",
    }),
  ).not.toBeNull();
});

test("scheduled cleanup deletes at most 1000 item rows and 100 empty headers per batch", async () => {
  const f = await fixture();
  await published(f, 0);
  await published(f, 1);
  for (let i = 0; i < 501; i++) await start(f, { limit: 1 });
  f.database.sqlite
    .query("UPDATE v2_directory_snapshots SET expires_at=?")
    .run("2026-10-06T00:00:01.000Z");
  await cleanupExpiredDirectorySnapshots(f.database.binding, "2026-10-06T00:00:02.000Z");
  const count = (table: string) =>
    (f.database.sqlite.query(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
  expect(count("v2_directory_items")).toBe(2);
  expect(count("v2_directory_snapshots")).toBe(401);
  await cleanupExpiredDirectorySnapshots(f.database.binding, "2026-10-06T00:00:02.000Z");
  expect(count("v2_directory_items")).toBe(0);
  expect(count("v2_directory_snapshots")).toBe(301);
});
