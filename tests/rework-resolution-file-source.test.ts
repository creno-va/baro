import { afterEach, expect, setSystemTime, test } from "bun:test";
import type { V2FileObservation } from "../src/contracts/v2";
import { fragmentText, utf8Bytes } from "../src/server/db/v2-core";
import { storedFileMetadataSchema } from "../src/server/db/v2-file-metadata";
import { createV2FileStagingRepository } from "../src/server/db/v2-file-staging";
import { createV2FilesRepository } from "../src/server/db/v2-files";
import { createV2JobsRepository } from "../src/server/db/v2-jobs";
import { createV2ReworkRepository } from "../src/server/db/v2-rework";
import { createV2StagingRepository } from "../src/server/db/v2-staging";
import { analysisBasis } from "../src/server/modules/legal-retrieval/analysis/context";
import { loadAnalysisInput } from "../src/server/modules/rework/analysis-input";
import { createReworkCaseService } from "../src/server/modules/rework/case-context";
import { preparedAnalysisRecordSchema } from "../src/server/modules/rework/records";
import { createReworkResolutionRuntime } from "../src/server/modules/rework/resolution-runtime";
import { uploaded } from "./helpers/file-processing-fixture";
import { reportFixture } from "./helpers/report-fixture";

const fixtures: Awaited<ReturnType<typeof reportFixture>>[] = [];
afterEach(() => {
  setSystemTime();
  for (const f of fixtures.splice(0)) f.db.close();
});
async function fixture() {
  const f = await reportFixture();
  fixtures.push(f);
  setSystemTime(new Date(f.actor.now));
  await createReworkCaseService(f.core, { clock: () => f.actor.now }).update(
    f.actor.ownerId,
    f.workspaceId,
    crypto.randomUUID(),
    {
      expectedRevision: f.rev(),
      casePurpose: "prepare_claim",
      subjectContext: "individual",
      procedure: { kind: "unconfirmed", stage: "unconfirmed", description: null },
    },
  );
  const report = await f.reports.get(f.actor.ownerId, f.workspaceId);
  return { ...f, report };
}
async function stagedFile(f: Awaited<ReturnType<typeof fixture>>) {
  const u = await uploaded(f, new TextEncoder().encode("합성 원본 · 실제 staging 검증"));
  const jobs = createV2JobsRepository(f.core),
    jobId = crypto.randomUUID();
  expect(
    await jobs.admitFile(
      { ...f.actor, workspaceId: f.workspaceId, expectedRevision: f.rev() },
      {
        fileId: u.session.fileId,
        fileRevision: 2,
        jobId,
        admission: {
          operationId: crypto.randomUUID(),
          key: crypto.randomUUID(),
          requestHash: "a".repeat(64),
        },
        quotas: [],
      },
    ),
  ).toBe(true);
  const acquired = await jobs.acquire(
    f.actor,
    jobId,
    crypto.randomUUID(),
    new Date(Date.parse(f.actor.now) + 120000).toISOString(),
  );
  if (!acquired) throw new Error("SYNTHETIC_FILE_LEASE_MISSING");
  const g = { ...f.actor, workspaceId: f.workspaceId, expectedRevision: f.rev() };
  const staging = createV2StagingRepository(f.core),
    fileStaging = createV2FileStagingRepository(f.core);
  const id = crypto.randomUUID(),
    text = JSON.stringify({
      category: "document",
      status: "complete",
      pageCount: 1,
      pages: [{ page: 1, status: "processed" }],
    });
  const parts = fragmentText(text);
  expect(
    await staging.begin(
      g,
      {
        id,
        purpose: "file_coverage",
        targetId: u.session.fileId,
        revision: 3,
        partCount: parts.length,
        byteLength: utf8Bytes(text),
      },
      acquired.lease,
    ),
  ).toBe(true);
  for (const [index, part] of parts.entries())
    expect(await staging.append(g, id, index, part, acquired.lease)).toBe(true);
  expect(
    await staging.seal(
      g,
      id,
      { schemaVersion: "2", purpose: "file_coverage", targetId: u.session.fileId, revision: 3 },
      acquired.lease,
    ),
  ).toBe(true);
  for (let ordinal = 0; ordinal < 9; ordinal += 4) {
    const observations: V2FileObservation[] = Array.from(
      { length: Math.min(4, 9 - ordinal) },
      (_, i) => ({
        id: "synthetic-observation-" + (ordinal + i),
        text: "확인할 합성 관찰 " + (ordinal + i),
        position: { kind: "document", page: 1, paragraph: null, table: null },
        certainty: "observed",
        userEdited: false,
        included: true,
      }),
    );
    expect(
      await fileStaging.stagePage(
        g,
        {
          fileId: u.session.fileId,
          fileRevision: 2,
          coverageSnapshotId: id,
          observationOrdinal: ordinal,
          observations,
          derivativeOrdinal: 0,
          derivatives: [],
        },
        acquired.lease,
      ),
    ).toBe(true);
  }
  expect(
    await fileStaging.publish(
      g,
      {
        fileId: u.session.fileId,
        fileRevision: 2,
        coverageSnapshotId: id,
        observationCount: 9,
        derivativeCount: 0,
      },
      acquired.lease,
    ),
  ).toBe(true);
  return u.session.fileId;
}

