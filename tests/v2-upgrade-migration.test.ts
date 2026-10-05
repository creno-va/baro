import { afterEach, expect, test } from "bun:test";
import { type AnalysisStatus, type Citation, resultSchema } from "../src/contracts";
import { createCaseDataCipher, createEnvelopeCipher } from "../src/server/crypto";
import { createDomainRepository, usageDateKst } from "../src/server/db/repository";
import { createV2WorkspaceRepository } from "../src/server/db/v2-workspace";
import { readCase } from "../src/server/modules/cases/service";
import { guidance, questions, syntheticCitation } from "./fixtures/contracts";
import { createTestDatabase } from "./helpers/d1";
import { seedTestSession } from "./helpers/session";

const NOW = "2026-10-06T00:00:00.000Z";
const TOMORROW = "2026-10-07T00:00:00.000Z";
const OLD_KEY = btoa("u".repeat(32)).replace(/=+$/, "");
const NEW_KEY = btoa("v".repeat(32)).replace(/=+$/, "");
const databases: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

const preservedTables = [
  "user",
  "session",
  "account",
  "verification",
  "user_consents",
  "cases",
  "analyses",
  "citations",
  "daily_usage",
  "dispatch_outbox",
  "legal_source_cache",
  "deletion_jobs",
  "idempotency_records",
  "case_feedback",
] as const;

