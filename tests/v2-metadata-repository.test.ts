import { afterEach, expect, test } from "bun:test";
import {
  type V2Coverage,
  type V2File,
  type V2Summary,
  v2CoverageSchema,
} from "../src/contracts/v2";
import {
  createCaseDataCipher,
  type EncryptionContext,
  type EnvelopeCipher,
} from "../src/server/crypto";
import { type Actor, createV2Core, fragmentText, utf8Bytes } from "../src/server/db/v2-core";
import { createV2DeletionRepository } from "../src/server/db/v2-deletion";
import { createV2FileStagingRepository } from "../src/server/db/v2-file-staging";
import { createV2FilesRepository } from "../src/server/db/v2-files";
import { createV2JobsRepository } from "../src/server/db/v2-jobs";
import { createV2StagingRepository } from "../src/server/db/v2-staging";
import { createV2StorageRepository } from "../src/server/db/v2-storage";
import { createV2SummaryStagingRepository } from "../src/server/db/v2-summary-staging";
import { createV2WorkspaceRepository } from "../src/server/db/v2-workspace";
import { createTestDatabase } from "./helpers/d1";
import { seedTestSession } from "./helpers/session";

const NOW = "2026-10-06T00:00:00.000Z";
const HASH = "a".repeat(64);
const databases: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
const admission = () => ({
  operationId: crypto.randomUUID(),
  key: crypto.randomUUID(),
  requestHash: HASH,
});