test("resolution selects streamed evidence without using the eight-observation aggregate for its name", async () => {
  const f = await fixture(),
    fileId = await stagedFile(f);
  const files = createV2FilesRepository(f.core);
  expect(await files.metadata(f.actor, fileId)).toMatchObject({ revision: 3, status: "ready" });
  await expect(files.read(f.actor, fileId)).rejects.toThrow("SNAPSHOT_STREAM_REQUIRED");
  const loaded = await loadAnalysisInput(f.core, f.actor, f.workspaceId);
  expect(loaded.input?.includedEvidence).toHaveLength(1);
  expect(loaded.input?.materials).toHaveLength(9);
  const runtime = createReworkResolutionRuntime(f.core, {
    clock: () => f.actor.now,
    peekReport: (owner, id) => f.reports.peek(owner, id),
  });
  const state = await runtime.get(f.actor.ownerId, f.workspaceId);
  const selected = await runtime.update(f.actor.ownerId, f.workspaceId, crypto.randomUUID(), {
    expectedRevision: state.revision,
    reportId: f.report.id,
    reportRevision: f.report.revision,
    action: "select",
    choice: "lawyer",
    selectedFileIds: [fileId],
    maskIdentifiers: false,
  });
  expect(selected).toMatchObject({
    selection: "lawyer",
    status: "not_ready",
    basis: null,
    selectedFileIds: [fileId],
    draft: null,
  });
});

test("the private frozen-header projection never enters model input or includes excluded evidence", async () => {
  const f = await fixture(),
    fileId = await stagedFile(f);
  const loaded = await loadAnalysisInput(f.core, f.actor, f.workspaceId);
  const metadata = await createV2FilesRepository(f.core).metadata(f.actor, fileId);
  if (!metadata) throw new Error("SYNTHETIC_METADATA_MISSING");
  expect(loaded.evidenceMetadata[fileId]).toEqual({ revision: 3, name: metadata.name });
  expect(loaded.input).not.toHaveProperty("evidenceMetadata");
  expect(JSON.stringify(loaded.input)).not.toContain(metadata.name);
  const excluded = await loadAnalysisInput(f.core, f.actor, f.workspaceId, {
    excludedFileIds: [fileId],
    maskIdentifiers: true,
  });
  expect(Object.keys(excluded.evidenceMetadata)).toEqual([]);
  expect(excluded.input?.includedEvidence).toEqual([]);
  expect(excluded.input?.materials).toEqual([]);
  expect(excluded.input?.confirmedSummary.overview).not.toContain("010-1234-5678");
});

