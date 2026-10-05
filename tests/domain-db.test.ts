import { afterEach, describe, expect, test } from "bun:test";
import { CURRENT_POLICY_VERSIONS } from "../src/contracts";
import { api } from "../src/server/api";
import { getAuth } from "../src/server/auth";
import { createCaseDataCipher } from "../src/server/crypto";
import {
  type AnalysisGuard,
  createDomainRepository,
  DomainRepositoryError,
  type InitialCaseWrite,
  usageDateKst,
} from "../src/server/db/repository";
import { guidance, outOfScope, syntheticCitation } from "./fixtures/contracts";
import { createTestDatabase } from "./helpers/d1";
import { seedTestSession } from "./helpers/session";

const NOW = "2026-10-05T12:00:00.000Z";
const DAY = 86_400_000;
const databases: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
async function fixture() {
  const database = await createTestDatabase();
  databases.push(database);
  const owner = await seedTestSession(database, { consent: true });
  const other = await seedTestSession(database, { consent: true });
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const key = btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  const cipher = await createCaseDataCipher({ CASE_DATA_KEY_V1: key });
  return { database, owner, other, cipher, repo: createDomainRepository(database.binding, cipher) };
}
function initial(ownerId: string, overrides: Partial<InitialCaseWrite> = {}): InitialCaseWrite {
  return {
    ownerId,
    caseId: crypto.randomUUID(),
    analysisId: crypto.randomUUID(),
    outboxId: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
    requestHash: "a".repeat(64),
    input: "합성 사건 원문 sentinel 🧪",
    now: NOW,
    ...overrides,
  };
}
function guard(
  p: InitialCaseWrite,
  expectedStatus: AnalysisGuard["expectedStatus"] = "queued",
): AnalysisGuard {
  return {
    ownerId: p.ownerId,
    caseId: p.caseId,
    analysisId: p.analysisId,
    inputRevision: 1,
    attempt: 1,
    expectedStatus,
  };
}
function domainCounts(f: Awaited<ReturnType<typeof fixture>>) {
  return ["cases", "analyses", "dispatch_outbox", "idempotency_records", "daily_usage"].map(
    (table) =>
      (f.database.sqlite.query(`SELECT count(*) AS count FROM ${table}`).get() as { count: number })
        .count,
  );
}
async function failure(operation: Promise<unknown>, code = "DB_OPERATION_FAILED") {
  const error = await operation.catch((value: unknown) => value);
  expect(error).toBeInstanceOf(DomainRepositoryError);
  expect((error as Error).message).toBe(code);
  expect((error as Error).cause).toBeUndefined();
}
async function waiting(f: Awaited<ReturnType<typeof fixture>>, p: InitialCaseWrite) {
  expect((await f.repo.commitInitialCase(p)).created).toBe(true);
  expect(await f.repo.compareAndSetAnalysis(guard(p), { status: "screening" }, NOW)).toBe(true);
  expect(
    await f.repo.compareAndSetAnalysis(
      guard(p, "screening"),
      {
        status: "waiting_for_answers",
        questionsAsked: 2,
        clarificationExpiresAt: new Date(Date.parse(NOW) + DAY).toISOString(),
      },
      NOW,
    ),
  ).toBe(true);
  expect((await f.repo.findCase(p.ownerId, p.caseId))?.status).toBe("needs_clarification");
  expect((await f.repo.findCurrentAnalysis(p.ownerId, p.caseId))?.status).toBe(
    "waiting_for_answers",
  );
}

