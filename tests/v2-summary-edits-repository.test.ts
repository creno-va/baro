import { afterEach, expect, test } from "bun:test";
import type { V2Fact, V2QuestionBatch, V2Summary } from "../src/contracts/v2";
import {
  createCaseDataCipher,
  type EncryptionContext,
  type EnvelopeCipher,
} from "../src/server/crypto";
import { createV2Core, fragmentText, utf8Bytes } from "../src/server/db/v2-core";
import { createV2JobsRepository } from "../src/server/db/v2-jobs";
import { createV2StagingRepository } from "../src/server/db/v2-staging";
import { createV2SummaryEditsRepository } from "../src/server/db/v2-summary-edits";
import { createV2SummaryStagingRepository } from "../src/server/db/v2-summary-staging";
import { createV2WorkspaceRepository } from "../src/server/db/v2-workspace";
import { createTestDatabase } from "./helpers/d1";
import { seedTestSession } from "./helpers/session";

const NOW = "2026-10-06T00:00:00.000Z";
const databases: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});
const admission = () => ({
  operationId: crypto.randomUUID(),
  key: crypto.randomUUID(),
  requestHash: "e".repeat(64),
});

async function fixture(large = false) {
  // Actual generated migration, SQLite transactions and AES envelopes. Only
  // authentication and the model's already validated summary are synthetic.
  const db = await createTestDatabase();
  databases.push(db);
  const owner = await seedTestSession(db, { now: Date.parse(NOW), consent: true });
  const stranger = await seedTestSession(db, { now: Date.parse(NOW), consent: true });
  const actor = { ownerId: owner.userId, now: NOW };
  const actual = await createCaseDataCipher({
    CASE_DATA_KEY_V1: btoa("s".repeat(32)).replace(/=+$/, ""),
  });
  let beforeEncrypt: ((context: EncryptionContext) => void | Promise<void>) | undefined;
  let afterDecrypt: ((context: EncryptionContext) => void | Promise<void>) | undefined;
  const decryptions: EncryptionContext[] = [];
  let failureBoundary = "repository";
  const cipher: EnvelopeCipher = {
    async encrypt(value, context) {
      await beforeEncrypt?.(context);
      try {
        return await actual.encrypt(value, context);
      } catch (error) {
        failureBoundary = `cipher-encrypt:${context.table}`;
        throw error;
      }
    },
    async decrypt(value, context) {
      const plaintext = await actual.decrypt(value, context);
      decryptions.push(context);
      await afterDecrypt?.(context);
      return plaintext;
    },
  };
  const statementSizes = new WeakMap<object, { bytes: number; parameters: number }>();
  const batches: { statements: number; bytes: number; parameters: number[] }[] = [];
  const binding = {
    prepare(sql: string) {
      const statement = db.binding.prepare(sql);
      const bind = statement.bind.bind(statement);
      statementSizes.set(statement, { bytes: utf8Bytes(sql), parameters: 0 });
      statement.bind = (...values: unknown[]) => {
        const bound = bind(...values);
        statementSizes.set(bound, {
          bytes:
            utf8Bytes(sql) +
            values.reduce<number>(
              (total, value) =>
                total +
                utf8Bytes(typeof value === "string" ? value : (JSON.stringify(value) ?? "null")),
              0,
            ),
          parameters: values.length,
        });
        return bound;
      };
      return statement;
    },
    async batch(statements: D1PreparedStatement[]) {
      const sizes = statements.map((statement) => statementSizes.get(statement));
      batches.push({
        statements: statements.length,
        bytes: sizes.reduce((total, value) => total + (value?.bytes ?? 0), 0),
        parameters: sizes.map((value) => value?.parameters ?? 0),
      });
      try {
        return await db.binding.batch(statements);
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? error.code : null;
        const message = error instanceof Error ? error.message : "";
        const category = message.includes("ambiguous column")
          ? "ambiguous-column"
          : message.includes("no such column")
            ? "missing-column"
            : message.includes("no such table")
              ? "missing-table"
              : message.includes("CHECK constraint")
                ? "check-constraint"
                : message.includes("FOREIGN KEY")
                  ? "foreign-key"
                  : message.includes("UNIQUE constraint")
                    ? "unique-constraint"
                    : message.includes("NOT NULL")
                      ? "not-null"
                      : message.includes("syntax error")
                        ? "syntax"
                        : typeof code === "string" && /^(ERR_)?SQLITE_[A-Z_]+$/.test(code)
                          ? code
                          : "unknown";
        failureBoundary = `batch:${category}`;
        throw error;
      }
    },
  } as unknown as D1Database;
  const core = createV2Core(binding, cipher);
  const ws = createV2WorkspaceRepository(binding, cipher);
  const jobs = createV2JobsRepository(core);
  const staging = createV2StagingRepository(core);
  const summaries = createV2SummaryStagingRepository(core);
  const id = crypto.randomUUID();
  const guard = () => ({
    ...actor,
    workspaceId: id,
    expectedRevision: (
      db.sqlite.query("SELECT revision FROM v2_workspaces WHERE id=?").get(id) as {
        revision: number;
      }
    ).revision,
  });
  expect(
    (
      await ws.create(
        actor,
        id,
        {
          narrative: "합성 사건의 원래 서술과 확인한 사실을 사용자 수정 전후에도 보존합니다.",
          subjectContext: "company",
          jurisdiction: "KR",
          turnstileToken: "synthetic",
        },
        admission(),
      )
    ).kind,
  ).toBe("created");
  async function start(kind: "intake_questions" | "intake_summary") {
    const jobId = crypto.randomUUID();
    expect(await jobs.admitWorkspace(guard(), admission(), jobId, kind)).toBe(true);
    const result = await jobs.acquire(
      actor,
      jobId,
      crypto.randomUUID(),
      "2026-10-06T00:04:00.000Z",
    );
    if (!result) throw new Error("Synthetic summary fixture lease unavailable");
    return result.lease;
  }
  const questionLease = await start("intake_questions");
  const questionId = crypto.randomUUID();
  const batch: V2QuestionBatch = {
    id: crypto.randomUUID(),
    ordinal: 1,
    generatedForIntakeRevision: 1,
    questions: [
      { id: questionId, prompt: "어떤 사실을 확인했나요?", answerType: "text", options: [] },
    ],
    answers: [],
  };
  expect(await ws.writeBatch(guard(), batch, questionLease)).toBe(true);
  expect(
    await ws.answer(guard(), batch.id, {
      expectedRevision: 1,
      answers: [{ questionId, status: "answered", value: "자료를 확인한 합성 사용자 진술입니다." }],
    }),
  ).toBe(true);
  const summaryLease = await start("intake_summary");
  const facts: V2Fact[] = Array.from({ length: large ? 300 : 5 }, (_, index) => ({
    // Deliberately reverse lexical order: copying by entity_id must not silently
    // reorder the user's original summary manifest.
    id: `fact-${String(300 - index).padStart(3, "0")}`,
    text: large ? "😀".repeat(2000) : `합성 사실 ${index}: "인용" \\ 경로 [{자료}]\n😀`,
    attribution: "user_statement",
    certainty: "reported",
    significance: index % 2 ? "favorable" : "neutral",
    references: Array.from({ length: large ? 100 : 1 }, () => ({
      kind: "intake_answer" as const,
      questionId,
      intakeRevision: 2,
    })),
    conflictingFactIds: [],
    userEdited: false,
  }));
  const summary: V2Summary = {
    schemaVersion: "2",
    revision: 1,
    intakeRevision: 2,
    createdAt: NOW,
    overview: "확인할 사항과 사용자 서술을 정리한 합성 요약입니다.",
    facts,
    parties: Array.from({ length: large ? 30 : 2 }, (_, index) => ({
      id: `party-${String(30 - index).padStart(2, "0")}`,
      label: large ? "가".repeat(200) : `합성 관계자 ${index}`,
      role: large ? "😀".repeat(300) : "자료 확인 대상",
    })),
    unknowns: ["당사자에게 확인할 사실"],
    notices: ["합성 검증이며 변호사의 법률 판단을 대신하지 않습니다."],
  };
  const text = JSON.stringify(summary);
  const parts = fragmentText(text);
  const snapshotId = crypto.randomUUID();
  expect(
    await staging.begin(
      guard(),
      {
        id: snapshotId,
        purpose: "summary",
        targetId: id,
        revision: 1,
        partCount: parts.length,
        byteLength: utf8Bytes(text),
      },
      summaryLease,
    ),
  ).toBe(true);
  for (const [index, part] of parts.entries()) {
    expect(await staging.append(guard(), snapshotId, index, part, summaryLease)).toBe(true);
  }
  for (let index = 0; index < Math.max(facts.length, summary.parties.length); index += 4) {
    expect(
      await summaries.stagePage(
        guard(),
        snapshotId,
        {
          facts: facts.slice(index, index + 4),
          parties: summary.parties.slice(index, index + 4),
        },
        summaryLease,
      ),
    ).toBe(true);
  }
  expect(
    await staging.seal(
      guard(),
      snapshotId,
      {
        schemaVersion: "2",
        purpose: "summary",
        targetId: id,
        revision: 1,
      },
      summaryLease,
    ),
  ).toBe(true);
  const summaryId = crypto.randomUUID();
  expect(
    await summaries.publish(
      guard(),
      snapshotId,
      {
        summaryId,
        summaryRevision: 1,
        intakeRevision: 2,
        factCount: facts.length,
        partyCount: summary.parties.length,
      },
      summaryLease,
    ),
  ).toBe(true);
  batches.length = 0;
  decryptions.length = 0;
  return {
    db,
    binding,
    core,
    actor,
    stranger: { ownerId: stranger.userId, now: NOW },
    ws,
    jobs,
    staging,
    summaries,
    edits: createV2SummaryEditsRepository(core),
    id,
    snapshotId,
    summaryId,
    summary,
    guard,
    batches,
    decryptions,
    cipher,
    actual,
    failure: () => failureBoundary,
    onEncrypt: (hook?: typeof beforeEncrypt) => {
      beforeEncrypt = hook;
    },
    onDecrypt: (hook?: typeof afterDecrypt) => {
      afterDecrypt = hook;
    },
  };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
const editInput = (
  f: Fixture,
  request = {
    expectedRevision: 1,
    overview: "사용자가 수정하고 확인할 합성 사건 요약입니다.",
    factEdits: [
      { factId: f.summary.facts[0]?.id ?? "missing", text: "확인 후 수정한 사용자 진술" },
    ],
    unknowns: ["수정 후에도 확인할 사실"],
  },
) => ({
  id: crypto.randomUUID(),
  summaryId: f.summaryId,
  targetSnapshotId: crypto.randomUUID(),
  request,
  expiresAt: "2026-10-06T00:15:00.000Z",
});

async function drain(f: Fixture, id: string) {
  for (let step = 0; step < 10000; step++) {
    const before = f.decryptions.length;
    const result = await f.edits.advance(f.guard(), id).catch(() => {
      throw new Error(`Synthetic summary transform failure boundary: ${f.failure()}`);
    });
    expect(result).not.toBeNull();
    // The source can exceed 4MiB; each step reads at most four 64KiB source
    // pieces instead of decrypting the complete old manifest into memory.
    expect(
      f.decryptions
        .slice(before)
        .filter((context) => context.table === "v2_private_parts" && context.revision === 1).length,
    ).toBeLessThanOrEqual(4);
    if (result?.done) return;
  }
  throw new Error("Bounded summary transform did not terminate");
}

function assertBatchBounds(f: Fixture) {
  expect(f.batches.length).toBeGreaterThan(0);
  for (const batch of f.batches) {
    expect(batch.statements).toBeLessThanOrEqual(40);
    expect(batch.bytes).toBeLessThanOrEqual(2097152);
    expect(batch.parameters.every((count) => count <= 100)).toBe(true);
  }
}

function quotaRows(f: Fixture) {
  return f.db.sqlite.query("SELECT * FROM v2_daily_usage ORDER BY owner_id,day").all();
}

test("summary edit preserves old manifest and untouched entities, then confirms only the new revision", async () => {
  const f = await fixture();
  const input = editInput(f);
  const guard = f.guard();
  const quota = quotaRows(f);
  expect(await f.edits.begin(guard, input)).toBe(true);
  expect((await f.ws.readIntake(f.actor, f.id))?.summary).toEqual(f.summary);
  await drain(f, input.id);
  expect(await f.edits.advance(guard, input.id)).toEqual({ done: true });
  const newSummaryId = crypto.randomUUID();
  expect(await f.edits.publish(guard, input.id, newSummaryId)).toBe(true);
  const actual = await readManifest(f, input.targetSnapshotId);
  const firstEdit = input.request.factEdits[0];
  if (!firstEdit) throw new Error("Synthetic edit fixture missing");
  expect(actual).toEqual({
    ...f.summary,
    revision: 2,
    createdAt: NOW,
    overview: input.request.overview,
    unknowns: input.request.unknowns,
    facts: f.summary.facts.map((fact, index) =>
      index === 0 ? { ...fact, text: firstEdit.text, userEdited: true } : fact,
    ),
  });
  expect(await readManifest(f, f.snapshotId)).toEqual(f.summary);
  expect(quotaRows(f)).toEqual(quota);
  expect(f.guard().expectedRevision).toBe(guard.expectedRevision + 1);
  expect(await f.ws.confirmSummary(f.guard(), { expectedRevision: 2, summaryRevision: 1 })).toBe(
    false,
  );
  expect(await f.ws.confirmSummary(f.guard(), { expectedRevision: 2, summaryRevision: 2 })).toBe(
    true,
  );
  assertBatchBounds(f);
  expect(f.db.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
});

test("maximum 300 facts/30 parties/100 references survive a 100-fact edit through bounded AES steps", async () => {
  const f = await fixture(true);
  expect(utf8Bytes(JSON.stringify(f.summary))).toBeGreaterThan(4 * 1024 * 1024);
  const request = {
    expectedRevision: 1,
    overview: "최대 규모 사건의 사용자 수정 요약",
    factEdits: f.summary.facts.slice(0, 100).map((fact, index) => ({
      factId: fact.id,
      text: `최대 편집 ${index}: 확인한 합성 진술`,
    })),
    unknowns: ["계속 확인할 사항"],
  };
  const input = editInput(f, request);
  const quota = quotaRows(f);
  expect(await f.edits.begin(f.guard(), input)).toBe(true);
  await drain(f, input.id);
  expect(await f.edits.publish(f.guard(), input.id, crypto.randomUUID())).toBe(true);
  const result = await readManifest(f, input.targetSnapshotId);
  expect(result).toEqual({
    ...f.summary,
    revision: 2,
    createdAt: NOW,
    overview: request.overview,
    unknowns: request.unknowns,
    facts: f.summary.facts.map((fact) => {
      const edit = request.factEdits.find((item) => item.factId === fact.id);
      return edit ? { ...fact, text: edit.text, userEdited: true } : fact;
    }),
  });
  expect(await readManifest(f, f.snapshotId)).toEqual(f.summary);
  const facts: V2Fact[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await f.summaries.factsPage(f.actor, f.id, 2, cursor, 4);
    facts.push(...page.facts);
    if (!page.nextId) break;
    cursor = page.nextId;
  }
  expect(facts).toHaveLength(300);
  expect(facts.map((fact) => fact.id).sort()).toEqual(result.facts.map((fact) => fact.id).sort());
  for (const fact of facts) {
    const expected = result.facts.find((item) => item.id === fact.id);
    if (!expected) throw new Error("Transformed fact missing from immutable manifest");
    expect(fact).toEqual(expected);
  }
  expect(quotaRows(f)).toEqual(quota);
  assertBatchBounds(f);
  await expect(f.ws.readIntake(f.actor, f.id)).rejects.toThrow("SNAPSHOT_STREAM_REQUIRED");
  expect(await f.ws.confirmSummary(f.guard(), { expectedRevision: 2, summaryRevision: 2 })).toBe(
    true,
  );
}, 60000);

test("foreign and stale workspace guards cannot begin or read a pending edit", async () => {
  const f = await fixture();
  const input = editInput(f);
  expect(await f.edits.begin({ ...f.guard(), ownerId: f.stranger.ownerId }, input)).toBe(false);
  expect(await f.edits.begin({ ...f.guard(), expectedRevision: 999 }, input)).toBe(false);
  expect(f.decryptions).toHaveLength(0);
  expect(await f.edits.begin(f.guard(), input)).toBe(true);
  f.decryptions.length = 0;
  expect(await f.edits.advance({ ...f.guard(), ownerId: f.stranger.ownerId }, input.id)).toBeNull();
  expect(
    await f.edits.publish(
      { ...f.guard(), ownerId: f.stranger.ownerId },
      input.id,
      crypto.randomUUID(),
    ),
  ).toBe(false);
  expect(f.decryptions).toHaveLength(0);
});

test("incomplete transformed output cannot replace the current approved summary", async () => {
  const f = await fixture();
  const input = editInput(f);
  expect(await f.edits.begin(f.guard(), input)).toBe(true);
  expect(await f.edits.publish(f.guard(), input.id, crypto.randomUUID())).toBe(false);
  expect((await f.ws.readIntake(f.actor, f.id))?.summary).toEqual(f.summary);
  await drain(f, input.id);
  expect(await f.edits.publish(f.guard(), input.id, crypto.randomUUID())).toBe(true);
});

test("source workspace mutation fences both transform and final publication", async () => {
  const f = await fixture();
  const input = editInput(f);
  const stale = f.guard();
  expect(await f.edits.begin(stale, input)).toBe(true);
  expect(await f.ws.changeState(stale, "archive")).toBe(true);
  expect(await f.edits.advance(stale, input.id)).toBeNull();
  expect(await f.edits.publish(stale, input.id, crypto.randomUUID())).toBe(false);
  expect(await f.edits.advance(f.guard(), input.id)).toBeNull();
  expect(await readManifest(f, f.snapshotId)).toEqual(f.summary);
});

test("owner abandonment removes staged output and cannot delete the source summary", async () => {
  const f = await fixture();
  const input = editInput(f);
  expect(await f.edits.begin(f.guard(), input)).toBe(true);
  expect(await f.edits.advance(f.guard(), input.id)).not.toBeNull();
  expect(await f.edits.abandon({ ...f.guard(), ownerId: f.stranger.ownerId }, input.id)).toBe(
    false,
  );
  expect(await f.edits.abandon(f.guard(), input.id)).toBe(true);
  expect(await f.edits.advance(f.guard(), input.id)).toBeNull();
  expect(
    f.db.sqlite.query("SELECT id FROM v2_private_snapshots WHERE id=?").get(input.targetSnapshotId),
  ).toBeNull();
  expect(await readManifest(f, f.snapshotId)).toEqual(f.summary);
});

test("expiration rejects further processing and publication without dropping the old summary", async () => {
  const f = await fixture();
  const input = editInput(f);
  expect(await f.edits.begin(f.guard(), input)).toBe(true);
  const expired = { ...f.guard(), now: input.expiresAt };
  expect(await f.edits.advance(expired, input.id)).toBeNull();
  expect(await f.edits.publish(expired, input.id, crypto.randomUUID())).toBe(false);
  expect(await readManifest(f, f.snapshotId)).toEqual(f.summary);
});

test("workspace deletion during AES transform denies late publication and cascades all private parts", async () => {
  const f = await fixture();
  const input = editInput(f);
  expect(await f.edits.begin(f.guard(), input)).toBe(true);
  const captured = f.guard();
  let deleted = false;
  f.onEncrypt(() => {
    if (deleted) return;
    deleted = true;
    f.db.sqlite.query("DELETE FROM v2_workspaces WHERE id=?").run(f.id);
  });
  expect(await f.edits.advance(captured, input.id)).toBeNull();
  expect(deleted).toBe(true);
  expect(await f.edits.publish(captured, input.id, crypto.randomUUID())).toBe(false);
  expect(
    f.db.sqlite.query("SELECT id FROM v2_private_snapshots WHERE workspace_id=?").all(f.id),
  ).toEqual([]);
  expect(f.db.sqlite.query("SELECT * FROM v2_private_parts").all()).toEqual([]);
  expect(f.db.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
});

test("unknown fact IDs and stale source-summary revisions are rejected before staging", async () => {
  const f = await fixture();
  const input = editInput(f);
  expect(
    await f.edits.begin(f.guard(), {
      ...input,
      request: { ...input.request, expectedRevision: 999 },
    }),
  ).toBe(false);
  expect(
    await f.edits.begin(f.guard(), {
      ...input,
      request: { ...input.request, factEdits: [{ factId: "foreign-fact", text: "합성 수정" }] },
    }),
  ).toBe(false);
  expect(f.decryptions).toHaveLength(0);
  expect(f.db.sqlite.query("SELECT * FROM v2_summary_edit_stages").all()).toEqual([]);
});

test("cursor write failure rolls back copied output, receipts and progress, then resumes", async () => {
  const f = await fixture();
  const input = editInput(f);
  expect(await f.edits.begin(f.guard(), input)).toBe(true);
  const before = f.db.sqlite
    .query("SELECT * FROM v2_summary_edit_cursors WHERE id=?")
    .get(input.id);
  f.db.sqlite.exec(`CREATE TRIGGER synthetic_summary_cursor_failure BEFORE UPDATE ON
    v2_summary_edit_cursors BEGIN SELECT RAISE(ABORT,'SYNTHETIC_CURSOR_FAILURE'); END`);
  await expect(f.edits.advance(f.guard(), input.id)).rejects.toThrow("DB_OPERATION_FAILED");
  expect(
    f.db.sqlite.query("SELECT * FROM v2_summary_edit_cursors WHERE id=?").get(input.id),
  ).toEqual(before);
  expect(
    f.db.sqlite.query("SELECT * FROM v2_summary_edit_receipts WHERE stage_id=?").all(input.id),
  ).toEqual([]);
  expect(
    f.db.sqlite
      .query("SELECT * FROM v2_private_parts WHERE snapshot_id=?")
      .all(input.targetSnapshotId),
  ).toEqual([]);
  f.db.sqlite.exec("DROP TRIGGER synthetic_summary_cursor_failure");
  await drain(f, input.id);
  expect(await f.edits.publish(f.guard(), input.id, crypto.randomUUID())).toBe(true);
  assertBatchBounds(f);
});

test("concurrent transform steps have one cursor-CAS winner and preserve resumable order", async () => {
  const f = await fixture();
  const input = editInput(f);
  expect(await f.edits.begin(f.guard(), input)).toBe(true);
  let arrivals = 0;
  let release: (() => void) | undefined;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.onEncrypt(async (context) => {
    if (context.table !== "v2_summary_edit_cursors" || arrivals >= 2) return;
    arrivals++;
    if (arrivals === 2) release?.();
    await barrier;
  });
  const outcomes = await Promise.all([
    f.edits.advance(f.guard(), input.id),
    f.edits.advance(f.guard(), input.id),
  ]);
  f.onEncrypt();
  expect(arrivals).toBe(2);
  expect(outcomes.filter(Boolean)).toHaveLength(1);
  await drain(f, input.id);
  expect(await f.edits.publish(f.guard(), input.id, crypto.randomUUID())).toBe(true);
  const result = await readManifest(f, input.targetSnapshotId);
  expect(result.facts.map((fact) => fact.id)).toEqual(f.summary.facts.map((fact) => fact.id));
  expect(new Set(result.facts.map((fact) => fact.id)).size).toBe(result.facts.length);
  assertBatchBounds(f);
});

test("removed target part cannot be published as a complete new summary", async () => {
  const f = await fixture();
  const input = editInput(f);
  expect(await f.edits.begin(f.guard(), input)).toBe(true);
  await drain(f, input.id);
  f.db.sqlite
    .query("DELETE FROM v2_private_parts WHERE snapshot_id=? AND part_index=0")
    .run(input.targetSnapshotId);
  await expect(f.edits.publish(f.guard(), input.id, crypto.randomUUID())).rejects.toThrow(
    "DB_OPERATION_FAILED",
  );
  expect(f.failure()).toBe("batch:check-constraint");
  expect((await f.ws.readIntake(f.actor, f.id))?.summary).toEqual(f.summary);
});

test("a cited answer removed after transformation invalidates final publication", async () => {
  const f = await fixture();
  const input = editInput(f);
  expect(await f.edits.begin(f.guard(), input)).toBe(true);
  await drain(f, input.id);
  const reference = f.summary.facts[0]?.references[0];
  if (reference?.kind !== "intake_answer") throw new Error("Synthetic answer fixture missing");
  f.db.sqlite.query("DELETE FROM v2_answers WHERE question_id=?").run(reference.questionId);
  await expect(f.edits.publish(f.guard(), input.id, crypto.randomUUID())).rejects.toThrow(
    "DB_OPERATION_FAILED",
  );
  expect(f.failure()).toBe("batch:check-constraint");
  expect(f.db.sqlite.query("SELECT summary_id FROM v2_intakes WHERE id=?").get(f.id)).toEqual({
    summary_id: f.summaryId,
  });
});

test("wrong target integrity digest cannot be published even with a valid AES envelope", async () => {
  const f = await fixture();
  const input = editInput(f);
  expect(await f.edits.begin(f.guard(), input)).toBe(true);
  await drain(f, input.id);
  const row = f.db.sqlite
    .query("SELECT encrypted_payload FROM v2_private_snapshots WHERE id=?")
    .get(input.targetSnapshotId) as { encrypted_payload: string };
  const context: EncryptionContext = {
    table: "v2_private_snapshots",
    column: "encrypted_payload",
    rowId: input.targetSnapshotId,
    userId: f.actor.ownerId,
    revision: 2,
  };
  const integrity = JSON.parse(await f.actual.decrypt(row.encrypted_payload, context)) as {
    digest: string;
  };
  const wrong = await f.actual.encrypt(
    JSON.stringify({ ...integrity, digest: "0".repeat(64) }),
    context,
  );
  f.db.sqlite
    .query("UPDATE v2_private_snapshots SET encrypted_payload=? WHERE id=?")
    .run(wrong, input.targetSnapshotId);
  expect(await f.edits.publish(f.guard(), input.id, crypto.randomUUID())).toBe(false);
  expect((await f.ws.readIntake(f.actor, f.id))?.summary).toEqual(f.summary);
});

test("target header byte counts must match the finished durable cursor", async () => {
  const f = await fixture();
  const input = editInput(f);
  expect(await f.edits.begin(f.guard(), input)).toBe(true);
  await drain(f, input.id);
  f.db.sqlite
    .query(
      "UPDATE v2_private_snapshots SET byte_length=byte_length+1,written_bytes=written_bytes+1 WHERE id=?",
    )
    .run(input.targetSnapshotId);
  expect(await f.edits.publish(f.guard(), input.id, crypto.randomUUID())).toBe(false);
  expect((await f.ws.readIntake(f.actor, f.id))?.summary).toEqual(f.summary);
});

test("target part byte metadata is covered by final receipt validation and atomic rollback", async () => {
  const f = await fixture();
  const input = editInput(f);
  expect(await f.edits.begin(f.guard(), input)).toBe(true);
  await drain(f, input.id);
  f.db.sqlite
    .query(
      "UPDATE v2_private_parts SET byte_length=byte_length+1 WHERE snapshot_id=? AND part_index=0",
    )
    .run(input.targetSnapshotId);
  await expect(f.edits.publish(f.guard(), input.id, crypto.randomUUID())).rejects.toThrow(
    "DB_OPERATION_FAILED",
  );
  expect(f.failure()).toBe("batch:check-constraint");
  expect((await f.ws.readIntake(f.actor, f.id))?.summary).toEqual(f.summary);
});

for (const column of ["entity_id", "revision", "summary_revision"] as const) {
  test(`target fact ${column} must still match its typed DTO and target generation`, async () => {
    const f = await fixture();
    const input = editInput(f);
    expect(await f.edits.begin(f.guard(), input)).toBe(true);
    await drain(f, input.id);
    const row = f.db.sqlite
      .query("SELECT id FROM v2_facts WHERE snapshot_id=? ORDER BY id LIMIT 1")
      .get(input.targetSnapshotId) as { id: string };
    // Closed static column list; these updates are accepted by actual SQLite
    // constraints and do not alter the encrypted DTO or snapshot receipt.
    f.db.sqlite
      .query(`UPDATE v2_facts SET ${column}=? WHERE id=?`)
      .run(column === "entity_id" ? "forged-fact" : 99, row.id);
    const published = await f.edits
      .publish(f.guard(), input.id, crypto.randomUUID())
      .catch((error: unknown) => {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe("DB_OPERATION_FAILED");
        expect(f.failure()).toBe("batch:check-constraint");
        return false;
      });
    expect(published).toBe(false);
    expect((await f.ws.readIntake(f.actor, f.id))?.summary).toEqual(f.summary);
  });
}

async function readManifest(f: Awaited<ReturnType<typeof fixture>>, snapshotId: string) {
  let text = "";
  let complete = false;
  for await (const part of f.staging.fragments(f.actor, snapshotId)) {
    expect(utf8Bytes(part.text)).toBeLessThanOrEqual(65536);
    text += part.text;
    complete = part.complete;
  }
  expect(complete).toBe(true);
  return JSON.parse(text) as V2Summary;
}
