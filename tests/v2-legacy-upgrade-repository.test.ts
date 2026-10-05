import { afterEach, expect, test } from "bun:test";
import { type AnalysisStatus, type Answer, answersForQuestionsSchema } from "../src/contracts";
import {
  createCaseDataCipher,
  type EncryptionContext,
  type EnvelopeCipher,
  MAX_PLAINTEXT_BYTES,
} from "../src/server/crypto";
import { createDomainRepository } from "../src/server/db/repository";
import { createV2Core } from "../src/server/db/v2-core";
import { createV2JobsRepository } from "../src/server/db/v2-jobs";
import { createV2LegacyUpgradeRepository } from "../src/server/db/v2-legacy-upgrade";
import { createV2WorkspaceRepository } from "../src/server/db/v2-workspace";
import { guidance, questions } from "./fixtures/contracts";
import { createTestDatabase } from "./helpers/d1";
import { seedTestSession } from "./helpers/session";

const NOW = "2026-10-06T00:00:00.000Z";
const EXPIRES = "2026-10-06T01:00:00.000Z";
type LegacySource = NonNullable<
  Awaited<ReturnType<ReturnType<typeof createV2LegacyUpgradeRepository>["read"]>>
>;
const databases: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});
const legacyTables = [
  "cases",
  "analyses",
  "citations",
  "daily_usage",
  "dispatch_outbox",
  "idempotency_records",
] as const;