describe("domain SQL and owner isolation", () => {
  test("signed sessions, current consent and encryption integrate without an auth bypass", async () => {
    const f = await fixture();
    const session = await getAuth(f.owner.env).api.getSession({
      headers: new Headers({ cookie: f.owner.cookie }),
    });
    expect(session?.user.id).toBe(f.owner.userId);
    const consent = await api.request(
      "/me/consent",
      { headers: { cookie: f.owner.cookie } },
      f.owner.env,
    );
    expect(consent.status).toBe(200);
    expect(((await consent.json()) as { needsConsent: boolean }).needsConsent).toBe(false);
    const p = initial(session?.user.id ?? "");
    expect((await f.repo.commitInitialCase(p)).created).toBe(true);
    expect(await f.repo.readInput(f.owner.userId, p.caseId)).toBe(p.input);
    expect(await f.repo.findCase(f.other.userId, p.caseId)).toBeNull();
    expect(await f.repo.readInput(f.other.userId, p.caseId)).toBeNull();
    expect(await f.repo.findCurrentAnalysis(f.other.userId, p.caseId)).toBeNull();
    expect(await f.repo.listCases(f.other.userId)).toEqual([]);
    expect(await f.repo.findCreateIdempotency(f.other.userId, p.idempotencyKey, NOW)).toBeNull();
    const row = await f.repo.findCase(f.owner.userId, p.caseId);
    expect(row?.encryptedInput).toMatch(/^v1\.1\./);
    expect(JSON.stringify(f.database.sqlite.query("SELECT * FROM cases").all())).not.toContain(
      "sentinel",
    );
    expect(
      JSON.stringify(f.database.sqlite.query("SELECT * FROM dispatch_outbox").all()),
    ).not.toContain("sentinel");
    expect(
      JSON.stringify(f.database.sqlite.query("SELECT * FROM idempotency_records").all()),
    ).not.toContain("sentinel");
    expect(
      await getAuth(f.owner.env).api.getSession({
        headers: new Headers({ cookie: "better-auth.session_token=tampered" }),
      }),
    ).toBeNull();
    f.database.sqlite
      .query("UPDATE user_consents SET privacy_version='old' WHERE user_id=?")
      .run(f.owner.userId);
    const stale = await api.request(
      "/me/consent",
      { headers: { cookie: f.owner.cookie } },
      f.owner.env,
    );
    expect(((await stale.json()) as { needsConsent: boolean }).needsConsent).toBe(true);
    expect(await f.repo.readInput(f.owner.userId, p.caseId)).toBe(p.input);
    expect(CURRENT_POLICY_VERSIONS.privacyVersion).not.toBe("old");
  });

  test("11 concurrent batches allow 10 complete admissions with no quota-rejected partial rows", async () => {
    const f = await fixture();
    const inputs = Array.from({ length: 11 }, () => initial(f.owner.userId));
    const results = await Promise.all(inputs.map((p) => f.repo.commitInitialCase(p)));
    expect(results.filter((r) => r.created)).toHaveLength(10);
    expect(domainCounts(f)).toEqual([10, 10, 10, 10, 1]);
    expect(await f.repo.getUsage(f.owner.userId, "2026-10-05")).toBe(10);
    const rejected = inputs[results.findIndex((r) => !r.created)];
    expect(rejected).toBeDefined();
    expect(await f.repo.findCase(f.owner.userId, rejected?.caseId ?? "")).toBeNull();
    const existing = inputs[results.findIndex((r) => r.created)];
    expect(
      (
        await f.repo.commitInitialCase({
          ...(existing as InitialCaseWrite),
          analysisId: crypto.randomUUID(),
          outboxId: crypto.randomUUID(),
          idempotencyKey: crypto.randomUUID(),
        })
      ).created,
    ).toBe(false);
    expect(domainCounts(f)).toEqual([10, 10, 10, 10, 1]);
    expect(f.database.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  test("quota is independent per owner and KST date including midnight", async () => {
    const f = await fixture();
    expect(usageDateKst("2026-10-05T14:59:59.999Z")).toBe("2026-10-05");
    expect(usageDateKst("2026-10-05T15:00:00.000Z")).toBe("2026-10-06");
    for (const p of [
      initial(f.owner.userId),
      initial(f.other.userId),
      initial(f.owner.userId, { now: "2026-10-05T15:00:00.000Z" }),
    ])
      expect((await f.repo.commitInitialCase(p)).created).toBe(true);
    expect(await f.repo.getUsage(f.owner.userId, "2026-10-05")).toBe(1);
    expect(await f.repo.getUsage(f.other.userId, "2026-10-05")).toBe(1);
    expect(await f.repo.getUsage(f.owner.userId, "2026-10-06")).toBe(1);
  });

  test("duplicate idempotency rolls back and expired keys can be reused atomically", async () => {
    const f = await fixture();
    const p = initial(f.owner.userId);
    await f.repo.commitInitialCase(p);
    await failure(
      f.repo.commitInitialCase(initial(f.owner.userId, { idempotencyKey: p.idempotencyKey })),
    );
    expect(domainCounts(f)).toEqual([1, 1, 1, 1, 1]);
    expect(await f.repo.getUsage(f.owner.userId, "2026-10-05")).toBe(1);
    const record = await f.repo.findCreateIdempotency(f.owner.userId, p.idempotencyKey, NOW);
    expect(record?.requestHash).toBe(p.requestHash);
    expect(JSON.parse(record?.responseJson ?? "{}").caseId).toBe(p.caseId);
    const nextDay = new Date(Date.parse(NOW) + DAY).toISOString();
    expect(
      await f.repo.findCreateIdempotency(f.owner.userId, p.idempotencyKey, nextDay),
    ).toBeNull();
    const replacement = initial(f.owner.userId, { idempotencyKey: p.idempotencyKey, now: nextDay });
    expect((await f.repo.commitInitialCase(replacement)).created).toBe(true);
    expect(domainCounts(f)).toEqual([2, 2, 2, 1, 2]);
    expect(
      JSON.parse(
        (await f.repo.findCreateIdempotency(f.owner.userId, p.idempotencyKey, nextDay))
          ?.responseJson ?? "{}",
      ).caseId,
    ).toBe(replacement.caseId);
  });

  test("late constraint failure rolls back all writes and preserves expired idempotency", async () => {
    const f = await fixture();
    const p = initial(f.owner.userId);
    await f.repo.commitInitialCase(p);
    const before = f.database.sqlite.query("SELECT * FROM idempotency_records").all();
    f.database.sqlite.exec(
      "CREATE TEMP TRIGGER fail_quota BEFORE INSERT ON daily_usage BEGIN SELECT RAISE(ABORT,'synthetic SQL private-parameters'); END",
    );
    await failure(
      f.repo.commitInitialCase(
        initial(f.owner.userId, {
          idempotencyKey: p.idempotencyKey,
          now: new Date(Date.parse(NOW) + DAY).toISOString(),
        }),
      ),
    );
    expect(domainCounts(f)).toEqual([1, 1, 1, 1, 1]);
    expect(f.database.sqlite.query("SELECT * FROM idempotency_records").all()).toEqual(before);
    f.database.sqlite.exec("DROP TRIGGER fail_quota");
    const missing = initial(crypto.randomUUID());
    expect((await f.repo.commitInitialCase(missing)).created).toBe(false);
    expect(domainCounts(f)).toEqual([1, 1, 1, 1, 1]);
  });

  test("stable pagination orders ties by UUID and never includes another owner's rows", async () => {
    const f = await fixture();
    for (let i = 0; i < 3; i++) await f.repo.commitInitialCase(initial(f.owner.userId));
    await f.repo.commitInitialCase(initial(f.other.userId));
    const all = await f.repo.listCases(f.owner.userId);
    const first = await f.repo.listCases(f.owner.userId, 2);
    const last = first.at(-1);
    if (!last) throw new Error("Synthetic row missing");
    const second = await f.repo.listCases(f.owner.userId, 2, {
      createdAt: last.createdAt,
      id: last.id,
    });
    expect([...first, ...second]).toEqual(all);
    expect(all).toHaveLength(3);
    expect(all.map((r) => r.id)).toEqual(
      all
        .map((r) => r.id)
        .sort()
        .reverse(),
    );
    await failure(f.repo.listCases(f.owner.userId, 51), "REPOSITORY_INPUT_INVALID");
  });

  test("SQL enforces FK, active uniqueness, status, revisions, attempts and terminal invariants", async () => {
    const f = await fixture();
    const p = initial(f.owner.userId);
    await f.repo.commitInitialCase(p);
    for (const sql of [
      "UPDATE cases SET status='draft'",
      "UPDATE cases SET input_revision=0",
      "UPDATE cases SET questions_asked=6",
      "UPDATE cases SET category='other'",
      "UPDATE cases SET jurisdiction='US'",
      "UPDATE cases SET title=''",
      "UPDATE analyses SET attempt=4",
      "UPDATE analyses SET input_revision=0",
      "UPDATE analyses SET status='completed'",
      "UPDATE analyses SET status='failed'",
      "UPDATE analyses SET failure_code='private-error'",
      "UPDATE daily_usage SET analysis_count=11",
      "UPDATE daily_usage SET analysis_count=1.5",
      "UPDATE cases SET questions_asked=1.5",
      "UPDATE cases SET input_revision=1.5",
      "UPDATE analyses SET input_revision=1.5",
      "UPDATE analyses SET attempt=1.5",
      "UPDATE dispatch_outbox SET attempt=1.5",
      "UPDATE dispatch_outbox SET revision=1.5",
      "UPDATE dispatch_outbox SET attempts=1.5",
      "UPDATE cases SET user_id='missing'",
      "UPDATE analyses SET case_id='missing'",
      "UPDATE dispatch_outbox SET state='unknown'",
    ])
      expect(() => f.database.sqlite.exec(sql)).toThrow();
    expect(() =>
      f.database.sqlite
        .query(
          "INSERT INTO analyses(id,case_id,workflow_instance_id,input_revision,attempt,status,created_at,updated_at) VALUES(?,?,?,1,1,'queued',?,?)",
        )
        .run(crypto.randomUUID(), p.caseId, crypto.randomUUID(), NOW, NOW),
    ).toThrow();
    f.database.sqlite.exec("UPDATE analyses SET status='superseded'");
    expect(() =>
      f.database.sqlite
        .query(
          "INSERT INTO analyses(id,case_id,workflow_instance_id,input_revision,attempt,status,created_at,updated_at) VALUES(?,?,?,1,1,'queued',?,?)",
        )
        .run(crypto.randomUUID(), p.caseId, `${p.analysisId}-1`, NOW, NOW),
    ).toThrow();
    expect(f.database.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});

describe("revision and deletion guards", () => {
  test("valid clarification updates both states once; stale, partial and repeated transitions change neither", async () => {
    const f = await fixture();
    const p = initial(f.owner.userId);
    await waiting(f, p);
    const before = await f.repo.findCase(p.ownerId, p.caseId);
    expect(
      await f.repo.compareAndSetAnalysis(
        guard(p, "screening"),
        {
          status: "waiting_for_answers",
          questionsAsked: 2,
          clarificationExpiresAt: new Date(Date.parse(NOW) + DAY).toISOString(),
        },
        NOW,
      ),
    ).toBe(false);
    expect(await f.repo.findCase(p.ownerId, p.caseId)).toEqual(before);
    expect((await f.repo.findCurrentAnalysis(p.ownerId, p.caseId))?.status).toBe(
      "waiting_for_answers",
    );
    for (const patch of [
      { status: "failed" as const, failureCode: "INTERNAL_ERROR" as const, questionsAsked: 1 },
      {
        status: "failed" as const,
        failureCode: "INTERNAL_ERROR" as const,
        clarificationExpiresAt: NOW,
      },
    ])
      await failure(
        f.repo.compareAndSetAnalysis(guard(p, "waiting_for_answers"), patch, NOW),
        "REPOSITORY_INPUT_INVALID",
      );
  });

  test("revision CAS has one winner; stale readers cannot write checkpoints, results or citations", async () => {
    const f = await fixture();
    const p = initial(f.owner.userId);
    await waiting(f, p);
    const stale = guard(p, "waiting_for_answers");
    const candidates = Array.from({ length: 2 }, () => ({
      analysisId: crypto.randomUUID(),
      outboxId: crypto.randomUUID(),
      input: "합성 서술 + 답변",
      answers: "합성 답변",
    }));
    const results = await Promise.all(
      candidates.map((next) => f.repo.advanceRevision(stale, next, NOW)),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    const current = await f.repo.findCurrentAnalysis(p.ownerId, p.caseId);
    expect(current?.inputRevision).toBe(2);
    expect(current?.status).toBe("queued");
    expect((await f.repo.findCase(p.ownerId, p.caseId))?.questionsAsked).toBe(2);
    expect(await f.repo.saveCheckpoint(stale, "late synthetic output", NOW)).toBe(false);
    expect(await f.repo.saveCitation(stale, syntheticCitation)).toBe(false);
    expect(
      await f.repo.compareAndSetAnalysis(
        stale,
        { status: "failed", failureCode: "INTERNAL_ERROR" },
        NOW,
      ),
    ).toBe(false);
    expect(
      await f.repo.saveCheckpoint({ ...stale, ownerId: f.other.userId }, "attacker", NOW),
    ).toBe(false);
    const row = f.database.sqlite
      .query("SELECT encrypted_answers FROM analyses WHERE id=?")
      .get(p.analysisId) as { encrypted_answers: string };
    expect(
      await f.cipher.decrypt(row.encrypted_answers, {
        table: "analyses",
        column: "encrypted_answers",
        rowId: p.analysisId,
        userId: p.ownerId,
      }),
    ).toBe("합성 답변");
    const newer = {
      ...stale,
      analysisId: current?.id ?? "",
      inputRevision: 2,
      expectedStatus: "queued" as const,
    };
    expect(await f.repo.compareAndSetAnalysis(newer, { status: "screening" }, NOW)).toBe(true);
    await failure(
      f.repo.compareAndSetAnalysis(
        { ...newer, expectedStatus: "screening" },
        {
          status: "waiting_for_answers",
          questionsAsked: 1,
          clarificationExpiresAt: new Date(Date.parse(NOW) + DAY).toISOString(),
        },
        NOW,
      ),
      "REPOSITORY_INPUT_INVALID",
    );
    expect(await f.repo.getUsage(p.ownerId, "2026-10-05")).toBe(1);
  });

  test("expired or stale revision claims are no-ops and middle failure rolls the whole replacement back", async () => {
    const f = await fixture();
    const p = initial(f.owner.userId);
    await waiting(f, p);
    const g = guard(p, "waiting_for_answers");
    const replacement = {
      analysisId: crypto.randomUUID(),
      outboxId: p.outboxId,
      input: "new",
      answers: "answer",
    };
    const before = await f.repo.findCase(p.ownerId, p.caseId);
    expect(await f.repo.advanceRevision({ ...g, inputRevision: 2 }, replacement, NOW)).toBe(false);
    expect(
      await f.repo.advanceRevision(g, replacement, new Date(Date.parse(NOW) + DAY).toISOString()),
    ).toBe(false);
    await failure(f.repo.advanceRevision(g, replacement, NOW));
    expect(await f.repo.findCase(p.ownerId, p.caseId)).toEqual(before);
    expect((await f.repo.findCurrentAnalysis(p.ownerId, p.caseId))?.status).toBe(
      "waiting_for_answers",
    );
    expect(domainCounts(f)).toEqual([1, 1, 1, 1, 1]);
  });

  test("terminal policy/guidance branches are enforced and encrypted results preserve their AAD", async () => {
    const f = await fixture();
    const p = initial(f.owner.userId);
    await f.repo.commitInitialCase(p);
    expect(await f.repo.compareAndSetAnalysis(guard(p), { status: "screening" }, NOW)).toBe(true);
    await failure(
      f.repo.compareAndSetAnalysis(
        guard(p, "screening"),
        { status: "completed", result: guidance },
        NOW,
      ),
      "REPOSITORY_INPUT_INVALID",
    );
    expect(
      await f.repo.compareAndSetAnalysis(
        guard(p, "screening"),
        { status: "completed", result: outOfScope },
        NOW,
      ),
    ).toBe(true);
    const row = await f.repo.findCurrentAnalysis(p.ownerId, p.caseId);
    const result = await f.cipher.decrypt(row?.encryptedResult ?? "", {
      table: "analyses",
      column: "encrypted_result",
      rowId: p.analysisId,
      userId: p.ownerId,
    });
    expect(JSON.parse(result)).toEqual(outOfScope);
    expect((await f.repo.findCase(p.ownerId, p.caseId))?.status).toBe("out_of_scope");
    expect(await f.repo.saveCheckpoint(guard(p, "screening"), "late", NOW)).toBe(false);
  });

  test("guarded citation/checkpoint writes succeed only for current owner and are cascaded on journalled deletion", async () => {
    const f = await fixture();
    const p = initial(f.owner.userId);
    await f.repo.commitInitialCase(p);
    expect(await f.repo.saveCheckpoint(guard(p), "synthetic checkpoint", NOW)).toBe(true);
    expect(await f.repo.saveCitation(guard(p), syntheticCitation)).toBe(true);
    expect(await f.repo.listCitations(f.other.userId, p.caseId)).toEqual([]);
    expect(await f.repo.listCitations(p.ownerId, p.caseId)).toHaveLength(1);
    expect(await f.repo.deleteOwnedCase(f.other.userId, p.caseId, crypto.randomUUID(), NOW)).toBe(
      false,
    );
    const job = crypto.randomUUID();
    expect(await f.repo.deleteOwnedCase(p.ownerId, p.caseId, job, NOW)).toBe(true);
    expect(await f.repo.findCase(p.ownerId, p.caseId)).toBeNull();
    expect(await f.repo.deleteOwnedCase(p.ownerId, p.caseId, crypto.randomUUID(), NOW)).toBe(false);
    expect(await f.repo.saveCheckpoint(guard(p), "late", NOW)).toBe(false);
    expect(await f.repo.saveCitation(guard(p), { ...syntheticCitation, id: "late" })).toBe(false);
    expect(await f.repo.compareAndSetAnalysis(guard(p), { status: "screening" }, NOW)).toBe(false);
    expect(f.database.sqlite.query("SELECT * FROM analyses").all()).toEqual([]);
    expect(f.database.sqlite.query("SELECT * FROM citations").all()).toEqual([]);
    expect(f.database.sqlite.query("SELECT * FROM dispatch_outbox").all()).toEqual([]);
    const journal = f.database.sqlite.query("SELECT * FROM deletion_jobs WHERE id=?").get(job) as {
      workflow_instance_ids: string;
    };
    expect(JSON.parse(journal.workflow_instance_ids)).toEqual([`${p.analysisId}-1`]);
    expect(JSON.stringify(journal)).not.toContain("sentinel");
    f.database.sqlite.query("DELETE FROM user WHERE id=?").run(p.ownerId);
    expect(f.database.sqlite.query("SELECT * FROM deletion_jobs").all()).toHaveLength(1);
    expect(f.database.sqlite.query("SELECT * FROM daily_usage").all()).toEqual([]);
    expect(f.database.sqlite.query("SELECT * FROM idempotency_records").all()).toEqual([]);
  });

  test("public legal cache verifies hash, expires, upserts and survives account deletion", async () => {
    const f = await fixture();
    const body = "공개 합성 법령 원문";
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
    const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join(
      "",
    );
    const metadata = {
      ...syntheticCitation,
      sourceId: syntheticCitation.sourceId.replace(syntheticCitation.contentHash, hash),
      contentHash: hash,
    };
    const expiry = new Date(Date.parse(NOW) + DAY).toISOString();
    await f.repo.putLegalSource(metadata, body, NOW, expiry);
    await f.repo.putLegalSource(metadata, body, NOW, expiry);
    expect((await f.repo.findLegalSource(metadata, NOW))?.body).toBe(body);
    expect(await f.repo.findLegalSource(metadata, expiry)).toBeNull();
    await failure(
      f.repo.putLegalSource(metadata, "tampered", NOW, expiry),
      "REPOSITORY_INPUT_INVALID",
    );
    await failure(
      f.repo.putLegalSource(metadata, body, NOW, new Date(Date.parse(NOW) + DAY + 1).toISOString()),
      "REPOSITORY_INPUT_INVALID",
    );
    f.database.sqlite.query("DELETE FROM user WHERE id=?").run(f.owner.userId);
    expect(f.database.sqlite.query("SELECT * FROM legal_source_cache").all()).toHaveLength(1);
    expect(f.database.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});

test("a failure in the final question-count write rolls back both case and analysis state", async () => {
  const f = await fixture();
  const p = initial(f.owner.userId);
  await f.repo.commitInitialCase(p);
  await f.repo.compareAndSetAnalysis(guard(p), { status: "screening" }, NOW);
  const caseBefore = await f.repo.findCase(p.ownerId, p.caseId);
  const analysisBefore = await f.repo.findCurrentAnalysis(p.ownerId, p.caseId);
  f.database.sqlite.exec(
    "CREATE TEMP TRIGGER fail_question_count BEFORE UPDATE OF questions_asked ON cases BEGIN SELECT RAISE(ABORT,'synthetic private SQL detail'); END",
  );
  await failure(
    f.repo.compareAndSetAnalysis(
      guard(p, "screening"),
      {
        status: "waiting_for_answers",
        questionsAsked: 2,
        clarificationExpiresAt: new Date(Date.parse(NOW) + DAY).toISOString(),
      },
      NOW,
    ),
  );
  expect(await f.repo.findCase(p.ownerId, p.caseId)).toEqual(caseBefore);
  expect(await f.repo.findCurrentAnalysis(p.ownerId, p.caseId)).toEqual(analysisBefore);
  f.database.sqlite.exec("DROP TRIGGER fail_question_count");
});
