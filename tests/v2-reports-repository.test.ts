import { afterEach, expect, test } from "bun:test";
import {
  type V2PrivateArtifact,
  type V2Report,
  type V2ReportBody,
  type V2ReportFileSelection,
  v2ReportBodySchema,
} from "../src/contracts/v2";
import { createCaseDataCipher } from "../src/server/crypto";
import { createV2AccountingRepository } from "../src/server/db/v2-accounting";
import {
  type Actor,
  createV2Core,
  fragmentText,
  MAX_REHYDRATE_BYTES,
  snapshotStatements,
  utf8Bytes,
} from "../src/server/db/v2-core";
import { createV2DeletionRepository } from "../src/server/db/v2-deletion";
import { createV2JobsRepository } from "../src/server/db/v2-jobs";
import { createV2ReportsRepository } from "../src/server/db/v2-reports";
import { createV2StagingRepository } from "../src/server/db/v2-staging";
import {
  createV2StorageRepository,
  storageReservationStatements,
} from "../src/server/db/v2-storage";
import { createTestDatabase } from "./helpers/d1";
import { seedTestSession } from "./helpers/session";

const NOW = "2026-10-06T00:00:00.000Z";
const HASH = "a".repeat(64);
const databases: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});
async function fixture() {
  const database = await createTestDatabase();
  databases.push(database);
  const owner = await seedTestSession(database, { now: Date.parse(NOW), consent: true });
  const cipher = await createCaseDataCipher({
    CASE_DATA_KEY_V1: btoa("r".repeat(32)).replace(/=+$/, ""),
  });
  const core = createV2Core(database.binding, cipher);
  const actor: Actor = { ownerId: owner.userId, now: NOW };
  await createV2AccountingRepository(core).ensurePrincipal(actor);
  const workspaceId = crypto.randomUUID();
  const envelope = await core.encrypt("v2_workspaces", workspaceId, actor.ownerId, 1, {
    subjectContext: "individual",
    jurisdiction: "KR",
  });
  database.sqlite
    .query(
      "INSERT INTO v2_workspaces(id,owner_id,status,confirmed_summary_revision,encrypted_payload,created_at,updated_at) VALUES(?,?,'active',1,?,?,?)",
    )
    .run(workspaceId, actor.ownerId, envelope, NOW, NOW);
  database.sqlite
    .query("INSERT INTO v2_case_original_usage(workspace_id) VALUES(?)")
    .run(workspaceId);
  return {
    database,
    core,
    actor,
    workspaceId,
    reports: createV2ReportsRepository(core),
    storage: createV2StorageRepository(core),
    jobs: createV2JobsRepository(core),
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function guard(f: Fixture) {
  const row = f.database.sqlite
    .query("SELECT revision FROM v2_workspaces WHERE id=?")
    .get(f.workspaceId) as { revision: number };
  return { ...f.actor, workspaceId: f.workspaceId, expectedRevision: row.revision };
}
function admission() {
  return { operationId: crypto.randomUUID(), key: crypto.randomUUID(), requestHash: HASH };
}
function body(selectedFiles: V2ReportFileSelection[] = []): V2ReportBody {
  return {
    schemaVersion: "2",
    overview: "검토한 합성 사건 리포트",
    parties: [],
    facts: [],
    timeline: [],
    selectedFiles,
    unknowns: [],
    actions: [],
    lawyerQuestions: [],
    citations: [],
    legalSourceStatus: "not_requested",
    notices: ["합성 테스트 자료"],
    generatedAt: NOW,
  };
}
function draft(
  f: Fixture,
  files: V2ReportFileSelection[] = [],
  originals: string[] = [],
): V2Report {
  const revision = guard(f).expectedRevision;
  const base = {
    expectedRevision: revision,
    selectedFileIds: files.map((file) => file.id),
    editedFields: [],
    maskingChoices: [],
    reviewConfirmed: true as const,
  };
  return {
    schemaVersion: "2",
    id: crypto.randomUUID(),
    version: 1,
    snapshotRevision: revision,
    summaryRevision: 1,
    createdAt: NOW,
    status: "queued",
    request: originals.length
      ? {
          ...base,
          includeOriginals: true,
          originalsUnmaskedAcknowledged: true,
          selectedOriginalFileIds: originals,
        }
      : { ...base, includeOriginals: false },
    body: body(files),
    pdf: null,
    originalsZip: null,
    originalManifest: [],
    currentJobId: crypto.randomUUID(),
    failure: null,
  };
}
async function readyFile(
  f: Fixture,
  name = "검토한 합성 파일.pdf",
): Promise<V2ReportFileSelection> {
  const id = crypto.randomUUID();
  const op = crypto.randomUUID();
  f.database.sqlite
    .query(
      "INSERT INTO v2_operations(id,owner_id,workspace_id,kind,revision,created_at) VALUES(?,?,?,'file_extract',1,?)",
    )
    .run(op, f.actor.ownerId, f.workspaceId, NOW);
  const manifestId = crypto.randomUUID();
  const coverageId = crypto.randomUUID();
  const claimId = crypto.randomUUID();
  expect(
    await f.core.changed([
      f.core.claim(guard(f), claimId),
      ...(await snapshotStatements(
        f.core,
        {
          id: manifestId,
          ownerId: f.actor.ownerId,
          workspaceId: f.workspaceId,
          targetId: id,
          revision: 1,
          purpose: "file_manifest",
          now: NOW,
        },
        {
          byteLength: 100,
          contentHash: HASH,
          parts: [{ index: 0, byteLength: 100, contentHash: HASH }],
        },
        claimId,
      )),
      ...(await snapshotStatements(
        f.core,
        {
          id: coverageId,
          ownerId: f.actor.ownerId,
          workspaceId: f.workspaceId,
          targetId: id,
          revision: 1,
          purpose: "file_coverage",
          now: NOW,
        },
        {
          category: "document",
          status: "complete",
          pageCount: 1,
          pages: [{ page: 1, status: "processed" }],
        },
        claimId,
      )),
      f.core.finish(claimId),
    ]),
  ).toBe(true);
  const metadata = await f.core.encrypt("v2_files", id, f.actor.ownerId, 1, {
    name,
    declaredMediaType: "application/pdf",
    probe: { category: "document", format: "pdf", byteLength: 100, pageCount: 1 },
  });
  f.database.sqlite
    .query(
      "INSERT INTO v2_files(id,workspace_id,operation_id,state,declared_bytes,probe_kind,manifest_snapshot_id,coverage_snapshot_id,encrypted_payload,created_at,updated_at) VALUES(?,?,?,'ready',100,'document',?,?,?,?,?)",
    )
    .run(id, f.workspaceId, op, manifestId, coverageId, metadata, NOW, NOW);
  return { id, revision: 1, contentHash: HASH, byteLength: 100, name };
}
async function create(f: Fixture, value = draft(f)) {
  const input = admission();
  expect(await f.reports.createSmall(guard(f), value, input)).toBe(true);
  if (!value.currentJobId) throw new Error("Synthetic report requires job");
  const acquired = await f.jobs.acquire(
    f.actor,
    value.currentJobId,
    crypto.randomUUID(),
    "2026-10-06T00:01:00.000Z",
  );
  if (!acquired) throw new Error("Synthetic report lease did not acquire");
  return { value, input, lease: acquired.lease };
}
// Real encrypted blob registration and reservation primitives; no actual PDF/ZIP/R2 write is claimed.
async function artifact(
  f: Fixture,
  report: Awaited<ReturnType<typeof create>>,
  kind: "report_pdf" | "original_zip" | "derivative" = "report_pdf",
  overrides: { ownerId?: string; entityId?: string } = {},
): Promise<V2PrivateArtifact> {
  const id = crypto.randomUUID();
  const reservationId = crypto.randomUUID();
  const claimId = crypto.randomUUID();
  const ownerActor = { ...f.actor, ownerId: overrides.ownerId ?? f.actor.ownerId };
  expect(
    await f.core.changed([
      f.core.claim(guard(f), claimId),
      ...storageReservationStatements(
        f.core,
        ownerActor,
        {
          id: reservationId,
          kind: "derived_or_report",
          caseId: f.workspaceId,
          operationId: overrides.entityId ?? report.value.id,
          byteLength: 100,
          state: "reserved",
        },
        report.input.operationId,
        claimId,
        id,
      ),
      f.core.finish(claimId),
    ]),
  ).toBe(true);
  expect(
    await f.storage.registerBlob(ownerActor, {
      id,
      reservationId,
      kind,
      visibility: "private",
      logicalBytes: 100,
      cipherBytes: 128,
      cipherHash: HASH,
      contentHash: HASH,
      keyVersion: "1",
    }),
  ).toBe(true);
  return { id, encryption: "chunk_aead_v1", byteLength: 100, contentHash: HASH };
}
function count(f: Fixture, table: string) {
  return (f.database.sqlite.query(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
}

async function stageBody(f: Fixture, value: V2Report, fragmentBytes = 64 * 1024) {
  // Validate the complete producer output before the bounded encrypted write path.
  const text = JSON.stringify(v2ReportBodySchema().parse(value.body));
  const parts = fragmentText(text, fragmentBytes);
  const snapshotId = crypto.randomUUID();
  const staging = createV2StagingRepository(f.core);
  const g = guard(f);
  expect(
    await staging.begin(g, {
      id: snapshotId,
      purpose: "report",
      targetId: value.id,
      revision: value.snapshotRevision,
      partCount: parts.length,
      byteLength: utf8Bytes(text),
    }),
  ).toBe(true);
  for (const [index, part] of parts.entries()) {
    expect(await staging.append(g, snapshotId, index, part)).toBe(true);
  }
  expect(
    await staging.seal(g, snapshotId, {
      schemaVersion: "2",
      purpose: "report",
      targetId: value.id,
      revision: value.snapshotRevision,
    }),
  ).toBe(true);
  if (!value.currentJobId) throw new Error("Synthetic staged report requires job");
  const input = {
    id: value.id,
    snapshotId,
    summaryRevision: value.summaryRevision,
    request: value.request,
    selectedFiles: value.body.selectedFiles,
    jobId: value.currentJobId,
    admission: admission(),
  };
  return { staging, snapshotId, g, text, parts, input };
}

async function stageFiles(
  f: Fixture,
  staged: Awaited<ReturnType<typeof stageBody>>,
  files: V2ReportFileSelection[],
) {
  for (let ordinal = 0; ordinal < files.length; ordinal += 4) {
    expect(
      await f.reports.stageSelections(staged.g, {
        reportId: staged.input.id,
        snapshotId: staged.snapshotId,
        ordinal,
        files: files.slice(ordinal, ordinal + 4),
      }),
    ).toBe(true);
  }
}

test("reviewed immutable snapshot preserves exactly selected ZIP originals and file labels", async () => {
  const f = await fixture();
  const first = await readyFile(f);
  const second = await readyFile(f, "ZIP에서 제외한 합성 파일.pdf");
  const r = await create(f, draft(f, [first, second], [first.id]));
  const pdf = await artifact(f, r);
  const zip = await artifact(f, r, "original_zip");
  expect(await f.reports.complete(guard(f), r.value.id, r.lease, pdf, zip)).toBe(true);
  const read = await f.reports.read(f.actor, r.value.id);
  expect(read?.body.selectedFiles).toEqual([first, second]);
  expect(read?.originalManifest).toEqual([first]);
  expect(read?.pdf).toEqual(pdf);
  expect(read?.originalsZip).toEqual(zip);
  expect(await f.reports.complete(guard(f), r.value.id, r.lease, pdf, zip)).toBe(false);
  const stored = f.database.sqlite
    .query("SELECT encrypted_payload FROM v2_report_selections")
    .all() as { encrypted_payload: string }[];
  expect(stored.every((row) => !row.encrypted_payload.includes(first.name))).toBe(true);
  expect(count(f, "v2_mutation_claims")).toBe(0);
});

test("cross-owner read/complete and mismatched artifact hash/bytes/kind are rejected", async () => {
  const f = await fixture();
  const r = await create(f);
  const pdf = await artifact(f, r);
  const wrongKind = await artifact(f, r, "derivative");
  const other = await seedTestSession(f.database);
  expect(await f.reports.read({ ownerId: other.userId, now: NOW }, r.value.id)).toBeNull();
  expect(
    await f.reports.complete(
      { ...guard(f), ownerId: other.userId },
      r.value.id,
      r.lease,
      pdf,
      null,
    ),
  ).toBe(false);
  expect(
    await f.reports.complete(
      guard(f),
      r.value.id,
      r.lease,
      { ...pdf, contentHash: "b".repeat(64) },
      null,
    ),
  ).toBe(false);
  expect(
    await f.reports.complete(guard(f), r.value.id, r.lease, { ...pdf, byteLength: 99 }, null),
  ).toBe(false);
  expect(await f.reports.complete(guard(f), r.value.id, r.lease, wrongKind, null)).toBe(false);
  expect((await f.reports.read(f.actor, r.value.id))?.status).toBe("queued");
});

test("same-workspace PDF from another report cannot be substituted", async () => {
  const f = await fixture();
  const first = await create(f);
  const firstPdf = await artifact(f, first);
  const second = await create(f);
  expect(await f.reports.complete(guard(f), second.value.id, second.lease, firstPdf, null)).toBe(
    false,
  );
  expect((await f.reports.read(f.actor, second.value.id))?.status).toBe("queued");
});

test("same-workspace ZIP from another report cannot be substituted", async () => {
  const f = await fixture();
  const selected = await readyFile(f);
  const first = await create(f, draft(f, [selected], [selected.id]));
  const firstZip = await artifact(f, first, "original_zip");
  const second = await create(f, draft(f, [selected], [selected.id]));
  const secondPdf = await artifact(f, second);
  expect(
    await f.reports.complete(guard(f), second.value.id, second.lease, secondPdf, firstZip),
  ).toBe(false);
});

test("selection name/hash/bytes must come from the current owned original", async () => {
  const f = await fixture();
  const selected = await readyFile(f);
  for (const forged of [
    { ...selected, name: "위조된 합성 이름.pdf" },
    { ...selected, contentHash: "b".repeat(64) },
    { ...selected, byteLength: 99 },
  ]) {
    await expect(f.reports.createSmall(guard(f), draft(f, [forged]), admission())).resolves.toBe(
      false,
    );
  }
  expect(count(f, "v2_reports")).toBe(0);
});

test("missing or stale selected files reject before persisting report, snapshot, operation or claim", async () => {
  const f = await fixture();
  const selected = await readyFile(f);
  const operationsBefore = count(f, "v2_operations");
  const snapshotsBefore = count(f, "v2_private_snapshots");
  expect(
    await f.reports.createSmall(guard(f), draft(f, [{ ...selected, revision: 2 }]), admission()),
  ).toBe(false);
  expect(count(f, "v2_reports")).toBe(0);
  expect(count(f, "v2_operations")).toBe(operationsBefore);
  expect(count(f, "v2_private_snapshots")).toBe(snapshotsBefore);
  expect(count(f, "v2_mutation_claims")).toBe(0);
});

test("lease token/fence/expiry and workspace snapshot CAS reject stale publication", async () => {
  const f = await fixture();
  const r = await create(f);
  const pdf = await artifact(f, r);
  expect(
    await f.reports.complete(
      guard(f),
      r.value.id,
      { ...r.lease, token: crypto.randomUUID() },
      pdf,
      null,
    ),
  ).toBe(false);
  expect(
    await f.reports.complete(
      guard(f),
      r.value.id,
      { ...r.lease, fencing: r.lease.fencing + 1 },
      pdf,
      null,
    ),
  ).toBe(false);
  expect(
    await f.reports.complete(
      { ...guard(f), now: "2026-10-06T00:01:00.000Z" },
      r.value.id,
      r.lease,
      pdf,
      null,
    ),
  ).toBe(false);
  expect(
    await f.reports.complete(
      { ...guard(f), expectedRevision: guard(f).expectedRevision - 1 },
      r.value.id,
      r.lease,
      pdf,
      null,
    ),
  ).toBe(false);
  expect((await f.reports.read(f.actor, r.value.id))?.status).toBe("queued");
});

test("workspace/file deletion tombstone prevents report publish and private read", async () => {
  const f = await fixture();
  const selected = await readyFile(f);
  const r = await create(f, draft(f, [selected]));
  const pdf = await artifact(f, r);
  f.database.sqlite.query("INSERT INTO v2_tombstones VALUES('file',?,?)").run(selected.id, NOW);
  expect(await f.reports.complete(guard(f), r.value.id, r.lease, pdf, null)).toBe(false);
  f.database.sqlite
    .query("INSERT INTO v2_tombstones VALUES('workspace',?,?)")
    .run(f.workspaceId, NOW);
  expect(await f.reports.read(f.actor, r.value.id)).toBeNull();
  expect(await f.reports.complete(guard(f), r.value.id, r.lease, pdf, null)).toBe(false);
});

test("actual SQL publication failure rolls back artifacts, job completion and workspace bump", async () => {
  const f = await fixture();
  const r = await create(f);
  const pdf = await artifact(f, r);
  const revision = guard(f).expectedRevision;
  f.database.sqlite.exec(
    "CREATE TRIGGER reject_synthetic_report BEFORE UPDATE OF state ON v2_reports BEGIN SELECT RAISE(ABORT,'synthetic report rollback'); END;",
  );
  await expect(f.reports.complete(guard(f), r.value.id, r.lease, pdf, null)).rejects.toThrow(
    "DB_OPERATION_FAILED",
  );
  expect(guard(f).expectedRevision).toBe(revision);
  expect((await f.jobs.find(f.actor, r.lease.jobId))?.status).toBe("running");
  expect((await f.reports.read(f.actor, r.value.id))?.pdf).toBeNull();
  expect(count(f, "v2_mutation_claims")).toBe(0);
  f.database.sqlite.exec("DROP TRIGGER reject_synthetic_report");
  expect(await f.reports.complete(guard(f), r.value.id, r.lease, pdf, null)).toBe(true);
});

test("current report job pointer must match the otherwise valid lease", async () => {
  const f = await fixture();
  const r = await create(f);
  const pdf = await artifact(f, r);
  f.database.sqlite
    .query("UPDATE v2_reports SET current_job_id=? WHERE id=?")
    .run(crypto.randomUUID(), r.value.id);
  expect(await f.reports.complete(guard(f), r.value.id, r.lease, pdf, null)).toBe(false);
});

test("workspace tombstone during real AES read prevents returning the previously authorized snapshot", async () => {
  const f = await fixture();
  const r = await create(f);
  const decrypt = f.core.cipher.decrypt.bind(f.core.cipher);
  let interrupted = false;
  f.core.cipher.decrypt = async (envelope, context) => {
    const plaintext = await decrypt(envelope, context);
    if (!interrupted && context.table === "v2_private_parts") {
      interrupted = true;
      f.database.sqlite
        .query("INSERT INTO v2_tombstones VALUES('workspace',?,?)")
        .run(f.workspaceId, NOW);
    }
    return plaintext;
  };
  expect(await f.reports.read(f.actor, r.value.id)).toBeNull();
  expect(interrupted).toBe(true);
});

test("workspace deletion during metadata decryption prevents late publication", async () => {
  const f = await fixture();
  const r = await create(f);
  const pdf = await artifact(f, r);
  const decrypt = f.core.cipher.decrypt.bind(f.core.cipher);
  let interrupted = false;
  f.core.cipher.decrypt = async (envelope, context) => {
    const plaintext = await decrypt(envelope, context);
    if (!interrupted && context.table === "v2_reports") {
      interrupted = true;
      f.database.sqlite
        .query("INSERT INTO v2_tombstones VALUES('workspace',?,?)")
        .run(f.workspaceId, NOW);
    }
    return plaintext;
  };
  expect(await f.reports.complete(guard(f), r.value.id, r.lease, pdf, null)).toBe(false);
  expect(interrupted).toBe(true);
  expect(
    f.database.sqlite.query("SELECT state,pdf_blob_id FROM v2_reports WHERE id=?").get(r.value.id),
  ).toEqual({ state: "queued", pdf_blob_id: null });
});

test("a file changing after authoritative preflight makes the final selection claim roll back", async () => {
  const f = await fixture();
  const selected = await readyFile(f);
  const row = f.database.sqlite
    .query("SELECT manifest_snapshot_id FROM v2_files WHERE id=?")
    .get(selected.id) as { manifest_snapshot_id: string };
  const operations = count(f, "v2_operations");
  const snapshots = count(f, "v2_private_snapshots");
  const decrypt = f.core.cipher.decrypt.bind(f.core.cipher);
  let changed = false;
  f.core.cipher.decrypt = async (envelope, context) => {
    const plaintext = await decrypt(envelope, context);
    if (
      !changed &&
      context.table === "v2_private_snapshots" &&
      context.rowId === row.manifest_snapshot_id
    ) {
      changed = true;
      f.database.sqlite.query("UPDATE v2_files SET state='uploaded' WHERE id=?").run(selected.id);
    }
    return plaintext;
  };
  await expect(f.reports.createSmall(guard(f), draft(f, [selected]), admission())).rejects.toThrow(
    "DB_OPERATION_FAILED",
  );
  expect(changed).toBe(true);
  expect(count(f, "v2_reports")).toBe(0);
  expect(count(f, "v2_operations")).toBe(operations);
  expect(count(f, "v2_private_snapshots")).toBe(snapshots);
  expect(count(f, "v2_mutation_claims")).toBe(0);
});

test("completed report retains its reviewed file revision and name after later file edits", async () => {
  const f = await fixture();
  const selected = await readyFile(f);
  const r = await create(f, draft(f, [selected], [selected.id]));
  const pdf = await artifact(f, r);
  const zip = await artifact(f, r, "original_zip");
  expect(await f.reports.complete(guard(f), r.value.id, r.lease, pdf, zip)).toBe(true);
  const metadata = await f.core.encrypt("v2_files", selected.id, f.actor.ownerId, 2, {
    name: "나중에 수정한 합성 파일.pdf",
    declaredMediaType: "application/pdf",
    probe: { category: "document", format: "pdf", byteLength: 100, pageCount: 1 },
  });
  f.database.sqlite
    .query("UPDATE v2_files SET revision=2,encrypted_payload=? WHERE id=?")
    .run(metadata, selected.id);
  const read = await f.reports.read(f.actor, r.value.id);
  expect(read?.body.selectedFiles).toEqual([selected]);
  expect(read?.originalManifest).toEqual([selected]);
});

test("a real private artifact from another account in the same database is rejected", async () => {
  const f = await fixture();
  const own = await create(f);
  const other = await seedTestSession(f.database, { consent: true });
  const actor = { ownerId: other.userId, now: NOW };
  await createV2AccountingRepository(f.core).ensurePrincipal(actor);
  const workspaceId = crypto.randomUUID();
  const envelope = await f.core.encrypt("v2_workspaces", workspaceId, actor.ownerId, 1, {
    subjectContext: "individual",
    jurisdiction: "KR",
  });
  f.database.sqlite
    .query(
      "INSERT INTO v2_workspaces(id,owner_id,status,confirmed_summary_revision,encrypted_payload,created_at,updated_at) VALUES(?,?,'active',1,?,?,?)",
    )
    .run(workspaceId, actor.ownerId, envelope, NOW, NOW);
  const foreign = { ...f, actor, workspaceId };
  const otherReport = await create(foreign);
  const foreignPdf = await artifact(foreign, otherReport);
  expect(await f.reports.complete(guard(f), own.value.id, own.lease, foreignPdf, null)).toBe(false);
  expect((await f.reports.read(f.actor, own.value.id))?.pdf).toBeNull();
});

test("reviewed request/body are immutable after caller edits its original objects", async () => {
  const f = await fixture();
  const value = draft(f);
  value.request.editedFields = [{ field: "overview", text: "사용자가 검토한 합성 요약" }];
  value.body.overview = "사용자가 검토한 합성 요약";
  const r = await create(f, value);
  value.request.editedFields.splice(0);
  value.body.overview = "저장 후 호출자가 바꾼 합성 내용";
  const read = await f.reports.read(f.actor, r.value.id);
  expect(read?.request.editedFields).toEqual([
    { field: "overview", text: "사용자가 검토한 합성 요약" },
  ]);
  expect(read?.body.overview).toBe("사용자가 검토한 합성 요약");
});

test("100 Unicode file selections and a large valid report stream without silent truncation", async () => {
  const f = await fixture();
  const files: V2ReportFileSelection[] = [];
  for (let index = 0; index < 100; index++) {
    const name = `${String(index).padStart(3, "0")}${"가".repeat(124)}${"😀".repeat(124)}.pdf`;
    expect([...name].length).toBe(255);
    expect(name.length).toBeGreaterThan(255);
    files.push(await readyFile(f, name));
  }
  const originals = files.filter((_, index) => index % 2 === 0);
  const value = draft(
    f,
    files,
    originals.map((file) => file.id),
  );
  value.body.facts = Array.from({ length: 300 }, () => ({
    id: crypto.randomUUID(),
    text: "검".repeat(2000),
    attribution: "user_statement",
    certainty: "reported",
    significance: "neutral",
    references: Array.from({ length: 100 }, () => ({
      kind: "intake_narrative",
      intakeRevision: 1,
    })),
    conflictingFactIds: [],
    userEdited: false,
  }));
  value.body.timeline = Array.from({ length: 300 }, () => ({
    id: crypto.randomUUID(),
    revision: 1,
    date: null,
    datePrecision: "unknown",
    event: "토".repeat(2000),
    certainty: "reported",
    references: [],
    factIds: [],
    userEdited: false,
  }));
  value.body.unknowns = Array.from({ length: 100 }, () => "미".repeat(1000));
  const staged = await stageBody(f, value);
  expect(utf8Bytes(staged.text)).toBeGreaterThan(MAX_REHYDRATE_BYTES);
  expect(utf8Bytes(staged.text)).toBeGreaterThan(5_000_000);
  expect(await f.reports.metadata(f.actor, value.id)).toBeNull();
  expect(await f.reports.readSelections(f.actor, value.id)).toEqual([]);
  expect((await f.reports.bodyFragments(f.actor, value.id).next()).done).toBe(true);
  await stageFiles(f, staged, files);
  const stageCount = count(f, "v2_report_selection_stages");
  expect(
    await f.reports.stageSelections(staged.g, {
      reportId: value.id,
      snapshotId: staged.snapshotId,
      ordinal: 0,
      files: files.slice(0, 4),
    }),
  ).toBe(true);
  expect(count(f, "v2_report_selection_stages")).toBe(stageCount);
  expect(await f.reports.createFromStaged(staged.g, staged.input)).toBe(true);
  expect((await f.reports.metadata(f.actor, value.id))?.request).toEqual(value.request);
  await expect(f.reports.read(f.actor, value.id)).rejects.toThrow("SNAPSHOT_STREAM_REQUIRED");
  const received: V2ReportFileSelection[] = [];
  let after = -1;
  while (true) {
    const page = await f.reports.readSelections(f.actor, value.id, after, 4);
    if (!page.length) break;
    expect(page[0]?.ordinal).toBe(after + 1);
    expect(page.length).toBeLessThanOrEqual(4);
    received.push(...page.map((entry) => entry.file));
    after = page[page.length - 1]?.ordinal ?? after;
  }
  expect(received).toEqual(files);
  const originalFiles: V2ReportFileSelection[] = [];
  after = -1;
  while (true) {
    const page = await f.reports.readSelections(f.actor, value.id, after, 4, true);
    if (!page.length) break;
    expect(page.every((entry) => entry.originalSelected && entry.ordinal % 2 === 0)).toBe(true);
    originalFiles.push(...page.map((entry) => entry.file));
    after = page[page.length - 1]?.ordinal ?? after;
  }
  expect(originalFiles).toEqual(originals);
  const receivedParts: string[] = [];
  let completed = 0;
  const decrypt = f.core.cipher.decrypt.bind(f.core.cipher);
  let decryptedParts = 0;
  f.core.cipher.decrypt = async (envelope, context) => {
    const plaintext = await decrypt(envelope, context);
    if (context.table === "v2_private_parts") decryptedParts++;
    return plaintext;
  };
  for await (const part of f.reports.bodyFragments(f.actor, value.id)) {
    expect(part.index).toBe(receivedParts.length);
    // Each consumer yield decrypts exactly one bounded fragment, not the entire report.
    expect(decryptedParts).toBe(part.index + 1);
    expect(utf8Bytes(part.text)).toBeLessThanOrEqual(64 * 1024);
    if (part.complete) {
      completed++;
      expect(part.index).toBe(staged.parts.length - 1);
    }
    receivedParts.push(part.text);
  }
  expect(completed).toBe(1);
  expect(receivedParts.length).toBe(staged.parts.length);
  expect(utf8Bytes(receivedParts.join(""))).toBe(utf8Bytes(staged.text));
  expect(v2ReportBodySchema().parse(JSON.parse(receivedParts.join("")))).toEqual(value.body);
  const row = f.database.sqlite
    .query("SELECT encrypted_payload FROM v2_report_selection_stages LIMIT 1")
    .get() as { encrypted_payload: string };
  expect(row.encrypted_payload).not.toContain(files[0]?.name ?? "missing");
}, 20_000);

test("missing, reordered or substituted staged selections cannot publish a report", async () => {
  const f = await fixture();
  const first = await readyFile(f);
  const second = await readyFile(f, "두 번째 검토 파일.pdf");
  const files = [first, second];
  const staged = await stageBody(f, draft(f, files));
  const operations = count(f, "v2_operations");
  expect(await f.reports.createFromStaged(staged.g, staged.input)).toBe(false);
  await stageFiles(f, staged, files);
  expect(
    await f.reports.createFromStaged(staged.g, {
      ...staged.input,
      selectedFiles: [...files].reverse(),
    }),
  ).toBe(false);
  expect(
    await f.reports.createFromStaged(staged.g, {
      ...staged.input,
      selectedFiles: [{ ...first, contentHash: "b".repeat(64) }, second],
    }),
  ).toBe(false);
  expect(
    await f.reports.stageSelections(staged.g, {
      reportId: staged.input.id,
      snapshotId: staged.snapshotId,
      ordinal: 0,
      files: [{ ...first, name: "검토하지 않은 다른 이름.pdf" }],
    }),
  ).toBe(false);
  expect(count(f, "v2_reports")).toBe(0);
  expect(count(f, "v2_operations")).toBe(operations);
  expect(count(f, "v2_mutation_claims")).toBe(0);
  expect(
    f.database.sqlite
      .query("SELECT state FROM v2_private_snapshots WHERE id=?")
      .get(staged.snapshotId),
  ).toEqual({ state: "sealed" });
  expect(await f.reports.createFromStaged(staged.g, staged.input)).toBe(true);
});

test("a reviewed source changing after durable selection staging rolls back final publication", async () => {
  const f = await fixture();
  const file = await readyFile(f);
  const staged = await stageBody(f, draft(f, [file]));
  await stageFiles(f, staged, [file]);
  const operations = count(f, "v2_operations");
  f.database.sqlite.query("UPDATE v2_files SET revision=revision+1 WHERE id=?").run(file.id);
  await expect(f.reports.createFromStaged(staged.g, staged.input)).rejects.toThrow(
    "DB_OPERATION_FAILED",
  );
  expect(count(f, "v2_reports")).toBe(0);
  expect(count(f, "v2_operations")).toBe(operations);
  expect(count(f, "v2_report_selections")).toBe(0);
  expect(count(f, "v2_mutation_claims")).toBe(0);
  expect(count(f, "v2_report_selection_stages")).toBe(1);
  expect(
    f.database.sqlite
      .query("SELECT state FROM v2_private_snapshots WHERE id=?")
      .get(staged.snapshotId),
  ).toEqual({ state: "sealed" });
  expect(guard(f).expectedRevision).toBe(staged.g.expectedRevision);
});

test("report snapshot substitution during completion cannot pass its original CAS", async () => {
  const f = await fixture();
  const first = await create(f);
  const second = await create(f);
  const row = f.database.sqlite
    .query("SELECT snapshot_id FROM v2_reports WHERE id=?")
    .get(second.value.id) as { snapshot_id: string };
  const pdf = await artifact(f, first);
  const decrypt = f.core.cipher.decrypt.bind(f.core.cipher);
  let replaced = false;
  f.core.cipher.decrypt = async (envelope, context) => {
    const plaintext = await decrypt(envelope, context);
    if (!replaced && context.table === "v2_reports" && context.rowId === first.value.id) {
      replaced = true;
      f.database.sqlite
        .query("UPDATE v2_reports SET snapshot_id=? WHERE id=?")
        .run(row.snapshot_id, first.value.id);
    }
    return plaintext;
  };
  expect(await f.reports.complete(guard(f), first.value.id, first.lease, pdf, null)).toBe(false);
  expect(replaced).toBe(true);
  expect(
    f.database.sqlite
      .query("SELECT state,pdf_blob_id FROM v2_reports WHERE id=?")
      .get(first.value.id),
  ).toEqual({ state: "queued", pdf_blob_id: null });
});

test("workspace deletion stops an owned report stream and subsequent selection/metadata reads", async () => {
  const f = await fixture();
  const file = await readyFile(f);
  const value = draft(f, [file]);
  value.body.overview = "합성".repeat(200);
  const staged = await stageBody(f, value, 256);
  await stageFiles(f, staged, [file]);
  expect(await f.reports.createFromStaged(staged.g, staged.input)).toBe(true);
  const stream = f.reports.bodyFragments(f.actor, value.id);
  const first = await stream.next();
  expect(first.done).toBe(false);
  expect(first.value?.complete).toBe(false);
  f.database.sqlite
    .query("INSERT INTO v2_tombstones VALUES('workspace',?,?)")
    .run(f.workspaceId, NOW);
  expect((await stream.next()).done).toBe(true);
  expect(await f.reports.metadata(f.actor, value.id)).toBeNull();
  expect(await f.reports.readSelections(f.actor, value.id)).toEqual([]);
});

test("staging and paged/streamed reads remain bound to the actual report and owner", async () => {
  const f = await fixture();
  const file = await readyFile(f);
  const value = draft(f, [file]);
  const staged = await stageBody(f, value);
  const other = await seedTestSession(f.database, { consent: true });
  const foreign = { ownerId: other.userId, now: NOW };
  expect(
    await f.reports.stageSelections(staged.g, {
      reportId: crypto.randomUUID(),
      snapshotId: staged.snapshotId,
      ordinal: 0,
      files: [file],
    }),
  ).toBe(false);
  expect(count(f, "v2_report_selection_stages")).toBe(0);
  const decrypt = f.core.cipher.decrypt.bind(f.core.cipher);
  let foreignDecryptions = 0;
  f.core.cipher.decrypt = async (envelope, context) => {
    foreignDecryptions++;
    return decrypt(envelope, context);
  };
  expect(
    await f.reports.stageSelections(
      { ...staged.g, ...foreign },
      {
        reportId: value.id,
        snapshotId: staged.snapshotId,
        ordinal: 0,
        files: [file],
      },
    ),
  ).toBe(false);
  expect(foreignDecryptions).toBe(0);
  f.core.cipher.decrypt = decrypt;
  await stageFiles(f, staged, [file]);
  expect(
    await f.reports.createFromStaged(staged.g, { ...staged.input, id: crypto.randomUUID() }),
  ).toBe(false);
  expect(count(f, "v2_reports")).toBe(0);
  expect(await f.reports.createFromStaged(staged.g, staged.input)).toBe(true);
  expect(await f.reports.metadata(foreign, value.id)).toBeNull();
  expect(await f.reports.readSelections(foreign, value.id)).toEqual([]);
  expect((await f.reports.bodyFragments(foreign, value.id).next()).done).toBe(true);
  expect((await f.reports.readSelections(f.actor, value.id))[0]?.file).toEqual(file);
});

test("a truncated persisted report stream fails instead of claiming a complete snapshot", async () => {
  const f = await fixture();
  const value = draft(f);
  value.body.overview = "잘림 검증 합성 자료".repeat(100);
  const staged = await stageBody(f, value, 256);
  expect(await f.reports.createFromStaged(staged.g, staged.input)).toBe(true);
  const stream = f.reports.bodyFragments(f.actor, value.id);
  expect((await stream.next()).value?.complete).toBe(false);
  f.database.sqlite
    .query("DELETE FROM v2_private_parts WHERE snapshot_id=? AND part_index=?")
    .run(staged.snapshotId, staged.parts.length - 1);
  let completed = false;
  await expect(
    (async () => {
      for await (const part of stream) completed ||= part.complete;
    })(),
  ).rejects.toThrow("SNAPSHOT_INVALID");
  expect(completed).toBe(false);
});

test("report original artifact changes during decrypt cannot publish stale hash metadata", async () => {
  const f = await fixture();
  const r = await create(f);
  const pdf = await artifact(f, r);
  const actual = f.core.cipher;
  let changed = false;
  const observed = createV2Core(f.database.binding, {
    encrypt: actual.encrypt.bind(actual),
    async decrypt(envelope, context) {
      const text = await actual.decrypt(envelope, context);
      if (context.table === "v2_blobs" && context.rowId === pdf.id && !changed) {
        changed = true;
        const replacement = await actual.encrypt(
          JSON.stringify({ contentHash: "b".repeat(64) }),
          context,
        );
        f.database.sqlite
          .query("UPDATE v2_blobs SET encrypted_payload=? WHERE id=?")
          .run(replacement, pdf.id);
      }
      return text;
    },
  });
  expect(
    await createV2ReportsRepository(observed).complete(guard(f), r.value.id, r.lease, pdf, null),
  ).toBe(false);
  expect(changed).toBe(true);
  expect(
    f.database.sqlite.query("SELECT state,pdf_blob_id FROM v2_reports WHERE id=?").get(r.value.id),
  ).toEqual({ state: "queued", pdf_blob_id: null });
  expect(count(f, "v2_mutation_claims")).toBe(0);
});
test("report obsolete marking and explicit owned deletion retain opaque cleanup before releasing artifacts", async () => {
  const f = await fixture();
  const r = await create(f);
  const pdf = await artifact(f, r);
  expect(await f.reports.complete(guard(f), r.value.id, r.lease, pdf, null)).toBe(true);
  expect(await f.reports.markObsolete(guard(f), r.value.id)).toBe(true);
  expect((await f.reports.read(f.actor, r.value.id))?.status).toBe("obsolete");
  expect(await f.reports.markObsolete(guard(f), r.value.id)).toBe(false);
  const deletion = createV2DeletionRepository(f.core);
  expect(await deletion.report({ ...guard(f), expectedRevision: 1 }, r.value.id, 1)).toBe(false);
  expect(await deletion.report(guard(f), r.value.id, 1)).toBe(true);
  expect(await f.reports.read(f.actor, r.value.id)).toBeNull();
  expect(await deletion.findByTarget("report", r.value.id)).not.toBeNull();
  expect(f.database.sqlite.query("SELECT state FROM v2_blobs WHERE id=?").get(pdf.id)).toEqual({
    state: "deleting",
  });
});