async function fixture(
  options: {
    status?: "completed" | "failed" | "queued";
    contextBytes?: number;
    additionalCases?: number;
    narrativeLength?: number;
    narrativeText?: string;
    answersRevision?: boolean;
  } = {},
) {
  // Populate actual 0005 through existing repository APIs, then execute actual
  // generated 0006. Only synthetic authentication uses the shared SQL seed helper.
  const database = await createTestDatabase({ throughMigration: "0005_deletion_cleanup" });
  databases.push(database);
  const owner = await seedTestSession(database, { now: Date.parse(NOW), consent: true });
  const other = await seedTestSession(database, { now: Date.parse(NOW), consent: true });
  const actor = { ownerId: owner.userId, now: NOW };
  const stranger = { ownerId: other.userId, now: NOW };
  const cipher = await createCaseDataCipher({
    CASE_DATA_KEY_V1: btoa("k".repeat(32)).replace(/=+$/, ""),
  });
  const legacy = createDomainRepository(database.binding, cipher);
  const caseId = crypto.randomUUID();
  let analysisId = crypto.randomUUID();
  const initialAnalysisId = analysisId;
  let revision = 1;
  const narrative =
    options.narrativeText ??
    (options.narrativeLength
      ? "가".repeat(options.narrativeLength)
      : "합성 기존 사건의 사용자 서술입니다. 사용자 승인 없이 새 분석을 실행하지 않습니다.");
  let serializedInput = JSON.stringify({ narrative });
  expect(
    (
      await legacy.commitInitialCase({
        ownerId: actor.ownerId,
        caseId,
        analysisId,
        outboxId: crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID(),
        requestHash: "a".repeat(64),
        input: serializedInput,
        now: NOW,
      })
    ).created,
  ).toBe(true);
  const guard = (expectedStatus: AnalysisStatus) => ({
    ownerId: actor.ownerId,
    caseId,
    analysisId,
    inputRevision: revision,
    attempt: 1,
    expectedStatus,
  });
  if (options.answersRevision) {
    const previous = serializedInput;
    const answers: Answer[] = [
      { questionId: "q1", status: "answered", value: "합성 답변: 날짜는 아직 모릅니다." },
      { questionId: "q2", status: "answered", value: "확인 필요" },
    ];
    expect(
      answersForQuestionsSchema(questions).safeParse({ inputRevision: revision, answers }).success,
    ).toBe(true);
    expect(
      await legacy.compareAndSetCheckpoint(
        guard("queued"),
        null,
        JSON.stringify({ schemaVersion: "1", questions, phase: "questions" }),
        NOW,
      ),
    ).toBe(true);
    expect(await legacy.compareAndSetAnalysis(guard("queued"), { status: "screening" }, NOW)).toBe(
      true,
    );
    expect(
      await legacy.compareAndSetAnalysis(
        guard("screening"),
        {
          status: "waiting_for_answers",
          questionsAsked: questions.length,
          clarificationExpiresAt: "2026-10-07T00:00:00.000Z",
        },
        NOW,
      ),
    ).toBe(true);
    const nextAnalysisId = crypto.randomUUID();
    // Exact src/server/api/answers.ts storage shape: narrative is the previous
    // complete decrypted JSON string, with answers/questions alongside it.
    serializedInput = JSON.stringify({ narrative: previous, answers, questions });
    expect(
      await legacy.advanceRevision(
        guard("waiting_for_answers"),
        {
          analysisId: nextAnalysisId,
          outboxId: crypto.randomUUID(),
          input: serializedInput,
          answers: JSON.stringify(answers),
          idempotency: { key: crypto.randomUUID(), requestHash: "e".repeat(64) },
        },
        NOW,
      ),
    ).toBe(true);
    analysisId = nextAnalysisId;
    revision = 2;
  }
  if (options.contextBytes) {
    const overhead = new TextEncoder().encode(JSON.stringify({ padding: "" })).byteLength;
    const checkpoint = JSON.stringify({ padding: "x".repeat(options.contextBytes - overhead) });
    expect(new TextEncoder().encode(checkpoint).byteLength).toBe(options.contextBytes);
    expect(await legacy.compareAndSetCheckpoint(guard("queued"), null, checkpoint, NOW)).toBe(true);
  }
  const status = options.status ?? "completed";
  if (status === "failed") {
    expect(
      await legacy.compareAndSetAnalysis(
        guard("queued"),
        { status: "failed", failureCode: "MODEL_UNAVAILABLE" },
        NOW,
      ),
    ).toBe(true);
  } else if (status === "completed") {
    for (const [before, after] of [
      ["queued", "retrieving"],
      ["retrieving", "generating"],
      ["generating", "validating"],
    ] as const) {
      expect(await legacy.compareAndSetAnalysis(guard(before), { status: after }, NOW)).toBe(true);
    }
    expect(
      await legacy.compareAndSetAnalysis(
        guard("validating"),
        { status: "completed", result: guidance },
        NOW,
      ),
    ).toBe(true);
  }
  const legacyRows = () =>
    legacyTables.map((table) =>
      database.sqlite.query(`SELECT * FROM ${table} ORDER BY rowid`).all(),
    );
  for (let index = 0; index < (options.additionalCases ?? 0); index++) {
    expect(
      (
        await legacy.commitInitialCase({
          ownerId: actor.ownerId,
          caseId: crypto.randomUUID(),
          analysisId: crypto.randomUUID(),
          outboxId: crypto.randomUUID(),
          idempotencyKey: crypto.randomUUID(),
          requestHash: "d".repeat(64),
          input: "합성 기존 사용량 사건입니다. 신규 분석은 실행하지 않습니다.",
          now: NOW,
        })
      ).created,
    ).toBe(true);
  }
  const before = legacyRows();
  database.sqlite.exec(await Bun.file("drizzle/0006_v2_domain_foundation.sql").text());
  expect(legacyRows()).toEqual(before);
  const decrypted: EncryptionContext[] = [];
  let beforeEncrypt: ((context: EncryptionContext) => void | Promise<void>) | undefined;
  let afterDecrypt: ((context: EncryptionContext) => void | Promise<void>) | undefined;
  const observed: EnvelopeCipher = {
    async encrypt(value, context) {
      await beforeEncrypt?.(context);
      return cipher.encrypt(value, context);
    },
    async decrypt(value, context) {
      const result = await cipher.decrypt(value, context);
      decrypted.push(context);
      await afterDecrypt?.(context);
      return result;
    },
  };
  const core = createV2Core(database.binding, observed);
  const upgrades = createV2LegacyUpgradeRepository(core);
  const workspaces = createV2WorkspaceRepository(database.binding, observed);
  const jobs = createV2JobsRepository(core);
  const snapshotId = crypto.randomUUID();
  const workspaceId = crypto.randomUUID();
  const admission = {
    operationId: crypto.randomUUID(),
    key: crypto.randomUUID(),
    requestHash: "b".repeat(64),
  };
  const input = {
    snapshotId,
    workspaceId,
    legacyCaseId: caseId,
    request: { expectedRevision: revision, preserveLegacySnapshot: true },
    admission,
    expiresAt: EXPIRES,
  };
  function source() {
    const row = database.sqlite
      .query("SELECT id,input_revision,status,updated_at,encrypted_input FROM cases WHERE id=?")
      .get(caseId) as {
      id: string;
      input_revision: number;
      status: LegacySource["status"];
      updated_at: string;
      encrypted_input: string;
    };
    const analysis = database.sqlite
      .query(
        "SELECT id,input_revision,attempt,status,updated_at,encrypted_context,encrypted_answers,encrypted_result FROM analyses WHERE id=?",
      )
      .get(analysisId) as LegacySource["analysis"];
    const citations = database.sqlite
      .query(
        "SELECT id,source_type,source_id,law_name,article,effective_date,verified_at,source_url,content_hash FROM citations WHERE analysis_id=? ORDER BY id",
      )
      .all(analysisId) as LegacySource["citations"];
    return {
      caseId: row.id,
      inputRevision: row.input_revision,
      status: row.status,
      updatedAt: row.updated_at,
      encryptedInput: row.encrypted_input,
      analysis,
      citations,
    };
  }
  async function begin() {
    const stage = await upgrades.begin(actor, input);
    if (!stage) throw new Error("Synthetic terminal source could not stage its upgrade");
    return stage;
  }
  async function appendAll() {
    const stage = await begin();
    for (let index = 0; index < stage.partCount; index++)
      expect(await upgrades.append(actor, snapshotId, index)).toBe(true);
    return stage;
  }
  const snapshot = () =>
    [
      "v2_upgrade_stages",
      "v2_private_snapshots",
      "v2_private_parts",
      "v2_workspaces",
      "v2_intakes",
      "v2_operations",
      "v2_idempotency",
      "v2_daily_usage",
      "v2_quota_reservations",
      "v2_jobs",
      "v2_outbox",
      "v2_mutation_claims",
    ].map((table) => database.sqlite.query(`SELECT * FROM ${table} ORDER BY rowid`).all());
  return {
    database,
    actor,
    stranger,
    cipher,
    core,
    legacy,
    upgrades,
    workspaces,
    jobs,
    caseId,
    analysisId,
    initialAnalysisId,
    narrative,
    serializedInput,
    revision,
    before,
    legacyRows,
    snapshot,
    source,
    snapshotId,
    workspaceId,
    admission,
    input,
    decrypted,
    begin,
    appendAll,
    onEncrypt(hook: typeof beforeEncrypt) {
      beforeEncrypt = hook;
    },
    onDecrypt(hook: typeof afterDecrypt) {
      afterDecrypt = hook;
    },
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function deniedPublication(f: Fixture) {
  let result: boolean | undefined;
  try {
    result = await f.upgrades.complete(f.actor, f.snapshotId);
  } catch (error) {
    expect((error as { code?: string }).code).toBeOneOf([
      "SNAPSHOT_INVALID",
      "DB_OPERATION_FAILED",
    ]);
  }
  if (result !== undefined) expect(result).toBe(false);
  expect(await f.workspaces.findWorkspace(f.actor, f.workspaceId)).toBeNull();
  expect(f.database.sqlite.query("SELECT * FROM v2_operations").all()).toEqual([]);
}

test.each(["completed", "failed"] as const)(
  "explicit %s legacy upgrade preserves exact encrypted source and starts no AI or new-case quota",
  async (status) => {
    const f = await fixture({ status });
    const expected = f.source();
    const stage = await f.appendAll();
    expect(await f.upgrades.complete(f.actor, f.snapshotId)).toBe(true);
    expect(await f.upgrades.read(f.actor, f.workspaceId)).toEqual(expected);
    expect(await f.legacy.readInput(f.actor.ownerId, f.caseId)).toBe(f.serializedInput);
    expect(f.legacyRows()).toEqual(f.before);
    expect(await f.workspaces.findWorkspace(f.actor, f.workspaceId)).toMatchObject({
      schemaVersion: "2",
      status: "intake",
      workspaceRevision: 1,
      intakeRevision: 1,
      confirmedSummaryRevision: null,
      currentJobId: null,
      legacySnapshotId: f.snapshotId,
    });
    expect(await f.workspaces.readIntake(f.actor, f.workspaceId)).toMatchObject({
      status: "collecting",
      narrative: f.narrative,
      batches: [],
      summary: null,
      currentJobId: null,
    });
    expect(f.database.sqlite.query("SELECT * FROM v2_jobs").all()).toEqual([]);
    expect(f.database.sqlite.query("SELECT * FROM v2_outbox").all()).toEqual([]);
    expect(f.database.sqlite.query("SELECT * FROM v2_quota_reservations").all()).toEqual([]);
    expect(f.database.sqlite.query("SELECT * FROM v2_daily_usage").all()).toEqual([]);
    expect(f.database.sqlite.query("SELECT kind,workspace_id FROM v2_operations").all()).toEqual([
      { kind: "legacy_upgrade", workspace_id: f.workspaceId },
    ]);
    const published = f.snapshot();
    expect(await f.upgrades.complete(f.actor, f.snapshotId)).toBe(false);
    expect(f.snapshot()).toEqual(published);
    expect(
      f.database.sqlite
        .query(
          "SELECT state,part_count,written_parts,byte_length,written_bytes FROM v2_private_snapshots WHERE id=?",
        )
        .get(f.snapshotId),
    ).toEqual({
      state: "published",
      part_count: stage.partCount,
      written_parts: stage.partCount,
      byte_length: stage.byteLength,
      written_bytes: stage.byteLength,
    });
    expect(await f.upgrades.abandon(f.actor, f.snapshotId)).toBe(false);
    expect(f.database.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
  },
);

test("opt-in, owner, terminal status and expected input revision reject before private decryption", async () => {
  const f = await fixture();
  const before = f.snapshot();
  for (const request of [
    { expectedRevision: 1, preserveLegacySnapshot: false },
    { expectedRevision: 1 },
    { expectedRevision: 1, preserveLegacySnapshot: true, hidden: true },
  ]) {
    await expect(f.upgrades.begin(f.actor, { ...f.input, request })).rejects.toThrow(
      "REPOSITORY_INPUT_INVALID",
    );
  }
  expect(await f.upgrades.begin(f.stranger, f.input)).toBeNull();
  expect(
    await f.upgrades.begin(f.actor, {
      ...f.input,
      request: { expectedRevision: 2, preserveLegacySnapshot: true },
    }),
  ).toBeNull();
  expect(f.decrypted).toEqual([]);
  expect(f.snapshot()).toEqual(before);
  const queued = await fixture({ status: "queued" });
  expect(await queued.upgrades.begin(queued.actor, queued.input)).toBeNull();
  expect(queued.decrypted).toEqual([]);
});

test("partial crash replay keeps one source snapshot and strictly ordered exact 64 KiB fragments at the v1 cipher maximum", async () => {
  const f = await fixture({ contextBytes: MAX_PLAINTEXT_BYTES });
  const expected = f.source();
  const stage = await f.begin();
  expect(stage.byteLength).toBeGreaterThan(MAX_PLAINTEXT_BYTES);
  expect(stage.partCount).toBeGreaterThan(4);
  expect(await f.upgrades.append(f.actor, f.snapshotId, 1)).toBe(false);
  expect(await f.upgrades.complete(f.actor, f.snapshotId)).toBe(false);
  expect(await f.upgrades.append(f.actor, f.snapshotId, 0)).toBe(true);
  const first = f.snapshot();
  const resumed = createV2LegacyUpgradeRepository(f.core);
  expect(await resumed.begin(f.actor, f.input)).toEqual(stage);
  expect(await resumed.append(f.actor, f.snapshotId, 0)).toBe(true);
  expect(f.snapshot()).toEqual(first);
  for (let index = 1; index < stage.partCount; index++)
    expect(await resumed.append(f.actor, f.snapshotId, index)).toBe(true);
  const parts = f.database.sqlite
    .query(
      "SELECT id,part_index,byte_length,encrypted_payload FROM v2_private_parts WHERE snapshot_id=? ORDER BY part_index",
    )
    .all(f.snapshotId) as Array<{
    id: string;
    part_index: number;
    byte_length: number;
    encrypted_payload: string;
  }>;
  const texts: string[] = [];
  for (const [index, part] of parts.entries()) {
    const text = await f.cipher.decrypt(part.encrypted_payload, {
      table: "v2_private_parts",
      column: "encrypted_payload",
      rowId: part.id,
      userId: f.actor.ownerId,
      revision: 1,
      targetId: f.workspaceId,
      purpose: "legacy_snapshot",
      part: index,
    });
    expect(new TextEncoder().encode(text).byteLength).toBe(part.byte_length);
    expect(part.byte_length).toBeLessThanOrEqual(65536);
    if (index < parts.length - 1) expect(part.byte_length).toBe(65536);
    texts.push(text);
    await expect(
      f.cipher.decrypt(part.encrypted_payload, {
        table: "v2_private_parts",
        column: "encrypted_payload",
        rowId: part.id,
        userId: f.actor.ownerId,
        revision: 1,
        targetId: crypto.randomUUID(),
        purpose: "legacy_snapshot",
        part: index,
      }),
    ).rejects.toThrow("CRYPTO_DECRYPT_FAILED");
  }
  expect(JSON.parse(texts.join(""))).toEqual(expected);
  expect(await resumed.complete(f.actor, f.snapshotId)).toBe(true);
  expect(await resumed.read(f.actor, f.workspaceId)).toEqual(expected);
  expect(f.legacyRows()).toEqual(f.before);
});

test("other owner cannot append, complete, abandon or read private legacy upgrade state", async () => {
  const f = await fixture();
  await f.begin();
  f.decrypted.length = 0;
  const before = f.snapshot();
  expect(await f.upgrades.append(f.stranger, f.snapshotId, 0)).toBe(false);
  expect(await f.upgrades.complete(f.stranger, f.snapshotId)).toBe(false);
  expect(await f.upgrades.abandon(f.stranger, f.snapshotId)).toBe(false);
  expect(await f.upgrades.read(f.stranger, f.workspaceId)).toBeNull();
  expect(f.decrypted).toEqual([]);
  expect(f.snapshot()).toEqual(before);
  await f.appendAll();
  expect(await f.upgrades.complete(f.actor, f.snapshotId)).toBe(true);
  f.decrypted.length = 0;
  expect(await f.upgrades.read(f.stranger, f.workspaceId)).toBeNull();
  expect(f.decrypted).toEqual([]);
});

test("expiry stops staging work before decryption and explicit abandon cleans all partial ciphertext", async () => {
  const f = await fixture();
  await f.begin();
  expect(await f.upgrades.append(f.actor, f.snapshotId, 0)).toBe(true);
  const expired = { ...f.actor, now: EXPIRES };
  f.decrypted.length = 0;
  const before = f.snapshot();
  expect(await f.upgrades.append(expired, f.snapshotId, 0)).toBe(false);
  expect(await f.upgrades.complete(expired, f.snapshotId)).toBe(false);
  expect(f.decrypted).toEqual([]);
  expect(f.snapshot()).toEqual(before);
  expect(await f.upgrades.abandon(expired, f.snapshotId)).toBe(true);
  for (const table of ["v2_upgrade_stages", "v2_private_snapshots", "v2_private_parts"])
    expect(f.database.sqlite.query(`SELECT * FROM ${table}`).all()).toEqual([]);
  expect(f.legacyRows()).toEqual(f.before);
});

test.each([
  "cipher",
  "analysis-status",
  "analysis-revision",
  "current-analysis",
  "citation",
] as const)(
  "source %s changed between parts cannot publish the stale captured source",
  async (mutation) => {
    const f = await fixture({ contextBytes: 65536 });
    await f.begin();
    expect(await f.upgrades.append(f.actor, f.snapshotId, 0)).toBe(true);
    // Adversarial concurrent historical writes are SQL because v1 has no API to
    // mutate a completed analysis. Cipher replacement is valid AES with same AAD.
    if (mutation === "cipher") {
      const changed = await f.cipher.encrypt(`${f.narrative} 동일 revision의 변경입니다.`, {
        table: "cases",
        column: "encrypted_input",
        rowId: f.caseId,
        userId: f.actor.ownerId,
      });
      f.database.sqlite
        .query("UPDATE cases SET encrypted_input=? WHERE id=?")
        .run(changed, f.caseId);
    } else if (mutation === "analysis-status")
      f.database.sqlite.query("UPDATE analyses SET status='queued' WHERE id=?").run(f.analysisId);
    else if (mutation === "analysis-revision")
      f.database.sqlite.query("UPDATE analyses SET input_revision=2 WHERE id=?").run(f.analysisId);
    else if (mutation === "current-analysis")
      f.database.sqlite.query("UPDATE cases SET current_analysis_id=NULL WHERE id=?").run(f.caseId);
    else
      f.database.sqlite
        .query("UPDATE citations SET law_name='합성 변경 출처' WHERE analysis_id=?")
        .run(f.analysisId);
    const before = f.snapshot();
    expect(await f.upgrades.append(f.actor, f.snapshotId, 1)).toBe(false);
    expect(await f.upgrades.complete(f.actor, f.snapshotId)).toBe(false);
    expect(f.snapshot()).toEqual(before);
  },
);

test.each(["input-cipher", "citation-change", "citation-delete", "citation-add"] as const)(
  "final claim rejects %s after real encryption yields",
  async (mutation) => {
    const f = await fixture();
    await f.appendAll();
    let changed = false;
    f.onEncrypt(async (context) => {
      if (context.table !== "v2_workspaces" || changed) return;
      changed = true;
      // Genuine preflight/transaction race; source remains otherwise terminal with
      // unchanged timestamps and revisions so only exact source CAS rejects it.
      if (mutation === "input-cipher") {
        const replacement = await f.cipher.encrypt(`${f.narrative} 변경`, {
          table: "cases",
          column: "encrypted_input",
          rowId: f.caseId,
          userId: f.actor.ownerId,
        });
        f.database.sqlite
          .query("UPDATE cases SET encrypted_input=? WHERE id=?")
          .run(replacement, f.caseId);
      } else if (mutation === "citation-change")
        f.database.sqlite
          .query("UPDATE citations SET law_name='합성 최종 변경' WHERE analysis_id=?")
          .run(f.analysisId);
      else if (mutation === "citation-delete")
        f.database.sqlite.query("DELETE FROM citations WHERE analysis_id=?").run(f.analysisId);
      else
        f.database.sqlite
          .query(
            "INSERT INTO citations(id,analysis_id,source_type,source_id,law_name,article,effective_date,verified_at,source_url,content_hash) SELECT ?,analysis_id,source_type,source_id,law_name,article,effective_date,verified_at,source_url,content_hash FROM citations WHERE analysis_id=? LIMIT 1",
          )
          .run(crypto.randomUUID(), f.analysisId);
    });
    expect(await f.upgrades.complete(f.actor, f.snapshotId)).toBe(false);
    expect(changed).toBe(true);
    expect(await f.workspaces.findWorkspace(f.actor, f.workspaceId)).toBeNull();
    expect(f.database.sqlite.query("SELECT * FROM v2_operations").all()).toEqual([]);
  },
);

test("actual v1 case deletion removes pending stage and every private snapshot fragment", async () => {
  const f = await fixture({ contextBytes: 65536 });
  await f.begin();
  expect(await f.upgrades.append(f.actor, f.snapshotId, 0)).toBe(true);
  expect(await f.legacy.deleteOwnedCase(f.actor.ownerId, f.caseId, crypto.randomUUID(), NOW)).toBe(
    true,
  );
  for (const table of ["v2_upgrade_stages", "v2_private_snapshots", "v2_private_parts"])
    expect(f.database.sqlite.query(`SELECT * FROM ${table}`).all()).toEqual([]);
  f.decrypted.length = 0;
  expect(await f.upgrades.append(f.actor, f.snapshotId, 1)).toBe(false);
  expect(await f.upgrades.complete(f.actor, f.snapshotId)).toBe(false);
  expect(f.decrypted).toEqual([]);
  expect(f.database.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
});

test("SQLite final publication failure rolls back workspace, intake, pointer and operation without dropping legacy data", async () => {
  const f = await fixture();
  await f.appendAll();
  const before = f.snapshot();
  // Trigger faults the real atomic publication batch, with no method stubbing.
  f.database.sqlite.exec(
    "CREATE TEMP TRIGGER synthetic_upgrade_failure BEFORE INSERT ON v2_intakes BEGIN SELECT RAISE(ABORT, 'SYNTHETIC_ROLLBACK'); END",
  );
  await expect(f.upgrades.complete(f.actor, f.snapshotId)).rejects.toThrow("DB_OPERATION_FAILED");
  // Sealing is a separately persisted resumable checkpoint. Atomic publication
  // must leave every other row unchanged and expose no workspace after a crash.
  before[1] =
    before[1]?.map((row) => ({ ...(row as Record<string, unknown>), state: "sealed" })) ?? [];
  expect(f.snapshot()).toEqual(before);
  expect(f.legacyRows()).toEqual(f.before);
  expect(f.database.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
  f.database.sqlite.exec("DROP TRIGGER synthetic_upgrade_failure");
  expect(await f.upgrades.complete(f.actor, f.snapshotId)).toBe(true);
  expect(await f.upgrades.read(f.actor, f.workspaceId)).toEqual(f.source());
});

test.each(["missing", "cipher", "bytes", "hash"] as const)(
  "a staged snapshot with %s corruption cannot become a usable workspace",
  async (mutation) => {
    const f = await fixture();
    await f.appendAll();
    // Direct SQL is solely hostile storage corruption, never a fabricated
    // successful source capture, encrypted part, or publication repository.
    if (mutation === "missing")
      f.database.sqlite.query("DELETE FROM v2_private_parts WHERE snapshot_id=?").run(f.snapshotId);
    else if (mutation === "cipher") {
      const part = f.database.sqlite
        .query("SELECT id,part_index,byte_length FROM v2_private_parts WHERE snapshot_id=? LIMIT 1")
        .get(f.snapshotId) as { id: string; part_index: number; byte_length: number };
      const replacement = await f.cipher.encrypt("z".repeat(part.byte_length), {
        table: "v2_private_parts",
        column: "encrypted_payload",
        rowId: part.id,
        userId: f.actor.ownerId,
        revision: 1,
        targetId: f.workspaceId,
        purpose: "legacy_snapshot",
        part: part.part_index,
      });
      f.database.sqlite
        .query("UPDATE v2_private_parts SET encrypted_payload=? WHERE id=?")
        .run(replacement, part.id);
    } else if (mutation === "bytes")
      f.database.sqlite
        .query("UPDATE v2_private_parts SET byte_length=byte_length+1 WHERE snapshot_id=?")
        .run(f.snapshotId);
    else {
      const integrity = await f.core.encrypt(
        "v2_private_snapshots",
        f.snapshotId,
        f.actor.ownerId,
        1,
        {
          format: "chain_v1",
          digest: "f".repeat(64),
          purpose: "legacy_snapshot",
          targetId: f.workspaceId,
          partCount: 1,
        },
      );
      f.database.sqlite
        .query("UPDATE v2_private_snapshots SET encrypted_payload=? WHERE id=?")
        .run(integrity, f.snapshotId);
    }
    await deniedPublication(f);
  },
);

test("first new AI job requires a separate explicit admission after preserved legacy publication", async () => {
  const f = await fixture();
  await f.appendAll();
  expect(await f.upgrades.complete(f.actor, f.snapshotId)).toBe(true);
  expect(f.database.sqlite.query("SELECT * FROM v2_jobs").all()).toEqual([]);
  const admission = {
    operationId: crypto.randomUUID(),
    key: crypto.randomUUID(),
    requestHash: "c".repeat(64),
  };
  const jobId = crypto.randomUUID();
  expect(
    await f.jobs.admitWorkspace(
      { ...f.actor, workspaceId: f.workspaceId, expectedRevision: 1 },
      admission,
      jobId,
      "intake_questions",
    ),
  ).toBe(true);
  expect((await f.jobs.find(f.actor, jobId))?.status).toBe("queued");
  expect(f.database.sqlite.query("SELECT kind,units FROM v2_quota_reservations").all()).toEqual([
    { kind: "visible_response", units: 1 },
  ]);
  expect(f.database.sqlite.query("SELECT kind FROM v2_operations ORDER BY rowid").all()).toEqual([
    { kind: "legacy_upgrade" },
    { kind: "question_batch" },
  ]);
  expect(await f.upgrades.read(f.actor, f.workspaceId)).toEqual(f.source());
  expect(f.legacyRows()).toEqual(f.before);
});

test("conversion remains available after all daily new-case slots are used and consumes no additional case", async () => {
  const f = await fixture({ additionalCases: 2 });
  expect(
    f.database.sqlite
      .query("SELECT analysis_count FROM daily_usage WHERE user_id=?")
      .get(f.actor.ownerId),
  ).toEqual({ analysis_count: 3 });
  await f.appendAll();
  expect(await f.upgrades.complete(f.actor, f.snapshotId)).toBe(true);
  expect(f.legacyRows()).toEqual(f.before);
  expect(f.database.sqlite.query("SELECT * FROM v2_quota_reservations").all()).toEqual([]);
  expect(f.database.sqlite.query("SELECT * FROM v2_daily_usage").all()).toEqual([]);
});

test("mismatched current-analysis revision cannot stage an inconsistent source or decrypt narrative", async () => {
  const f = await fixture();
  // Hostile historical metadata inconsistency has valid underlying ciphertext.
  f.database.sqlite.query("UPDATE analyses SET input_revision=2 WHERE id=?").run(f.analysisId);
  const before = f.snapshot();
  expect(await f.upgrades.begin(f.actor, f.input)).toBeNull();
  expect(f.decrypted).toEqual([]);
  expect(f.snapshot()).toEqual(before);
});

test("same-revision source cipher changed after append preflight prevents the new part commit", async () => {
  const f = await fixture();
  await f.begin();
  let changed = false;
  f.onEncrypt(async (context) => {
    if (context.table !== "v2_private_parts" || changed) return;
    changed = true;
    const replacement = await f.cipher.encrypt(`${f.narrative} 변경`, {
      table: "cases",
      column: "encrypted_input",
      rowId: f.caseId,
      userId: f.actor.ownerId,
    });
    f.database.sqlite
      .query("UPDATE cases SET encrypted_input=? WHERE id=?")
      .run(replacement, f.caseId);
  });
  const before = f.snapshot();
  expect(await f.upgrades.append(f.actor, f.snapshotId, 0)).toBe(false);
  expect(changed).toBe(true);
  expect(f.snapshot()).toEqual(before);
});

test("real SQLite append crash rolls back partial counters and resumes with exact same source", async () => {
  const f = await fixture();
  const stage = await f.begin();
  const before = f.snapshot();
  f.database.sqlite.exec(
    "CREATE TEMP TRIGGER synthetic_append_failure BEFORE INSERT ON v2_private_parts BEGIN SELECT RAISE(ABORT, 'SYNTHETIC_ROLLBACK'); END",
  );
  await expect(f.upgrades.append(f.actor, f.snapshotId, 0)).rejects.toThrow("DB_OPERATION_FAILED");
  expect(f.snapshot()).toEqual(before);
  f.database.sqlite.exec("DROP TRIGGER synthetic_append_failure");
  expect(await f.upgrades.begin(f.actor, f.input)).toEqual(stage);
  expect(await f.upgrades.append(f.actor, f.snapshotId, 0)).toBe(true);
  expect(await f.upgrades.complete(f.actor, f.snapshotId)).toBe(true);
  expect(await f.upgrades.read(f.actor, f.workspaceId)).toEqual(f.source());
});

test.each(["part-cipher", "part-delete", "header"] as const)(
  "final publication rejects %s corruption after preflight verification yields",
  async (mutation) => {
    const f = await fixture();
    await f.appendAll();
    let changed = false;
    f.onEncrypt(async (context) => {
      if (context.table !== "v2_workspaces" || changed) return;
      changed = true;
      // Corruption occurs after actual source/part validation, with stable counts
      // unless the selected counterexample deliberately deletes the part.
      if (mutation === "part-delete")
        f.database.sqlite
          .query("DELETE FROM v2_private_parts WHERE snapshot_id=?")
          .run(f.snapshotId);
      else if (mutation === "part-cipher") {
        const part = f.database.sqlite
          .query(
            "SELECT id,part_index,byte_length FROM v2_private_parts WHERE snapshot_id=? LIMIT 1",
          )
          .get(f.snapshotId) as { id: string; part_index: number; byte_length: number };
        const replacement = await f.cipher.encrypt("z".repeat(part.byte_length), {
          table: "v2_private_parts",
          column: "encrypted_payload",
          rowId: part.id,
          userId: f.actor.ownerId,
          revision: 1,
          targetId: f.workspaceId,
          purpose: "legacy_snapshot",
          part: part.part_index,
        });
        f.database.sqlite
          .query("UPDATE v2_private_parts SET encrypted_payload=? WHERE id=?")
          .run(replacement, part.id);
      } else {
        const replacement = await f.core.encrypt(
          "v2_private_snapshots",
          f.snapshotId,
          f.actor.ownerId,
          1,
          {
            format: "chain_v1",
            digest: "f".repeat(64),
            purpose: "legacy_snapshot",
            targetId: f.workspaceId,
            partCount: 1,
          },
        );
        f.database.sqlite
          .query("UPDATE v2_private_snapshots SET encrypted_payload=? WHERE id=?")
          .run(replacement, f.snapshotId);
      }
    });
    await deniedPublication(f);
    expect(changed).toBe(true);
  },
);

test("v1 deletion during source narrative decryption cannot create pending private upgrade data", async () => {
  const f = await fixture();
  let deleted = false;
  f.onDecrypt(async (context) => {
    if (context.table !== "cases" || deleted) return;
    deleted = true;
    expect(
      await f.legacy.deleteOwnedCase(f.actor.ownerId, f.caseId, crypto.randomUUID(), NOW),
    ).toBe(true);
  });
  expect(await f.upgrades.begin(f.actor, f.input)).toBeNull();
  expect(deleted).toBe(true);
  for (const table of ["v2_upgrade_stages", "v2_private_snapshots", "v2_private_parts"])
    expect(f.database.sqlite.query(`SELECT * FROM ${table}`).all()).toEqual([]);
});

test("v1 deletion during published snapshot decryption prevents returning the private legacy source", async () => {
  const f = await fixture();
  await f.appendAll();
  expect(await f.upgrades.complete(f.actor, f.snapshotId)).toBe(true);
  let deleted = false;
  f.onDecrypt(async (context) => {
    if (context.table !== "v2_private_parts" || deleted) return;
    deleted = true;
    expect(
      await f.legacy.deleteOwnedCase(f.actor.ownerId, f.caseId, crypto.randomUUID(), NOW),
    ).toBe(true);
  });
  expect(await f.upgrades.read(f.actor, f.workspaceId)).toBeNull();
  expect(deleted).toBe(true);
  for (const table of [
    "v2_workspaces",
    "v2_upgrade_stages",
    "v2_private_snapshots",
    "v2_private_parts",
  ])
    expect(f.database.sqlite.query(`SELECT * FROM ${table}`).all()).toEqual([]);
  expect(f.database.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
});

test("actual v1 deletion after a sealed publication crash removes every pending private source fragment", async () => {
  const f = await fixture();
  await f.appendAll();
  f.database.sqlite.exec(
    "CREATE TEMP TRIGGER synthetic_sealed_failure BEFORE INSERT ON v2_intakes BEGIN SELECT RAISE(ABORT, 'SYNTHETIC_ROLLBACK'); END",
  );
  await expect(f.upgrades.complete(f.actor, f.snapshotId)).rejects.toThrow("DB_OPERATION_FAILED");
  expect(
    f.database.sqlite.query("SELECT state FROM v2_private_snapshots WHERE id=?").get(f.snapshotId),
  ).toEqual({ state: "sealed" });
  expect(await f.legacy.deleteOwnedCase(f.actor.ownerId, f.caseId, crypto.randomUUID(), NOW)).toBe(
    true,
  );
  for (const table of ["v2_upgrade_stages", "v2_private_snapshots", "v2_private_parts"])
    expect(f.database.sqlite.query(`SELECT * FROM ${table}`).all()).toEqual([]);
  expect(await f.upgrades.complete(f.actor, f.snapshotId)).toBe(false);
  expect(f.database.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
});

test.each([false, true])(
  "actual v1 JSON input at 5000 characters extracts narrative correctly with answers revision=%s",
  async (answersRevision) => {
    const f = await fixture({ narrativeLength: 5000, answersRevision });
    const expected = f.source();
    await f.appendAll();
    expect(await f.upgrades.complete(f.actor, f.snapshotId)).toBe(true);
    expect((await f.workspaces.readIntake(f.actor, f.workspaceId))?.narrative).toBe(f.narrative);
    expect(await f.upgrades.read(f.actor, f.workspaceId)).toEqual(expected);
    expect(await f.legacy.readInput(f.actor.ownerId, f.caseId)).toBe(f.serializedInput);
    if (answersRevision) {
      const outer = JSON.parse(f.serializedInput);
      expect(JSON.parse(outer.narrative)).toEqual({ narrative: f.narrative });
      expect(outer.answers).toEqual([
        { questionId: "q1", status: "answered", value: "합성 답변: 날짜는 아직 모릅니다." },
        { questionId: "q2", status: "answered", value: "확인 필요" },
      ]);
      expect(outer.questions).toEqual(questions);
      // Actual advanceRevision stores submitted answers on the superseded
      // analysis; the new current analysis retains them in nested input.
      const analysis = f.database.sqlite
        .query("SELECT status,encrypted_answers FROM analyses WHERE id=?")
        .get(f.initialAnalysisId) as { status: string; encrypted_answers: string | null };
      expect(analysis.status).toBe("superseded");
      if (!analysis.encrypted_answers)
        throw new Error("Synthetic revision must retain encrypted answers");
      expect(
        JSON.parse(
          await f.cipher.decrypt(analysis.encrypted_answers, {
            table: "analyses",
            column: "encrypted_answers",
            rowId: f.initialAnalysisId,
            userId: f.actor.ownerId,
          }),
        ),
      ).toEqual(outer.answers);
    }
    expect(f.legacyRows()).toEqual(f.before);
  },
);

test("an unrelated workspace tombstone cannot deny sealing another owner's untouched legacy source", async () => {
  const f = await fixture();
  // A separate deletion journal's opaque tombstone is an unavoidable SQL seed;
  // it has no ownership or target relation to the source being upgraded.
  f.database.sqlite
    .query("INSERT INTO v2_tombstones(target_kind,target_id,deleted_at) VALUES('workspace',?,?)")
    .run(crypto.randomUUID(), NOW);
  await f.appendAll();
  expect(await f.upgrades.complete(f.actor, f.snapshotId)).toBe(true);
  expect(await f.upgrades.read(f.actor, f.workspaceId)).toEqual(f.source());
});

test("actual v1 deletion between sealing and workspace encryption leaves no unpublished private source", async () => {
  const f = await fixture();
  await f.appendAll();
  let deleted = false;
  f.onEncrypt(async (context) => {
    if (context.table !== "v2_workspaces" || deleted) return;
    deleted = true;
    expect(
      f.database.sqlite
        .query("SELECT state FROM v2_private_snapshots WHERE id=?")
        .get(f.snapshotId),
    ).toEqual({ state: "sealed" });
    expect(
      await f.legacy.deleteOwnedCase(f.actor.ownerId, f.caseId, crypto.randomUUID(), NOW),
    ).toBe(true);
  });
  expect(await f.upgrades.complete(f.actor, f.snapshotId)).toBe(false);
  expect(deleted).toBe(true);
  for (const table of [
    "v2_workspaces",
    "v2_upgrade_stages",
    "v2_private_snapshots",
    "v2_private_parts",
  ])
    expect(f.database.sqlite.query(`SELECT * FROM ${table}`).all()).toEqual([]);
  expect(f.database.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
});

test.each([false, true])(
  "JSON-shaped user narrative stays verbatim while only legacy storage wrappers are extracted, answers=%s",
  async (answersRevision) => {
    const narrativeText = JSON.stringify({
      narrative: "합성 사용자 서술 자체가 JSON 구조로 작성된 경우입니다.",
    });
    const f = await fixture({ narrativeText, answersRevision });
    await f.appendAll();
    expect(await f.upgrades.complete(f.actor, f.snapshotId)).toBe(true);
    expect((await f.workspaces.readIntake(f.actor, f.workspaceId))?.narrative).toBe(narrativeText);
    expect(await f.legacy.readInput(f.actor.ownerId, f.caseId)).toBe(f.serializedInput);
    expect(await f.upgrades.read(f.actor, f.workspaceId)).toEqual(f.source());
  },
);