async function populatedV1() {
  // Apply the real committed 0000..0005 SQL before seeding; no v2 table exists yet.
  const database = await createTestDatabase({ throughMigration: "0005_deletion_cleanup" });
  databases.push(database);
  expect(
    database.sqlite.query("SELECT value FROM app_metadata WHERE key='schema_version'").get(),
  ).toEqual({ value: "0005_deletion_cleanup" });
  expect(
    database.sqlite.query("SELECT name FROM sqlite_master WHERE name LIKE 'v2_%'").all(),
  ).toEqual([]);
  const owner = await seedTestSession(database, {
    now: Date.parse(NOW),
    consent: true,
    oauthAuthenticatedAt: Date.parse(NOW),
  });
  const other = await seedTestSession(database, {
    now: Date.parse(NOW),
    consent: true,
    oauthAuthenticatedAt: Date.parse(NOW),
  });
  const env = { ...owner.env, CASE_DATA_KEY_V1: OLD_KEY };
  const cipher = await createCaseDataCipher(env);
  const repository = createDomainRepository(database.binding, cipher);

  // SQL seeds only historical auth state and an already retained cleanup journal.
  // OAuth tokens are intentionally NULL; all identities/state are synthetic.
  for (const session of [owner, other]) {
    database.sqlite
      .query(
        "INSERT INTO account(id,user_id,provider_id,account_id,scope,created_at,updated_at) VALUES(?,?,'google',?,'openid email profile',?,?)",
      )
      .run(
        crypto.randomUUID(),
        session.userId,
        `synthetic-${session.userId}`,
        Date.parse(NOW),
        Date.parse(NOW),
      );
  }
  database.sqlite
    .query(
      "INSERT INTO verification(id,identifier,value,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?)",
    )
    .run(
      crypto.randomUUID(),
      "synthetic-oauth-state",
      "synthetic-verifier",
      Date.parse(TOMORROW),
      Date.parse(NOW),
      Date.parse(NOW),
    );
  const retainedJournal = crypto.randomUUID();
  database.sqlite
    .query(
      "INSERT INTO deletion_jobs(id,target_type,target_id,deleted_at,workflow_instance_ids,primary_state,cleanup_state,attempts,expires_at,cleanup_cursor,next_attempt_at) VALUES(?,'case',?,?,'[\"synthetic-retained-workflow\"]','deleted','failed',2,?,1,?)",
    )
    .run(retainedJournal, crypto.randomUUID(), NOW, "2026-11-10T00:00:00.000Z", TOMORROW);
  // Opaque key/version provenance marker, never an encryption key or token.
  database.sqlite
    .query(
      "INSERT INTO app_metadata(key,value,updated_at) VALUES('synthetic-key-provenance','envelope-v1/key-id-1',?)",
    )
    .run(NOW);

  async function create(ownerId: string, input: string) {
    const value = {
      ownerId,
      caseId: crypto.randomUUID(),
      analysisId: crypto.randomUUID(),
      outboxId: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      requestHash: "a".repeat(64),
      input,
      now: NOW,
    };
    expect((await repository.commitInitialCase(value)).created).toBe(true);
    return value;
  }
  const initial = await create(owner.userId, "합성 기존 사건: 질문 전 서술입니다.");
  const ownerQueued = await create(owner.userId, "합성 기존 사건: 아직 실행되지 않은 작업입니다.");
  const otherQueued = await create(other.userId, "합성 다른 소유자의 사건입니다.");
  const guard = (analysisId: string, revision: number, status: AnalysisStatus) => ({
    ownerId: owner.userId,
    caseId: initial.caseId,
    analysisId,
    inputRevision: revision,
    attempt: 1,
    expectedStatus: status,
  });
  const oldCheckpoint = JSON.stringify({ schemaVersion: "1", questions, phase: "questions" });
  expect(
    await repository.compareAndSetCheckpoint(
      guard(initial.analysisId, 1, "queued"),
      null,
      oldCheckpoint,
      NOW,
    ),
  ).toBe(true);
  expect(
    await repository.compareAndSetAnalysis(
      guard(initial.analysisId, 1, "queued"),
      { status: "screening" },
      NOW,
    ),
  ).toBe(true);
  expect(
    await repository.compareAndSetAnalysis(
      guard(initial.analysisId, 1, "screening"),
      {
        status: "waiting_for_answers",
        questionsAsked: questions.length,
        clarificationExpiresAt: TOMORROW,
      },
      NOW,
    ),
  ).toBe(true);
  const answers = JSON.stringify({
    answers: [{ questionId: "q1", value: "합성 날짜는 아직 모릅니다." }],
  });
  const input = "합성 기존 사건: 답변을 추가한 서술입니다.";
  const analysisId = crypto.randomUUID();
  expect(
    await repository.advanceRevision(
      guard(initial.analysisId, 1, "waiting_for_answers"),
      {
        analysisId,
        outboxId: crypto.randomUUID(),
        input,
        answers,
        idempotency: { key: crypto.randomUUID(), requestHash: "b".repeat(64) },
      },
      NOW,
    ),
  ).toBe(true);
  const checkpoint = JSON.stringify({ schemaVersion: "1", phase: "validated", synthetic: true });
  expect(
    await repository.compareAndSetCheckpoint(guard(analysisId, 2, "queued"), null, checkpoint, NOW),
  ).toBe(true);
  const body = "합성 법령 캐시 본문. 실제 법률 검증 자료가 아닙니다.";
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)),
  );
  const hash = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const citation: Citation = {
    ...syntheticCitation,
    sourceId: `statute:1:2026-01-01:1:${hash}`,
    verifiedAt: NOW,
    contentHash: hash,
  };
  const result = resultSchema.parse({ ...guidance, asOfDate: "2026-10-06", citations: [citation] });
  await repository.putLegalSource(citation, body, NOW, TOMORROW);
  for (const [before, after] of [
    ["queued", "retrieving"],
    ["retrieving", "generating"],
    ["generating", "validating"],
  ] as const) {
    expect(
      await repository.compareAndSetAnalysis(guard(analysisId, 2, before), { status: after }, NOW),
    ).toBe(true);
  }
  expect(
    await repository.compareAndSetAnalysis(
      guard(analysisId, 2, "validating"),
      { status: "completed", result },
      NOW,
    ),
  ).toBe(true);
  // Historical optional feedback is SQL-seeded because the upgrade tests preserve rows,
  // not the later feedback API behavior.
  database.sqlite
    .query("INSERT INTO case_feedback(case_id,analysis_id,helpful,updated_at) VALUES(?,?,1,?)")
    .run(initial.caseId, analysisId, NOW);
  const before = new Map(
    preservedTables.map((table) => [
      table,
      database.sqlite.query(`SELECT * FROM ${table} ORDER BY rowid`).all(),
    ]),
  );
  const metadata = database.sqlite
    .query("SELECT * FROM app_metadata WHERE key!='schema_version' ORDER BY key")
    .all();
  expect(database.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
  return {
    database,
    owner,
    other,
    env,
    cipher,
    repository,
    initial,
    analysisId,
    ownerQueued,
    otherQueued,
    input,
    answers,
    oldCheckpoint,
    checkpoint,
    result,
    citation,
    body,
    before,
    metadata,
    retainedJournal,
  };
}