function afterSource(f: Awaited<ReturnType<typeof fixture>>, mutation: () => Promise<void> | void) {
  let changed = false;
  const core: typeof f.core = {
    ...f.core,
    statement(sql, values = []) {
      const statement = f.core.statement(sql, values);
      if (
        !sql.startsWith(
          "SELECT w.id FROM v2_workspaces w WHERE w.id=? AND w.owner_id=? AND w.revision=?",
        ) ||
        !sql.includes("SELECT id FROM v2_reports")
      )
        return statement;
      return new Proxy(statement, {
        get(target, property) {
          if (property === "first")
            return async (...args: Parameters<typeof target.first>) => {
              const result = await target.first(...args);
              if (!changed) {
                changed = true;
                await mutation();
              }
              return result;
            };
          const value = Reflect.get(target, property);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
  };
  return { core, changed: () => changed };
}

test("a filename cache cannot authorize a valid same-revision replacement cipher", async () => {
  const f = await fixture(),
    fileId = await stagedFile(f);
  const row = f.db.sqlite
    .query("SELECT encrypted_payload FROM v2_files WHERE id=?")
    .get(fileId) as { encrypted_payload: string };
  const original = await f.core.decrypt(
    "v2_files",
    fileId,
    f.actor.ownerId,
    3,
    row.encrypted_payload,
    storedFileMetadataSchema,
  );
  const replacement = await f.core.encrypt("v2_files", fileId, f.actor.ownerId, 3, {
    ...original,
    name: "변경된 합성 이름.txt",
  });
  const observed = afterSource(f, () => {
    f.db.sqlite
      .query("UPDATE v2_files SET encrypted_payload=? WHERE id=?")
      .run(replacement, fileId);
  });
  const runtime = createReworkResolutionRuntime(observed.core, {
    clock: () => f.actor.now,
    peekReport: (owner, id) => f.reports.peek(owner, id),
  });
  await expect(
    runtime.update(f.actor.ownerId, f.workspaceId, crypto.randomUUID(), {
      expectedRevision: 1,
      reportId: f.report.id,
      reportRevision: f.report.revision,
      action: "select",
      choice: "lawyer",
      selectedFileIds: [fileId],
      maskIdentifiers: false,
    }),
  ).rejects.toMatchObject({ code: "STALE_REVISION" });
  expect(observed.changed()).toBe(true);
  expect(
    f.db.sqlite
      .query(
        "SELECT count(*) n FROM v2_rework_records WHERE kind='resolution' AND state='published'",
      )
      .get(),
  ).toEqual({ n: 0 });
});

for (const change of ["head", "role", "session", "consent"] as const)
  test(
    "an absent raw snapshot still rejects a late " + change + " before publication",
    async () => {
      const f = await fixture();
      const session = f.db.sqlite
        .query("SELECT id FROM session WHERE user_id=?")
        .get(f.actor.ownerId) as { id: string };
      const observed = afterSource(f, async () => {
        if (change === "head") {
          const input = (await loadAnalysisInput(f.core, f.actor, f.workspaceId)).input;
          if (!input) throw new Error("SYNTHETIC_INPUT_MISSING");
          await createV2ReworkRepository(f.core, { clock: () => f.actor.now }).write(
            { ...f.actor, workspaceId: f.workspaceId, expectedRevision: f.rev() },
            {
              kind: "analysis",
              expectedVersion: 0,
              bumpWorkspace: false,
              schema: preparedAnalysisRecordSchema,
              value: {
                format: "prepared-legal-analysis-v1",
                basis: await analysisBasis(input),
                scope: input.scope,
                snapshot: null,
                failure: "MODEL_UNAVAILABLE",
                completedAt: f.actor.now,
                procedureCitations: [],
              },
            },
          );
        } else if (change === "role")
          f.db.sqlite
            .query("INSERT OR REPLACE INTO app_metadata(key,value) VALUES(?,?)")
            .run("account-type:" + f.actor.ownerId, "unsupported");
        else if (change === "session")
          f.db.sqlite.query("DELETE FROM session WHERE id=?").run(session.id);
        else f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.actor.ownerId);
      });
      const runtime = createReworkResolutionRuntime(observed.core, {
        clock: () => f.actor.now,
        sessionId: session.id,
        peekReport: (owner, id) => f.reports.peek(owner, id),
      });
      const result = await runtime
        .update(f.actor.ownerId, f.workspaceId, crypto.randomUUID(), {
          expectedRevision: 1,
          reportId: f.report.id,
          reportRevision: f.report.revision,
          action: "select",
          choice: "lawyer",
          selectedFileIds: [],
          maskIdentifiers: false,
        })
        .then(
          () => "completed",
          (error: { code: string }) => error.code,
        );
      expect(["STALE_REVISION", "NOT_FOUND", "CONSENT_REQUIRED"]).toContain(result);
      expect(observed.changed()).toBe(true);
      expect(
        f.db.sqlite
          .query(
            "SELECT count(*) n FROM v2_rework_records WHERE kind='resolution' AND state='published'",
          )
          .get(),
      ).toEqual({ n: 0 });
    },
  );
