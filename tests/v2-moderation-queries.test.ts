import { afterEach, beforeEach, expect, test } from "bun:test";
import type { V2LawyerApplication, V2ProfileRevision } from "../src/contracts/v2";
import { createEnvelopeCipher, type EncryptionContext } from "../src/server/crypto";
import { createV2Core } from "../src/server/db/v2-core";
import { createV2LawyersRepository } from "../src/server/db/v2-lawyers";
import { application, publicLawyer } from "./fixtures/contracts/v2";
import { createTestDatabase } from "./helpers/d1";

// Actual generated SQLite tables and AES-GCM. Signed-in session/role rows are
// synthetic upstream authentication evidence, not a live OAuth or human review.
const now = "2026-10-06T00:00:00.000Z";
const epoch = Date.parse(now);
const reviewer = { ownerId: "moderator_synthetic", now };
const sessionId = "moderator_session_synthetic";
let db: Awaited<ReturnType<typeof createTestDatabase>>;
let core: ReturnType<typeof createV2Core>;
let repo: ReturnType<typeof createV2LawyersRepository>;
let onDecrypt: ((context: EncryptionContext) => void) | undefined;
let decrypts: string[];

beforeEach(async () => {
  db = await createTestDatabase();
  onDecrypt = undefined;
  decrypts = [];
  const cipher = await createEnvelopeCipher({
    activeKeyId: "synthetic",
    keys: {
      synthetic: btoa("s".repeat(32)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, ""),
    },
  });
  core = createV2Core(db.binding, {
    encrypt: (value, context) => cipher.encrypt(value, context),
    async decrypt(value, context) {
      decrypts.push(context.table);
      const result = await cipher.decrypt(value, context);
      onDecrypt?.(context);
      return result;
    },
  });
  repo = createV2LawyersRepository(core);
  user(reviewer.ownerId);
  db.sqlite
    .query("INSERT INTO v2_role_bindings(owner_id,role,granted_at) VALUES(?,'moderator',?)")
    .run(reviewer.ownerId, now);
  db.sqlite
    .query(
      "INSERT INTO session(id,user_id,token,expires_at,created_at,updated_at,oauth_authenticated_at) VALUES(?,?,?,?,?,?,?)",
    )
    .run(sessionId, reviewer.ownerId, "synthetic_only", epoch + 600000, epoch, epoch, epoch);
});
afterEach(() => {
  expect(db.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
  db.close();
});
function user(id: string) {
  db.sqlite
    .query(
      "INSERT INTO user(id,name,email,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO NOTHING",
    )
    .run(id, "Synthetic account", `${id}@invalid.test`, epoch, epoch);
}
function tombstone(kind: string, id: string) {
  db.sqlite
    .query("INSERT INTO v2_tombstones(target_kind,target_id,deleted_at) VALUES(?,?,?)")
    .run(kind, id, now);
}
async function app(
  id = "app_synthetic",
  ownerId = "applicant_synthetic",
  status = "submitted",
  revision = 1,
) {
  user(ownerId);
  if (application.status === "draft") throw new Error("Fixture requires complete content");
  const value: V2LawyerApplication = {
    schemaVersion: "2",
    id,
    applicantId: ownerId,
    revision,
    createdAt: now,
    status: "submitted",
    submittedAt: now,
    content: structuredClone(application.content),
  };
  const encrypted = await core.encrypt("v2_applications", id, ownerId, revision, value);
  db.sqlite
    .query(
      "INSERT INTO v2_applications(id,owner_id,revision,status,encrypted_payload,submitted_at,decided_at,created_at) VALUES(?,?,?,?,?,?,?,?)",
    )
    .run(
      id,
      ownerId,
      revision,
      status,
      encrypted,
      now,
      status === "approved" || status === "rejected" ? now : null,
      now,
    );
  return value;
}
async function profile(
  id = "profile_synthetic",
  ownerId = "lawyer_synthetic",
  status = "submitted",
  revision = 1,
) {
  const approved = await app(`approved_${id}`, ownerId, "approved");
  db.sqlite
    .query(
      "INSERT INTO v2_role_bindings(owner_id,role,granted_at) VALUES(?,'verified_lawyer',?) ON CONFLICT DO NOTHING",
    )
    .run(ownerId, now);
  db.sqlite
    .query("INSERT INTO v2_profiles(id,owner_id,revision,created_at,updated_at) VALUES(?,?,?,?,?)")
    .run(id, ownerId, revision, now, now);
  const value: V2ProfileRevision = {
    schemaVersion: "2",
    id: `revision_${id}`,
    profileId: id,
    revision,
    createdAt: now,
    status: "submitted",
    submittedAt: now,
    content: structuredClone(publicLawyer.content),
  };
  const encrypted = await core.encrypt("v2_profile_revisions", value.id, ownerId, revision, value);
  db.sqlite
    .query(
      "INSERT INTO v2_profile_revisions(id,profile_id,revision,status,application_id,encrypted_payload,submitted_at,decided_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
    )
    .run(
      value.id,
      id,
      revision,
      status,
      approved.id,
      encrypted,
      now,
      status === "approved" || status === "rejected" ? now : null,
      now,
    );
  return value;
}

test("application queue pages submitted metadata in bounded id order without decrypting any private payload", async () => {
  for (let i = 0; i < 23; i++) await app(`app_${String(i).padStart(2, "0")}`, `owner_${i}`);
  await app("draft_other", "draft_owner", "draft");
  await app("own_submission", reviewer.ownerId);
  const first = await repo.submittedApplications(reviewer, sessionId, { limit: 20 });
  expect(first.items.length).toBe(20);
  expect(first.nextCursor).toBe("app_19");
  expect(first.items[0]).toEqual({
    id: "app_00",
    applicantId: "owner_0",
    revision: 1,
    submittedAt: now,
  });
  const next = await repo.submittedApplications(reviewer, sessionId, {
    limit: 20,
    cursor: first.nextCursor ?? "",
  });
  expect(next.items.map((item) => item.id)).toEqual(["app_20", "app_21", "app_22"]);
  expect(next.nextCursor).toBeNull();
  expect((await repo.submittedApplications(reviewer, sessionId)).items.length).toBe(10);
  expect(decrypts).toEqual([]);
});
test("profile queue exposes only current submitted verified qualification revisions", async () => {
  const a = await profile("a");
  await profile("b", "owner_b");
  await profile("c", "owner_c", "draft");
  await profile("self", reviewer.ownerId);
  const first = await repo.submittedProfiles(reviewer, sessionId, { limit: 1 });
  expect(first.items).toEqual([
    { id: a.id, profileId: a.profileId, revision: 1, submittedAt: now },
  ]);
  expect(first.nextCursor).toBe(a.id);
  expect(
    (await repo.submittedProfiles(reviewer, sessionId, { cursor: a.id })).items.map(
      (r) => r.profileId,
    ),
  ).toEqual(["b"]);
  expect(decrypts).toEqual([]);
});
test("submitted getters use owner-bound AES but keep owner-only getters inaccessible to the moderator", async () => {
  const a = await app();
  const p = await profile();
  expect(await repo.readApplication(reviewer, a.id)).toBeNull();
  expect(await repo.readProfileRevision(reviewer, p.profileId, 1)).toBeNull();
  expect(await repo.readSubmittedApplication(reviewer, sessionId, a.id)).toEqual(a);
  expect(await repo.readSubmittedProfile(reviewer, sessionId, p.profileId, 1)).toEqual(p);
  expect(decrypts).toEqual(["v2_applications", "v2_profile_revisions"]);
});
for (const failure of [
  "role",
  "session_owner",
  "expired_session",
  "expired_oauth",
  "future_oauth",
  "reviewer_deleted",
] as const) {
  test(`all queue/read paths reject ${failure} before private decryption`, async () => {
    await app();
    await profile();
    if (failure === "role")
      db.sqlite.query("DELETE FROM v2_role_bindings WHERE role='moderator'").run();
    if (failure === "session_owner") {
      user("foreign_synthetic");
      db.sqlite.query("UPDATE session SET user_id='foreign_synthetic'").run();
    }
    if (failure === "expired_session")
      db.sqlite.query("UPDATE session SET expires_at=?").run(epoch);
    if (failure === "expired_oauth")
      db.sqlite.query("UPDATE session SET oauth_authenticated_at=?").run(epoch - 600001);
    if (failure === "future_oauth")
      db.sqlite.query("UPDATE session SET oauth_authenticated_at=?").run(epoch + 1);
    if (failure === "reviewer_deleted") tombstone("account", reviewer.ownerId);
    expect((await repo.submittedApplications(reviewer, sessionId)).items).toEqual([]);
    expect((await repo.submittedProfiles(reviewer, sessionId)).items).toEqual([]);
    expect(await repo.readSubmittedApplication(reviewer, sessionId, "app_synthetic")).toBeNull();
    expect(await repo.readSubmittedProfile(reviewer, sessionId, "profile_synthetic", 1)).toBeNull();
    expect(decrypts).toEqual([]);
  });
}
test("malformed cursor, excessive/fractional limits, wrong revision and non-submitted targets fail closed", async () => {
  for (const page of [
    { limit: 21 },
    { limit: 0 },
    { limit: 1.5 },
    { cursor: "" },
    { cursor: "bad cursor" },
  ]) {
    await expect(repo.submittedApplications(reviewer, sessionId, page)).rejects.toMatchObject({
      code: "REPOSITORY_INPUT_INVALID",
    });
    await expect(repo.submittedProfiles(reviewer, sessionId, page)).rejects.toMatchObject({
      code: "REPOSITORY_INPUT_INVALID",
    });
  }
  await app("draft", "owner_draft", "draft");
  await profile();
  expect(await repo.readSubmittedApplication(reviewer, sessionId, "draft")).toBeNull();
  expect(await repo.readSubmittedProfile(reviewer, sessionId, "profile_synthetic", 2)).toBeNull();
  expect(decrypts).toEqual([]);
});
for (const target of ["application", "profile"] as const) {
  for (const race of ["role", "session", "oauth", "owner", "profile", "withdraw"] as const) {
    test(`${target} read rechecks ${race} after actual AES decryption`, async () => {
      const a = await app();
      const p = await profile();
      if (race === "profile" && target === "application")
        await repo.createProfile({ ownerId: a.applicantId, now }, "applicant_profile");
      onDecrypt = () => {
        if (race === "role")
          db.sqlite.query("DELETE FROM v2_role_bindings WHERE role='moderator'").run();
        if (race === "session") db.sqlite.query("UPDATE session SET expires_at=?").run(epoch);
        if (race === "oauth")
          db.sqlite.query("UPDATE session SET oauth_authenticated_at=?").run(epoch - 600001);
        if (race === "owner")
          tombstone("account", target === "application" ? a.applicantId : "lawyer_synthetic");
        if (race === "profile")
          tombstone("profile", target === "application" ? "applicant_profile" : p.profileId);
        if (race === "withdraw")
          db.sqlite
            .query(
              target === "application"
                ? "UPDATE v2_applications SET status='withdrawn',withdrawn_at=? WHERE id=?"
                : "UPDATE v2_profile_revisions SET status='withdrawn',withdrawn_at=? WHERE id=?",
            )
            .run(now, target === "application" ? a.id : p.id);
      };
      expect(
        target === "application"
          ? await repo.readSubmittedApplication(reviewer, sessionId, a.id)
          : await repo.readSubmittedProfile(reviewer, sessionId, p.profileId, 1),
      ).toBeNull();
      expect(decrypts.length).toBe(1);
    });
  }
}
test("qualification revocation and current profile revision changes revoke submitted profile reads and queues", async () => {
  const p = await profile();
  db.sqlite.query("UPDATE v2_profiles SET revision=2 WHERE id=?").run(p.profileId);
  expect(await repo.readSubmittedProfile(reviewer, sessionId, p.profileId, 1)).toBeNull();
  db.sqlite.query("UPDATE v2_profiles SET revision=1 WHERE id=?").run(p.profileId);
  db.sqlite.query("DELETE FROM v2_role_bindings WHERE role='verified_lawyer'").run();
  expect(await repo.readSubmittedProfile(reviewer, sessionId, p.profileId, 1)).toBeNull();
  expect((await repo.submittedProfiles(reviewer, sessionId)).items).toEqual([]);
  expect(decrypts).toEqual([]);
});

test("route revision-id accessor delegates scoped submitted profile read and preserves post-decrypt authorization", async () => {
  const p = await profile();
  expect(await repo.readSubmittedProfileById(reviewer, sessionId, p.id)).toEqual(p);
  expect(await repo.readSubmittedProfileById(reviewer, sessionId, "unknown_revision")).toBeNull();
  onDecrypt = () => db.sqlite.query("DELETE FROM v2_role_bindings WHERE role='moderator'").run();
  expect(await repo.readSubmittedProfileById(reviewer, sessionId, p.id)).toBeNull();
});

test("application-id revocation resolves trusted owner metadata, audits once, and rejects wrong status/revision/role", async () => {
  const p = await profile();
  expect(
    await repo.revokeVerificationByApplication(reviewer, sessionId, `approved_${p.profileId}`, 2),
  ).toBe(false);
  expect(
    await repo.revokeVerificationByApplication(reviewer, sessionId, `approved_${p.profileId}`, 1),
  ).toBe(true);
  expect(
    await repo.revokeVerificationByApplication(reviewer, sessionId, `approved_${p.profileId}`, 1),
  ).toBe(false);
  expect(
    db.sqlite.query("SELECT count(*) AS n FROM v2_role_audit WHERE action='revoke'").get(),
  ).toEqual({ n: 1 });
  expect((await repo.submittedProfiles(reviewer, sessionId)).items).toEqual([]);
  const a = await app();
  expect(await repo.revokeVerificationByApplication(reviewer, sessionId, a.id, 1)).toBe(false);
  expect(decrypts).toEqual([]);
});

test("application-id revocation rejects stale authentication and deleted target without audit mutations", async () => {
  const p = await profile();
  db.sqlite.query("UPDATE session SET oauth_authenticated_at=?").run(epoch - 600001);
  expect(
    await repo.revokeVerificationByApplication(reviewer, sessionId, `approved_${p.profileId}`, 1),
  ).toBe(false);
  db.sqlite.query("UPDATE session SET oauth_authenticated_at=?").run(epoch);
  tombstone("account", "lawyer_synthetic");
  expect(
    await repo.revokeVerificationByApplication(reviewer, sessionId, `approved_${p.profileId}`, 1),
  ).toBe(false);
  expect(db.sqlite.query("SELECT count(*) AS n FROM v2_role_audit").get()).toEqual({ n: 0 });
});