async function upgrade(f: Awaited<ReturnType<typeof populatedV1>>) {
  // This is the owner's actual generated additive migration, not reconstructed DDL.
  f.database.sqlite.exec(await Bun.file("drizzle/0006_v2_domain_foundation.sql").text());
  expect(
    f.database.sqlite.query("SELECT value FROM app_metadata WHERE key='schema_version'").get(),
  ).toEqual({ value: "0006_v2_domain_foundation" });
  expect(f.database.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
}

function previousRows(
  f: Awaited<ReturnType<typeof populatedV1>>,
  table: (typeof preservedTables)[number],
) {
  const rows = f.before.get(table);
  if (!rows) throw new Error("Legacy table snapshot is missing");
  return rows;
}

test("populated actual 0005→0006 preserves every legacy auth/domain/cache/quota/journal row and real AES reads", async () => {
  const f = await populatedV1();
  const detailBefore = await readCase(
    f.repository,
    f.env,
    f.owner.userId,
    f.initial.caseId,
    "synthetic-before-upgrade",
  );
  await upgrade(f);
  for (const table of preservedTables) {
    expect(f.database.sqlite.query(`SELECT * FROM ${table} ORDER BY rowid`).all()).toEqual(
      previousRows(f, table),
    );
  }
  expect(
    f.database.sqlite
      .query("SELECT * FROM app_metadata WHERE key!='schema_version' ORDER BY key")
      .all(),
  ).toEqual(f.metadata);
  const repository = createDomainRepository(f.database.binding, f.cipher);
  expect(await repository.readInput(f.owner.userId, f.initial.caseId)).toBe(f.input);
  expect(
    await readCase(repository, f.env, f.owner.userId, f.initial.caseId, "synthetic-after-upgrade"),
  ).toEqual(detailBefore);
  expect(detailBefore?.result).toEqual(f.result);
  expect((await repository.findCurrentAnalysis(f.owner.userId, f.initial.caseId))?.id).toBe(
    f.analysisId,
  );
  expect(
    (await repository.listCitations(f.owner.userId, f.initial.caseId)).map(
      (row) => row.contentHash,
    ),
  ).toEqual([f.citation.contentHash]);
  expect((await repository.findLegalSource(f.citation, NOW))?.body).toBe(f.body);
  expect(
    (await repository.findLatestLegalSource("1", f.citation.article, "2026-10-06", NOW))
      ?.contentHash,
  ).toBe(f.citation.contentHash);
  expect(await repository.getUsage(f.owner.userId, usageDateKst(NOW))).toBe(2);
  expect(
    (await repository.findCreateIdempotency(f.owner.userId, f.initial.idempotencyKey, NOW))
      ?.requestHash,
  ).toBe(f.initial.requestHash);
  expect((await repository.findCurrentAnalysis(f.owner.userId, f.ownerQueued.caseId))?.status).toBe(
    "queued",
  );
  expect(await repository.readInput(f.other.userId, f.initial.caseId)).toBeNull();
  expect(await repository.findCurrentAnalysis(f.other.userId, f.initial.caseId)).toBeNull();
  expect(await repository.listCitations(f.other.userId, f.initial.caseId)).toEqual([]);
  expect((await repository.listCases(f.owner.userId)).map((row) => row.id).sort()).toEqual(
    [f.initial.caseId, f.ownerQueued.caseId].sort(),
  );
  const rows = f.database.sqlite
    .query(
      "SELECT id,encrypted_context,encrypted_answers,encrypted_result FROM analyses WHERE case_id=? ORDER BY input_revision",
    )
    .all(f.initial.caseId) as Array<{
    id: string;
    encrypted_context: string;
    encrypted_answers: string | null;
    encrypted_result: string | null;
  }>;
  expect(rows).toHaveLength(2);
  const [historical, current] = rows;
  if (!historical || !current) throw new Error("Synthetic historical revisions are missing");
  const rotated = await createEnvelopeCipher({
    activeKeyId: "2",
    keys: { "1": OLD_KEY, "2": NEW_KEY },
  });
  const record = await repository.findCase(f.owner.userId, f.initial.caseId);
  if (!record) throw new Error("Legacy encrypted case is missing");
  const inputContext = {
    table: "cases" as const,
    column: "encrypted_input" as const,
    rowId: f.initial.caseId,
    userId: f.owner.userId,
  };
  expect(record.encryptedInput.startsWith("v1.1.")).toBe(true);
  expect(await rotated.decrypt(record.encryptedInput, inputContext)).toBe(f.input);
  await expect(
    rotated.decrypt(record.encryptedInput, { ...inputContext, userId: f.other.userId }),
  ).rejects.toThrow("CRYPTO_DECRYPT_FAILED");
  await expect(
    rotated.decrypt(record.encryptedInput, { ...inputContext, rowId: crypto.randomUUID() }),
  ).rejects.toThrow("CRYPTO_DECRYPT_FAILED");
  for (const [row, column, plaintext] of [
    [historical, "encrypted_context", f.oldCheckpoint],
    [historical, "encrypted_answers", f.answers],
    [current, "encrypted_context", f.checkpoint],
    [current, "encrypted_result", JSON.stringify(f.result)],
  ] as const) {
    const ciphertext = row[column];
    if (!ciphertext) throw new Error("Synthetic encrypted field is missing");
    const context = { table: "analyses" as const, column, rowId: row.id, userId: f.owner.userId };
    expect(ciphertext.startsWith("v1.1.")).toBe(true);
    expect(await rotated.decrypt(ciphertext, context)).toBe(plaintext);
    await expect(
      rotated.decrypt(ciphertext, { ...context, userId: f.other.userId }),
    ).rejects.toThrow("CRYPTO_DECRYPT_FAILED");
    await expect(
      rotated.decrypt(ciphertext, { ...context, rowId: crypto.randomUUID() }),
    ).rejects.toThrow("CRYPTO_DECRYPT_FAILED");
    await expect(
      rotated.decrypt(ciphertext, {
        ...context,
        column: column === "encrypted_result" ? "encrypted_context" : "encrypted_result",
      }),
    ).rejects.toThrow("CRYPTO_DECRYPT_FAILED");
  }
  // Active-key changes never silently reencrypt or rewrite existing envelopes.
  expect(
    await createDomainRepository(f.database.binding, rotated).readInput(
      f.owner.userId,
      f.initial.caseId,
    ),
  ).toBe(f.input);
  expect(f.database.sqlite.query("SELECT * FROM analyses ORDER BY rowid").all()).toEqual(
    previousRows(f, "analyses"),
  );
});

test("after actual v2 upgrade the v1 owner delete still cascades historical/current revisions while preserving other data", async () => {
  const f = await populatedV1();
  await upgrade(f);
  const repository = createDomainRepository(f.database.binding, f.cipher);
  const jobId = crypto.randomUUID();
  const key = crypto.randomUUID();
  expect(
    await repository.deleteOwnedCase(f.other.userId, f.initial.caseId, crypto.randomUUID(), NOW),
  ).toBe(false);
  expect(
    await repository.deleteOwnedCase(f.owner.userId, f.initial.caseId, jobId, NOW, {
      key,
      requestHash: "c".repeat(64),
    }),
  ).toBe(true);
  expect(await repository.findCase(f.owner.userId, f.initial.caseId)).toBeNull();
  expect(
    await readCase(repository, f.env, f.owner.userId, f.initial.caseId, "synthetic-deleted"),
  ).toBeNull();
  for (const table of ["analyses", "case_feedback"] as const) {
    expect(
      f.database.sqlite.query(`SELECT * FROM ${table} WHERE case_id=?`).all(f.initial.caseId),
    ).toEqual([]);
  }
  expect(
    f.database.sqlite
      .query("SELECT * FROM citations WHERE analysis_id IN (?,?)")
      .all(f.initial.analysisId, f.analysisId),
  ).toEqual([]);
  expect(
    f.database.sqlite
      .query("SELECT * FROM dispatch_outbox WHERE analysis_id IN (?,?)")
      .all(f.initial.analysisId, f.analysisId),
  ).toEqual([]);
  const journal = f.database.sqlite
    .query(
      "SELECT target_type,target_id,primary_state,cleanup_state,workflow_instance_ids FROM deletion_jobs WHERE id=?",
    )
    .get(jobId) as {
    target_type: string;
    target_id: string;
    primary_state: string;
    cleanup_state: string;
    workflow_instance_ids: string;
  };
  expect(journal).toMatchObject({
    target_type: "case",
    target_id: f.initial.caseId,
    primary_state: "deleted",
    cleanup_state: "pending",
  });
  expect(JSON.parse(journal.workflow_instance_ids).sort()).toEqual(
    [`${f.initial.analysisId}-1`, `${f.analysisId}-1`].sort(),
  );
  expect(
    (
      await repository.findIdempotency(
        f.owner.userId,
        "DELETE",
        `/api/cases/${f.initial.caseId}`,
        key,
        NOW,
      )
    )?.responseStatus,
  ).toBe(204);
  expect(
    f.database.sqlite.query("SELECT * FROM deletion_jobs WHERE id=?").get(f.retainedJournal),
  ).toEqual(
    (f.before.get("deletion_jobs") as Array<{ id: string }>).find(
      (row) => row.id === f.retainedJournal,
    ),
  );
  for (const table of [
    "user",
    "session",
    "account",
    "verification",
    "user_consents",
    "daily_usage",
    "legal_source_cache",
  ] as const) {
    expect(f.database.sqlite.query(`SELECT * FROM ${table} ORDER BY rowid`).all()).toEqual(
      previousRows(f, table),
    );
  }
  expect(await repository.readInput(f.owner.userId, f.ownerQueued.caseId)).toBe(
    f.ownerQueued.input,
  );
  expect(await repository.readInput(f.other.userId, f.otherQueued.caseId)).toBe(
    f.otherQueued.input,
  );
  expect(f.database.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
});

test("actual upgraded database admits a new v2 workspace with real AES and shares the cutover legacy creation quota", async () => {
  const f = await populatedV1();
  await upgrade(f);
  const rotated = await createEnvelopeCipher({
    activeKeyId: "2",
    keys: { "1": OLD_KEY, "2": NEW_KEY },
  });
  const workspaces = createV2WorkspaceRepository(f.database.binding, rotated);
  const actor = { ownerId: f.owner.userId, now: NOW };
  const id = crypto.randomUUID();
  const admission = {
    operationId: crypto.randomUUID(),
    key: crypto.randomUUID(),
    requestHash: "d".repeat(64),
  };
  const request = {
    narrative: "합성 신규 v2 기업 사건의 사실관계를 정리하는 서술입니다.",
    jurisdiction: "KR" as const,
    subjectContext: "company" as const,
    turnstileToken: "synthetic-no-provider-request",
  };
  expect((await workspaces.create(actor, id, request, admission)).kind).toBe("created");
  expect(await workspaces.findWorkspace(actor, id)).toMatchObject({
    schemaVersion: "2",
    subjectContext: "company",
    workspaceRevision: 1,
    intakeRevision: 1,
  });
  expect((await workspaces.readIntake(actor, id))?.narrative).toBe(request.narrative);
  expect(await workspaces.findWorkspace({ ...actor, ownerId: f.other.userId }, id)).toBeNull();
  expect(
    f.database.sqlite.query("SELECT encrypted_payload FROM v2_intakes WHERE id=?").get(id),
  ).toMatchObject({ encrypted_payload: expect.stringMatching(/^v1\.2\./) });
  expect(
    (
      await workspaces.create(actor, crypto.randomUUID(), request, {
        ...admission,
        operationId: crypto.randomUUID(),
        key: crypto.randomUUID(),
      })
    ).kind,
  ).toBe("rejected");
  expect(f.database.sqlite.query("SELECT count(*) AS count FROM v2_workspaces").get()).toEqual({
    count: 1,
  });
  expect(f.database.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
  for (const table of preservedTables) {
    expect(f.database.sqlite.query(`SELECT * FROM ${table} ORDER BY rowid`).all()).toEqual(
      previousRows(f, table),
    );
  }
});