async function fixture() {
  // Actual generated migrations, SQLite and AES. Session identity is synthetic;
  // workspace, quota, upload, jobs and published snapshots use real repositories.
  const db = await createTestDatabase();
  databases.push(db);
  const owner = await seedTestSession(db, { now: Date.parse(NOW), consent: true });
  const stranger = await seedTestSession(db, { now: Date.parse(NOW), consent: true });
  const actor: Actor = { ownerId: owner.userId, now: NOW };
  const actual = await createCaseDataCipher({
    CASE_DATA_KEY_V1: btoa("m".repeat(32)).replace(/=+$/, ""),
  });
  const decryptions: EncryptionContext[] = [];
  let hook: ((context: EncryptionContext) => Promise<void> | void) | undefined;
  const cipher: EnvelopeCipher = {
    encrypt: (value, context) => actual.encrypt(value, context),
    async decrypt(value, context) {
      const result = await actual.decrypt(value, context);
      decryptions.push(context);
      await hook?.(context);
      return result;
    },
  };
  const queries: { sql: string; parameters: number; bytes: number }[] = [];
  const instrument = (statement: D1PreparedStatement, sql: string, values: unknown[] = []) => {
    const bind = statement.bind.bind(statement);
    statement.bind = (...parameters: unknown[]) => instrument(bind(...parameters), sql, parameters);
    const record = () =>
      queries.push({
        sql,
        parameters: values.length,
        bytes: utf8Bytes(sql) + utf8Bytes(JSON.stringify(values)),
      });
    const first = statement.first.bind(statement);
    const all = statement.all.bind(statement);
    statement.first = ((...args: Parameters<typeof first>) => {
      record();
      return first(...args);
    }) as typeof statement.first;
    statement.all = ((...args: Parameters<typeof all>) => {
      record();
      return all(...args);
    }) as typeof statement.all;
    return statement;
  };
  // Decorating actual statements preserves the helper's transaction identity.
  const binding = {
    prepare: (sql: string) => instrument(db.binding.prepare(sql), sql),
    batch: (statements: D1PreparedStatement[]) => db.binding.batch(statements),
  } as unknown as D1Database;
  const core = createV2Core(binding, cipher);
  const ws = createV2WorkspaceRepository(binding, cipher);
  const id = crypto.randomUUID();
  const create = async (workspaceId: string, now = NOW) => {
    expect(
      (
        await ws.create(
          { ...actor, now },
          workspaceId,
          {
            narrative: "합성 사건 서술이며 실제 사람이나 외부 서비스 자료를 포함하지 않습니다.",
            subjectContext: "individual",
            jurisdiction: "KR",
            turnstileToken: "synthetic",
          },
          admission(),
        )
      ).kind,
    ).toBe("created");
  };
  await create(id);
  const guard = (workspaceId = id) => ({
    ...actor,
    workspaceId,
    expectedRevision: (
      db.sqlite.query("SELECT revision FROM v2_workspaces WHERE id=?").get(workspaceId) as {
        revision: number;
      }
    ).revision,
  });
  return {
    db,
    core,
    ws,
    actor,
    id,
    create,
    guard,
    decryptions,
    queries,
    stranger: { ownerId: stranger.userId, now: NOW },
    files: createV2FilesRepository(core),
    storage: createV2StorageRepository(core),
    jobs: createV2JobsRepository(core),
    staging: createV2StagingRepository(core),
    summaries: createV2SummaryStagingRepository(core),
    fileStages: createV2FileStagingRepository(core),
    deletion: createV2DeletionRepository(core),
    onDecrypt: (value?: typeof hook) => {
      hook = value;
    },
    reset: () => {
      queries.length = 0;
      decryptions.length = 0;
    },
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

async function publishSummary(f: Fixture, large = false) {
  const start = async (kind: "intake_questions" | "intake_summary") => {
    const jobId = crypto.randomUUID();
    expect(await f.jobs.admitWorkspace(f.guard(), admission(), jobId, kind)).toBe(true);
    const job = await f.jobs.acquire(
      f.actor,
      jobId,
      crypto.randomUUID(),
      "2026-10-06T00:04:00.000Z",
    );
    if (!job) throw new Error("Synthetic summary job unavailable");
    return job.lease;
  };
  const lease = await start("intake_questions");
  const questionId = crypto.randomUUID();
  const batchId = crypto.randomUUID();
  expect(
    await f.ws.writeBatch(
      f.guard(),
      {
        id: batchId,
        ordinal: 1,
        generatedForIntakeRevision: 1,
        questions: [
          { id: questionId, prompt: "확인한 자료는 무엇인가요?", answerType: "text", options: [] },
        ],
        answers: [],
      },
      lease,
    ),
  ).toBe(true);
  expect(
    await f.ws.answer(f.guard(), batchId, {
      expectedRevision: 1,
      answers: [{ questionId, status: "answered", value: "합성 자료를 확인했습니다." }],
    }),
  ).toBe(true);
  const summaryLease = await start("intake_summary");
  const summary: V2Summary = {
    schemaVersion: "2",
    revision: 1,
    intakeRevision: 2,
    createdAt: NOW,
    overview: "자료와 사용자 진술을 구분하여 정리한 합성 요약입니다.",
    facts: Array.from({ length: large ? 300 : 8 }, (_, index) => ({
      id: `fact-${index}`,
      text: large ? "😀".repeat(2000) : `합성 사실 ${index}`,
      attribution: "user_statement",
      certainty: "reported",
      significance: "neutral",
      references: Array.from({ length: large ? 100 : 1 }, () => ({
        kind: "intake_answer" as const,
        questionId,
        intakeRevision: 2,
      })),
      conflictingFactIds: [],
      userEdited: false,
    })),
    parties: [{ id: "synthetic-party", label: "합성 관계자", role: "자료 확인 대상" }],
    unknowns: ["추가 확인 사항"],
    notices: ["합성 검증 자료입니다."],
  };
  const text = JSON.stringify(summary);
  const parts = fragmentText(text);
  const snapshotId = crypto.randomUUID();
  expect(
    await f.staging.begin(
      f.guard(),
      {
        id: snapshotId,
        purpose: "summary",
        targetId: f.id,
        revision: 1,
        partCount: parts.length,
        byteLength: utf8Bytes(text),
      },
      summaryLease,
    ),
  ).toBe(true);
  for (const [index, part] of parts.entries())
    expect(await f.staging.append(f.guard(), snapshotId, index, part, summaryLease)).toBe(true);
  for (let index = 0; index < summary.facts.length; index += 4)
    expect(
      await f.summaries.stagePage(
        f.guard(),
        snapshotId,
        {
          facts: summary.facts.slice(index, index + 4),
          parties: index === 0 ? summary.parties : [],
        },
        summaryLease,
      ),
    ).toBe(true);
  expect(
    await f.staging.seal(
      f.guard(),
      snapshotId,
      { schemaVersion: "2", purpose: "summary", targetId: f.id, revision: 1 },
      summaryLease,
    ),
  ).toBe(true);
  const summaryId = crypto.randomUUID();
  expect(
    await f.summaries.publish(
      f.guard(),
      snapshotId,
      {
        summaryId,
        summaryRevision: 1,
        intakeRevision: 2,
        factCount: summary.facts.length,
        partyCount: summary.parties.length,
      },
      summaryLease,
    ),
  ).toBe(true);
  return { summary, summaryId, snapshotId, parts, text };
}

async function reserveFile(f: Fixture, video = false) {
  const input = {
    fileId: crypto.randomUUID(),
    uploadId: crypto.randomUUID(),
    reservationId: crypto.randomUUID(),
    consentId: crypto.randomUUID(),
    expiresAt: "2026-10-06T01:00:00.000Z",
    admission: admission(),
  };
  const name = video ? "합성 영상.mp4" : "합성 자료.pdf";
  const mediaType = video ? "video/mp4" : "application/pdf";
  const reserved = await f.files.reserve(
    f.guard(),
    { name, byteLength: 100, mediaType, autoProcessConsentVersion: "synthetic-v2" },
    input,
  );
  if (!reserved) throw new Error("Synthetic file reservation unavailable");
  expect(reserved.fileId).toBe(input.fileId);
  return { ...input, name, mediaType };
}

async function publishCoverage(f: Fixture, large = false) {
  const r = await reserveFile(f, large);
  const blobId = crypto.randomUUID();
  expect(
    await f.storage.registerBlob(f.actor, {
      id: blobId,
      reservationId: r.reservationId,
      kind: "original",
      visibility: "private",
      logicalBytes: 100,
      cipherBytes: 116,
      cipherHash: "c".repeat(64),
      contentHash: HASH,
      keyVersion: "1",
    }),
  ).toBe(true);
  expect(await f.files.recordPart(f.actor, r.uploadId, 1, 0, blobId, 100, "c".repeat(64))).toBe(
    true,
  );
  expect(await f.files.recordOriginalDigest(f.actor, r.uploadId, 1, HASH)).toBe(true);
  expect(await f.storage.commitReservation(f.actor, r.reservationId)).toBe(true);
  const file: V2File = {
    schemaVersion: "2",
    id: r.fileId,
    revision: 2,
    name: r.name,
    declaredMediaType: r.mediaType,
    byteLength: 100,
    status: "uploaded",
    probe: large
      ? {
          category: "video",
          format: "mp4",
          byteLength: 100,
          durationSeconds: 3600,
          hasAudio: false,
        }
      : { category: "document", format: "pdf", byteLength: 100, pageCount: 1 },
    manifest: {
      byteLength: 100,
      contentHash: HASH,
      parts: [{ index: 0, byteLength: 100, contentHash: HASH }],
    },
    coverage: null,
    observations: [],
    derivatives: [],
    currentJobId: null,
    operationId: r.admission.operationId,
    failure: null,
    createdAt: NOW,
  };
  expect(await f.files.finishUpload(f.guard(), file)).toBe(true);
  const jobId = crypto.randomUUID();
  expect(
    await f.jobs.admitFile(f.guard(), {
      fileId: r.fileId,
      fileRevision: 2,
      jobId,
      admission: admission(),
      quotas: large
        ? [{ kind: "media_processing", originalDurationSeconds: 3600 }]
        : [{ kind: "no_user_quota", reason: "text_extraction" }],
    }),
  ).toBe(true);
  const job = await f.jobs.acquire(f.actor, jobId, crypto.randomUUID(), "2026-10-06T00:04:00.000Z");
  if (!job) throw new Error("Synthetic coverage job unavailable");
  const coverage: V2Coverage = large
    ? {
        category: "video",
        durationSeconds: 3600,
        status: "complete",
        hasAudio: false,
        audio: null,
        frames: Array.from({ length: 20000 }, (_, index) => ({
          id: `frame-${String(index).padStart(5, "0")}`.padEnd(128, "x"),
          timestampSeconds: index % 3600,
          frameIndex: index,
          sampling: index < 3600 ? "one_second" : "scene_change",
          status: "processed",
        })),
        sceneDetection: "complete",
        sceneFrameCount: 16400,
      }
    : {
        category: "document",
        status: "complete",
        pageCount: 1,
        pages: [{ page: 1, status: "processed" }],
      };
  v2CoverageSchema.parse(coverage);
  const text = JSON.stringify(coverage);
  const parts = fragmentText(text);
  const snapshotId = crypto.randomUUID();
  expect(
    await f.staging.begin(
      f.guard(),
      {
        id: snapshotId,
        purpose: "file_coverage",
        targetId: r.fileId,
        revision: 3,
        partCount: parts.length,
        byteLength: utf8Bytes(text),
      },
      job.lease,
    ),
  ).toBe(true);
  for (const [index, part] of parts.entries())
    expect(await f.staging.append(f.guard(), snapshotId, index, part, job.lease)).toBe(true);
  expect(
    await f.staging.seal(
      f.guard(),
      snapshotId,
      { schemaVersion: "2", purpose: "file_coverage", targetId: r.fileId, revision: 3 },
      job.lease,
    ),
  ).toBe(true);
  expect(
    await f.fileStages.publish(
      f.guard(),
      {
        fileId: r.fileId,
        fileRevision: 2,
        coverageSnapshotId: snapshotId,
        observationCount: 0,
        derivativeCount: 0,
      },
      job.lease,
    ),
  ).toBe(true);
  return { fileId: r.fileId, snapshotId, coverage, parts, text };
}

async function collect<T>(stream: AsyncIterable<T>) {
  const values: T[] = [];
  for await (const value of stream) values.push(value);
  return values;
}
function boundedQueries(f: Fixture, count: number) {
  expect(f.queries).toHaveLength(count);
  expect(f.queries.every((query) => query.parameters <= 100 && query.bytes < 16384)).toBe(true);
  expect(f.queries.every((query) => !/FROM v2_private_parts/.test(query.sql))).toBe(true);
}

test("50 workspace metadata rows use two bounded SQL reads and stable cursor pages, without intake decrypts", async () => {
  const f = await fixture();
  for (let index = 0; index < 49; index++)
    await f.create(crypto.randomUUID(), new Date(Date.UTC(2026, 6, index + 1)).toISOString());
  f.reset();
  const rows = await f.ws.list(f.actor, 50);
  expect(rows).toHaveLength(50);
  boundedQueries(f, 2);
  expect(f.decryptions).toHaveLength(50);
  expect(f.decryptions.every((context) => context.table === "v2_workspaces")).toBe(true);
  const page1 = await f.ws.list(f.actor, 20);
  const last = page1.at(-1);
  if (!last) throw new Error("Missing synthetic cursor");
  const page2 = await f.ws.list(f.actor, 20, { createdAt: last.createdAt, id: last.id });
  expect([...page1, ...page2]).toEqual(rows.slice(0, 40));
  await expect(f.ws.list(f.actor, 51)).rejects.toBeDefined();
});

test("workspace list final group guard removes a row archived after AES without suppressing unaffected rows", async () => {
  const f = await fixture();
  const other = crypto.randomUUID();
  await f.create(other);
  let changed = false;
  f.onDecrypt(async (context) => {
    if (!changed && context.table === "v2_workspaces" && context.rowId === f.id) {
      changed = true;
      expect(await f.ws.changeState(f.guard(), "archive")).toBe(true);
    }
  });
  const rows = await f.ws.list(f.actor, 50);
  expect(changed).toBe(true);
  expect(rows.map((row) => row.id)).toEqual([other]);
  expect((await f.ws.findWorkspace(f.actor, f.id))?.status).toBe("archived");
});

test("foreign owner and an actual deleted workspace perform no private AES decryption", async () => {
  const f = await fixture();
  f.reset();
  expect(await f.ws.list(f.stranger, 50)).toEqual([]);
  expect(await f.ws.metadata(f.stranger, f.id)).toBeNull();
  expect(await collect(f.ws.summaryFragments(f.stranger, f.id))).toEqual([]);
  expect(f.decryptions).toEqual([]);
  expect(await f.deletion.workspace(f.guard())).toBe(true);
  f.reset();
  expect(await f.ws.metadata(f.actor, f.id)).toBeNull();
  expect(await f.ws.list(f.actor, 50)).toEqual([]);
  expect(f.decryptions).toEqual([]);
});

test("intake metadata returns bounded questions/answers and >4MiB summary identity without rehydrating its body", async () => {
  const f = await fixture();
  const p = await publishSummary(f, true);
  expect(utf8Bytes(p.text)).toBeGreaterThan(4 * 1024 * 1024);
  f.reset();
  expect(await f.ws.metadata(f.stranger, f.id)).toBeNull();
  expect(await collect(f.ws.summaryFragments(f.stranger, f.id))).toEqual([]);
  expect(f.decryptions).toEqual([]);
  f.reset();
  const metadata = await f.ws.metadata(f.actor, f.id);
  boundedQueries(f, 4);
  expect(metadata?.summary).toEqual({
    id: p.summaryId,
    revision: 1,
    snapshotId: p.snapshotId,
    byteLength: utf8Bytes(p.text),
    partCount: p.parts.length,
  });
  expect(metadata?.batches[0]?.answers[0]).toMatchObject({
    status: "answered",
    value: "합성 자료를 확인했습니다.",
  });
  expect(utf8Bytes(JSON.stringify(metadata))).toBeLessThan(16384);
  expect(f.decryptions.map((context) => context.table)).toEqual([
    "v2_intakes",
    "v2_question_batches",
    "v2_answers",
  ]);
  await expect(f.ws.readIntake(f.actor, f.id)).rejects.toMatchObject({
    code: "SNAPSHOT_STREAM_REQUIRED",
  });
  f.reset();
  const streamed = await collect(f.ws.summaryFragments(f.actor, f.id));
  expect(streamed).toHaveLength(p.parts.length);
  expect(
    streamed.every(
      (part, index) =>
        part.index === index &&
        part.text === p.parts[index] &&
        part.complete === (index === p.parts.length - 1),
    ),
  ).toBe(true);
  expect(streamed.every((part) => utf8Bytes(part.text) <= 65536)).toBe(true);
  expect(f.decryptions.filter((context) => context.table === "v2_private_parts")).toHaveLength(
    p.parts.length,
  );
  const iterator = f.ws.summaryFragments(f.actor, f.id);
  const first = await iterator.next();
  expect(first.done).toBe(false);
  expect(first.value?.complete).toBe(false);
  expect(await f.deletion.workspace(f.guard())).toBe(true);
  expect((await iterator.next()).done).toBe(true);
}, 60000);

test("all three question batches and fifteen answers retain original order through four bounded metadata reads", async () => {
  const f = await fixture();
  const batchIds: string[] = [];
  for (let ordinal = 1; ordinal <= 3; ordinal++) {
    const jobId = crypto.randomUUID();
    expect(await f.jobs.admitWorkspace(f.guard(), admission(), jobId, "intake_questions")).toBe(
      true,
    );
    const job = await f.jobs.acquire(
      f.actor,
      jobId,
      crypto.randomUUID(),
      "2026-10-06T00:04:00.000Z",
    );
    if (!job) throw new Error("Synthetic question lease unavailable");
    const batchId = crypto.randomUUID();
    batchIds.push(batchId);
    const questions = Array.from({ length: 5 }, (_, index) => ({
      id: crypto.randomUUID(),
      prompt: `합성 질문 ${ordinal}-${index}`,
      answerType: "text" as const,
      options: [],
    }));
    expect(
      await f.ws.writeBatch(
        f.guard(),
        { id: batchId, ordinal, generatedForIntakeRevision: ordinal, questions, answers: [] },
        job.lease,
      ),
    ).toBe(true);
    expect(
      await f.ws.answer(f.guard(), batchId, {
        expectedRevision: ordinal,
        answers: questions.map((question, index) => ({
          questionId: question.id,
          status: "answered",
          value: `합성 답변 ${ordinal}-${index}`,
        })),
      }),
    ).toBe(true);
  }
  f.reset();
  const value = await f.ws.metadata(f.actor, f.id);
  boundedQueries(f, 4);
  expect(value?.revision).toBe(4);
  expect(value?.batches.map((batch) => batch.id)).toEqual(batchIds);
  expect(value?.batches.flatMap((batch) => batch.answers)).toHaveLength(15);
  expect(f.decryptions).toHaveLength(19);
  expect(value?.summary).toBeNull();
});

test("workspace tombstone blocks a restored-looking encrypted workspace and its file metadata before any AES", async () => {
  const f = await fixture();
  const r = await reserveFile(f);
  // Synthetic restoration hazard: retained ciphertext plus a durable deletion
  // tombstone must remain inaccessible even when the SQL row still exists.
  f.db.sqlite
    .query("INSERT INTO v2_tombstones(target_kind,target_id,deleted_at) VALUES('workspace',?,?)")
    .run(f.id, NOW);
  f.reset();
  expect(await f.ws.list(f.actor, 50)).toEqual([]);
  expect(await f.ws.metadata(f.actor, f.id)).toBeNull();
  expect(await f.files.metadata(f.actor, r.fileId)).toBeNull();
  expect(await f.files.listMetadata(f.actor, f.id, 50)).toEqual([]);
  expect(await collect(f.ws.summaryFragments(f.actor, f.id))).toEqual([]);
  expect(await collect(f.files.coverageFragments(f.actor, r.fileId))).toEqual([]);
  expect(f.decryptions).toEqual([]);
});

test("intake metadata withholds plaintext if actual workspace deletion occurs after narrative AES", async () => {
  const f = await fixture();
  let deleted = false;
  f.onDecrypt(async (context) => {
    if (!deleted && context.table === "v2_intakes") {
      deleted = true;
      expect(await f.deletion.workspace(f.guard())).toBe(true);
    }
  });
  expect(await f.ws.metadata(f.actor, f.id)).toBeNull();
  expect(deleted).toBe(true);
});

test("intake metadata binds the original encrypted narrative even under a same-revision AES replacement race", async () => {
  const f = await fixture();
  let replaced = false;
  f.onDecrypt(async (context) => {
    if (!replaced && context.table === "v2_intakes") {
      replaced = true;
      const value = await f.core.encrypt("v2_intakes", f.id, f.actor.ownerId, 1, {
        narrative: "같은 revision의 다른 합성 원문으로 조회 경쟁 상태를 재현합니다.",
      });
      // Hostile same-revision DB replacement, not an endorsed production write API.
      f.db.sqlite.query("UPDATE v2_intakes SET encrypted_payload=? WHERE id=?").run(value, f.id);
    }
  });
  expect(await f.ws.metadata(f.actor, f.id)).toBeNull();
  expect(replaced).toBe(true);
});

test("summary fragments stop before yielding a part after current-summary pointer changes", async () => {
  const f = await fixture();
  await publishSummary(f);
  let changed = false;
  f.onDecrypt((context) => {
    if (!changed && context.table === "v2_private_parts") {
      changed = true;
      // Synthetic pointer race; published source parts themselves stay immutable.
      f.db.sqlite
        .query("UPDATE v2_intakes SET summary_id=NULL,status='collecting' WHERE id=?")
        .run(f.id);
    }
  });
  expect(await collect(f.ws.summaryFragments(f.actor, f.id))).toEqual([]);
  expect(changed).toBe(true);
});

test("summary fragments recheck actual deletion between AES and the first outward yield", async () => {
  const f = await fixture();
  await publishSummary(f);
  let deleted = false;
  f.onDecrypt(async (context) => {
    if (!deleted && context.table === "v2_private_parts") {
      deleted = true;
      expect(await f.deletion.workspace(f.guard())).toBe(true);
    }
  });
  expect(await collect(f.ws.summaryFragments(f.actor, f.id))).toEqual([]);
  expect(deleted).toBe(true);
});

test("50 file metadata rows use two bounded SQL reads with ordered nonoverlapping pages", async () => {
  const f = await fixture();
  for (let index = 0; index < 50; index++) await reserveFile(f);
  f.reset();
  const rows = await f.files.listMetadata(f.actor, f.id, 50);
  expect(rows).toHaveLength(50);
  boundedQueries(f, 2);
  expect(f.decryptions).toHaveLength(50);
  expect(f.decryptions.every((context) => context.table === "v2_files")).toBe(true);
  expect(
    rows.every(
      (row) => row.status === "reserved" && row.probe === null && !Object.hasOwn(row, "coverage"),
    ),
  ).toBe(true);
  const page1 = await f.files.listMetadata(f.actor, f.id, 20);
  const page2 = await f.files.listMetadata(f.actor, f.id, 20, page1.at(-1)?.id);
  expect([...page1, ...page2]).toEqual(rows.slice(0, 40));
  await expect(f.files.listMetadata(f.actor, f.id, 51)).rejects.toBeDefined();
  await expect(f.files.list(f.actor, f.id, 5)).rejects.toMatchObject({
    code: "SNAPSHOT_STREAM_REQUIRED",
  });
});

test("file metadata list group guard rejects a deleted entry after AES and preserves the other entry", async () => {
  const f = await fixture();
  const first = await reserveFile(f);
  const second = await reserveFile(f);
  let deleted = false;
  f.onDecrypt(async (context) => {
    if (!deleted && context.table === "v2_files" && context.rowId === first.fileId) {
      deleted = true;
      expect(await f.deletion.file(f.guard(), first.fileId, 1)).toBe(true);
    }
  });
  expect((await f.files.listMetadata(f.actor, f.id, 50)).map((row) => row.id)).toEqual([
    second.fileId,
  ]);
  expect(deleted).toBe(true);
});

test("file metadata and coverage stream reject foreign owners and actual file deletion before decrypt", async () => {
  const f = await fixture();
  const p = await publishCoverage(f);
  f.reset();
  expect(await f.files.metadata(f.stranger, p.fileId)).toBeNull();
  expect(await f.files.listMetadata(f.stranger, f.id, 50)).toEqual([]);
  expect(await collect(f.files.coverageFragments(f.stranger, p.fileId))).toEqual([]);
  expect(f.decryptions).toEqual([]);
  expect(await f.deletion.file(f.guard(), p.fileId, 3)).toBe(true);
  f.reset();
  expect(await f.files.metadata(f.actor, p.fileId)).toBeNull();
  expect(await collect(f.files.coverageFragments(f.actor, p.fileId))).toEqual([]);
  expect(f.decryptions).toEqual([]);
});

test("file metadata binds original name/probe ciphertext under same-revision AES replacement", async () => {
  const f = await fixture();
  const r = await reserveFile(f);
  let replaced = false;
  f.onDecrypt(async (context) => {
    if (!replaced && context.table === "v2_files") {
      replaced = true;
      const value = await f.core.encrypt("v2_files", r.fileId, f.actor.ownerId, 1, {
        name: "다른 합성 자료.pdf",
        declaredMediaType: "application/pdf",
        probe: null,
      });
      // Hostile same-revision mutation must not release the stale decrypted DTO.
      f.db.sqlite.query("UPDATE v2_files SET encrypted_payload=? WHERE id=?").run(value, r.fileId);
    }
  });
  expect(await f.files.metadata(f.actor, r.fileId)).toBeNull();
  expect(replaced).toBe(true);
});

test(">4MiB full video coverage remains available through bounded metadata and exact 64KiB AES fragments", async () => {
  const f = await fixture();
  const p = await publishCoverage(f, true);
  expect(utf8Bytes(p.text)).toBeGreaterThan(4 * 1024 * 1024);
  f.reset();
  const metadata = await f.files.metadata(f.actor, p.fileId);
  boundedQueries(f, 2);
  expect(metadata?.coverageSnapshotId).toBe(p.snapshotId);
  expect(metadata?.probe).toEqual({
    category: "video",
    format: "mp4",
    byteLength: 100,
    durationSeconds: 3600,
    hasAudio: false,
  });
  expect(metadata?.revision).toBe(3);
  expect(metadata?.status).toBe("ready");
  expect(utf8Bytes(JSON.stringify(metadata))).toBeLessThan(4096);
  expect(f.decryptions.map((context) => context.table)).toEqual(["v2_files"]);
  await expect(f.files.read(f.actor, p.fileId)).rejects.toMatchObject({
    code: "SNAPSHOT_STREAM_REQUIRED",
  });
  f.reset();
  const parts = await collect(f.files.coverageFragments(f.actor, p.fileId));
  expect(parts).toHaveLength(p.parts.length);
  expect(
    parts.every(
      (part, index) =>
        part.index === index &&
        part.text === p.parts[index] &&
        part.complete === (index === p.parts.length - 1),
    ),
  ).toBe(true);
  expect(parts.every((part) => utf8Bytes(part.text) <= 65536)).toBe(true);
  expect(f.decryptions.filter((context) => context.table === "v2_private_parts")).toHaveLength(
    p.parts.length,
  );
}, 60000);

test("coverage fragments stop on actual file deletion after part AES before outward yield", async () => {
  const f = await fixture();
  const p = await publishCoverage(f);
  let deleted = false;
  f.onDecrypt(async (context) => {
    if (!deleted && context.table === "v2_private_parts") {
      deleted = true;
      expect(await f.deletion.file(f.guard(), p.fileId, 3)).toBe(true);
    }
  });
  expect(await collect(f.files.coverageFragments(f.actor, p.fileId))).toEqual([]);
  expect(deleted).toBe(true);
});

test("coverage fragments withhold a part when the file revision changes during actual part AES", async () => {
  const f = await fixture();
  const p = await publishCoverage(f);
  let changed = false;
  f.onDecrypt((context) => {
    if (!changed && context.table === "v2_private_parts") {
      changed = true;
      // Synthetic CAS race. Coverage remains published/immutable, file pointer moves.
      f.db.sqlite.query("UPDATE v2_files SET revision=revision+1 WHERE id=?").run(p.fileId);
    }
  });
  expect(await collect(f.files.coverageFragments(f.actor, p.fileId))).toEqual([]);
  expect(changed).toBe(true);
});
