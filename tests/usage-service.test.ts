import { afterEach, expect, test } from "bun:test";
import { createCaseDataCipher } from "../src/server/crypto";
import { createV2AccountingRepository } from "../src/server/db/v2-accounting";
import { createV2Core } from "../src/server/db/v2-core";
import { createV2WorkspaceRepository } from "../src/server/db/v2-workspace";
import {
  createUsageService,
  quotaWaitReason,
  UsageError,
} from "../src/server/modules/usage/service";
import { createTestDatabase } from "./helpers/d1";
import { seedTestSession } from "./helpers/session";

const NOW = "2026-10-05T14:59:59.999Z";
const databases: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});
async function fixture() {
  const database = await createTestDatabase();
  databases.push(database);
  const owner = await seedTestSession(database);
  let now = NOW;
  const service = createUsageService(database.binding, {
    environment: "preview",
    clock: () => now,
  });
  const cipher = await createCaseDataCipher({
    CASE_DATA_KEY_V1: btoa("s".repeat(32)).replace(/=+$/, ""),
  });
  const workspace = createV2WorkspaceRepository(database.binding, cipher);
  await createV2AccountingRepository(
    createV2Core(database.binding, cipher),
    "preview",
  ).ensurePrincipal({ ownerId: owner.userId, now: NOW });
  return {
    database,
    owner,
    service,
    workspace,
    setNow: (value: string) => {
      now = value;
    },
  };
}
async function createCase(f: Awaited<ReturnType<typeof fixture>>) {
  const id = crypto.randomUUID();
  const result = await f.workspace.create(
    { ownerId: f.owner.userId, now: NOW },
    id,
    {
      narrative: "실제 SQL quota 경계를 검증하는 합성 사건입니다.",
      subjectContext: "individual",
      jurisdiction: "KR",
      turnstileToken: "synthetic-token",
    },
    { operationId: crypto.randomUUID(), key: crypto.randomUUID(), requestHash: "a".repeat(64) },
  );
  return { id, result };
}
test("usage uses server KST midnight, legacy maximum, reservations and honest overlimit counters", async () => {
  const f = await fixture();
  f.database.sqlite
    .query(
      "INSERT INTO daily_usage(user_id,usage_date_kst,analysis_count,updated_at) VALUES(?,?,3,?)",
    )
    .run(f.owner.userId, "2026-10-05", NOW);
  f.database.sqlite
    .query(
      "INSERT INTO v2_daily_usage(owner_id,day,cases_used,responses_used,responses_reserved,media_used,media_reserved) VALUES(?,?,1,201,2,3599.25,0.25)",
    )
    .run(f.owner.userId, "2026-10-05");
  const before = await f.service.account(f.owner.userId);
  expect(before.newCases.used).toBe(3);
  expect(before.aiResponses.used).toBe(201);
  expect(before.aiResponses.remaining).toBe(0);
  expect(before.mediaSeconds.remaining).toBe(0.5);
  expect(before.waitReasons).toEqual(["daily_cases", "daily_ai_responses", "monthly_budget"]);
  expect(before.resetAt).toBe("2026-10-05T15:00:00.000Z");
  f.setNow("2026-10-05T15:00:00Z");
  const after = await f.service.account(f.owner.userId);
  expect(after.day).toBe("2026-10-06");
  expect(after.newCases.remaining).toBe(3);
  expect(after.resetAt).toBe("2026-10-06T15:00:00.000Z");
});
test("display preflight cannot bypass atomic SQL new-case admission under contention", async () => {
  const f = await fixture();
  expect(
    (await f.service.preflightQuota(f.owner.userId, { kind: "new_case", units: 1 })).waitReason,
  ).toBeNull();
  const created = await Promise.all(Array.from({ length: 8 }, () => createCase(f)));
  expect(created.filter((item) => item.result.kind === "created")).toHaveLength(3);
  const usage = await f.service.account(f.owner.userId);
  expect(usage.newCases).toEqual({ limit: 3, used: 3, reserved: 0, remaining: 0 });
  expect(quotaWaitReason(usage, { kind: "new_case", units: 1 })).toBe("daily_cases");
  expect(quotaWaitReason(usage, { kind: "no_user_quota", reason: "delete" })).toBeNull();
});
test("original preflight counts pending case/account storage, original count and media duration once", async () => {
  const f = await fixture();
  const created = await createCase(f);
  f.database.sqlite
    .query(
      "UPDATE v2_case_original_usage SET stored_count=99,reserved_count=1,stored_bytes=4999999999,reserved_bytes=1 WHERE workspace_id=?",
    )
    .run(created.id);
  f.database.sqlite
    .query(
      "UPDATE v2_storage_usage SET stored_bytes=9999999990,reserved_bytes=10 WHERE principal_id=(SELECT id FROM v2_billing_principals WHERE owner_id=?)",
    )
    .run(f.owner.userId);
  f.database.sqlite
    .query("UPDATE v2_daily_usage SET media_used=3599.25,media_reserved=0.25 WHERE owner_id=?")
    .run(f.owner.userId);
  const result = await f.service.preflightOriginal(f.owner.userId, created.id, {
    category: "video",
    format: "mp4",
    byteLength: 1,
    durationSeconds: 0.75,
    hasAudio: true,
  });
  expect(result.waitReasons).toEqual(["account_storage", "case_original_storage", "daily_media"]);
  expect(result.originals.count.remaining).toBe(0);
  expect(result.originals.originalBytes.remaining).toBe(0);
  expect(result.usage.storageBytes.remaining).toBe(0);
});
test("server file probe validates exact decimal bytes/PDF/duration boundaries without MIME fallback", async () => {
  const f = await fixture();
  const created = await createCase(f);
  for (const probe of [
    { category: "document", format: "pdf", byteLength: 100000001, pageCount: 1 },
    { category: "document", format: "pdf", byteLength: 1, pageCount: 501 },
    { category: "audio", format: "wav", byteLength: 1000000001, durationSeconds: 0.5 },
    { category: "audio", format: "wav", byteLength: 1, durationSeconds: 3600.01 },
    { byteLength: 1, mediaType: "audio/wav", durationSeconds: 0.5 },
  ])
    await expect(f.service.preflightOriginal(f.owner.userId, created.id, probe)).rejects.toThrow();
  expect(
    (
      await f.service.preflightOriginal(f.owner.userId, created.id, {
        category: "document",
        format: "pdf",
        byteLength: 100000000,
        pageCount: 500,
      })
    ).waitReasons,
  ).toEqual([]);
  expect(
    (
      await f.service.preflightOriginal(f.owner.userId, created.id, {
        category: "audio",
        format: "wav",
        byteLength: 1000000000,
        durationSeconds: 3600,
      })
    ).waitReasons,
  ).toEqual([]);
});
test("foreign and nonexistent case scopes are indistinguishable and counters do not decrypt private fields", async () => {
  const f = await fixture();
  const created = await createCase(f);
  const foreign = await seedTestSession(f.database);
  for (const id of [created.id, crypto.randomUUID()]) {
    await expect(f.service.caseOriginals(foreign.userId, id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  }
  expect((await f.service.caseOriginals(f.owner.userId, created.id)).count.limit).toBe(100);
  expect((await f.service.account(foreign.userId)).newCases.used).toBe(0);
});
test("account tombstone during counter read blocks response and unknown identities never receive counters", async () => {
  const f = await fixture();
  const racing = createUsageService(f.database.binding, {
    environment: "preview",
    clock: () => NOW,
    paidAvailable: async () => {
      f.database.sqlite
        .query("INSERT INTO v2_tombstones(target_kind,target_id,deleted_at) VALUES('account',?,?)")
        .run(f.owner.userId, NOW);
      return true;
    },
  });
  await expect(racing.account(f.owner.userId)).rejects.toBeInstanceOf(UsageError);
  await expect(f.service.account(crypto.randomUUID())).rejects.toMatchObject({
    code: "UNAUTHENTICATED",
  });
});
test("trusted paid/capacity display signals cannot refill counters or make preflight an admission", async () => {
  const f = await fixture();
  const service = createUsageService(f.database.binding, {
    environment: "preview",
    clock: () => NOW,
    paidAvailable: async () => true,
    processingAvailable: async () => false,
  });
  expect((await service.account(f.owner.userId)).waitReasons).toEqual(["processing_capacity"]);
  expect(f.database.sqlite.query("SELECT count(*) AS n FROM v2_quota_reservations").get()).toEqual({
    n: 0,
  });
  expect(f.database.sqlite.query("SELECT count(*) AS n FROM v2_cost_attempts").get()).toEqual({
    n: 0,
  });
});
