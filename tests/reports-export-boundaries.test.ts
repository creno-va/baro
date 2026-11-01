import { expect, test } from "bun:test";
import { type V2LegalAnalysisSnapshot, v2ReportBodySchema } from "../src/contracts/v2";
import {
  fragmentText,
  readSnapshot,
  snapshotStatements,
  utf8Bytes,
} from "../src/server/db/v2-core";
import { createV2StagingRepository } from "../src/server/db/v2-staging";
import { renderReportPdf } from "../src/server/modules/reports/pdf";
import { createReportsService } from "../src/server/modules/reports/service";
import { reportReviewSchema } from "../src/server/modules/reports/source";
import { reportPreparedAnalysisFixture } from "./helpers/report-prepared-analysis-fixture";

test("a ZIP copy with changed analysis stops before lease, font, renderer or original bytes", async () => {
  const f = await reportPreparedAnalysisFixture();
  let current = f.snapshot;
  let fonts = 0;
  const reports = createReportsService(f.core, {
    ...f.deps,
    readPreparedAnalysisForScope: async () => current,
    font: async () => {
      fonts++;
      return f.deps.font();
    },
  });
  const parent = await reports.get(f.actor.ownerId, f.workspaceId);
  const objects = f.bucket.objects.size;
  const calls = { ...f.bucket.calls };
  current = { ...f.snapshot, id: "synthetic-analysis-replaced-before-export" };
  await expect(
    reports.zip(f.actor.ownerId, parent.id, crypto.randomUUID(), [f.fileId]),
  ).rejects.toThrow("STALE_REVISION");
  expect(fonts).toBe(0);
  expect(f.bucket.objects.size).toBe(objects);
  expect(f.bucket.calls).toEqual(calls);
  expect(
    f.db.sqlite
      .query(
        "SELECT r.state,j.status,j.attempts FROM v2_reports r JOIN v2_jobs j ON j.id=r.current_job_id WHERE r.id LIKE 'export-%'",
      )
      .all(),
  ).toEqual([{ state: "queued", status: "queued", attempts: 0 }]);
  expect((await reports.peek(f.actor.ownerId, f.workspaceId))?.content).toBe(parent.content);
});

test("a ZIP copy rechecks current analysis after asynchronous PDF rendering", async () => {
  const f = await reportPreparedAnalysisFixture();
  let current: V2LegalAnalysisSnapshot = f.snapshot;
  let renders = 0;
  let parent: Awaited<ReturnType<ReturnType<typeof createReportsService>["get"]>>;
  const reports = createReportsService(f.core, {
    ...f.deps,
    readPreparedAnalysisForScope: async () => current,
    renderPdf: async () => {
      renders++;
      const bytes = await renderReportPdf(await f.deps.font(), parent);
      current = { ...f.snapshot, id: "synthetic-analysis-replaced-during-zip-render" };
      return bytes;
    },
  });
  parent = await reports.get(f.actor.ownerId, f.workspaceId);
  const objects = f.bucket.objects.size;
  const calls = { ...f.bucket.calls };
  await expect(
    reports.zip(f.actor.ownerId, parent.id, crypto.randomUUID(), [f.fileId]),
  ).rejects.toThrow("STALE_REVISION");
  expect(renders).toBe(1);
  expect(f.bucket.objects.size).toBe(objects);
  expect(f.bucket.calls).toEqual(calls);
  expect(
    f.db.sqlite
      .query("SELECT count(*) n FROM v2_reports WHERE id LIKE 'export-%' AND state='ready'")
      .get(),
  ).toEqual({ n: 0 });
});

test("a saved ZIP replay still checks the current parent source digest", async () => {
  const f = await reportPreparedAnalysisFixture();
  const reports = createReportsService(f.core, {
    ...f.deps,
    readPreparedAnalysisForScope: async () => f.snapshot,
  });
  const parent = await reports.get(f.actor.ownerId, f.workspaceId);
  const key = crypto.randomUUID();
  const first = await reports.zip(f.actor.ownerId, parent.id, key, [f.fileId]);
  expect((await new Response(first.body).arrayBuffer()).byteLength).toBe(first.byteLength);
  f.db.sqlite
    .query("UPDATE v2_workspaces SET encrypted_payload=? WHERE id=?")
    .run("synthetic-case-context-change", f.workspaceId);
  const objects = f.bucket.objects.size;
  await expect(reports.zip(f.actor.ownerId, parent.id, key, [f.fileId])).rejects.toThrow(
    "STALE_REVISION",
  );
  expect(f.bucket.objects.size).toBe(objects);
});

for (const mutation of ["snapshot", "cipher", "revision", "deletion", "blob_metadata"] as const)
  test(`the private immutable count cannot bypass a ${mutation} change before download`, async () => {
    const f = await reportPreparedAnalysisFixture();
    let changed = false;
    const reports = createReportsService(f.core, {
      ...f.deps,
      readPreparedAnalysisForScope: async () => f.snapshot,
      bucket: {
        ...f.bucketPort,
        get: async (key: string) => {
          const result = await f.bucketPort.get(key);
          const row = f.db.sqlite
            .query("SELECT id FROM v2_reports WHERE id LIKE 'export-%' AND state='ready' LIMIT 1")
            .get() as { id: string } | null;
          if (!changed && row) {
            changed = true;
            if (mutation === "blob_metadata")
              f.db.sqlite
                .query(
                  "UPDATE v2_blobs SET encrypted_payload=? WHERE id=(SELECT zip_blob_id FROM v2_reports WHERE id=?)",
                )
                .run("synthetic-changed-blob-envelope", row.id);
            else if (mutation === "deletion")
              f.db.sqlite
                .query(
                  "INSERT INTO v2_tombstones(target_kind,target_id,deleted_at) VALUES('report',?,?)",
                )
                .run(row.id, f.actor.now);
            else if (mutation === "revision")
              f.db.sqlite.query("UPDATE v2_reports SET revision=revision+1 WHERE id=?").run(row.id);
            else if (mutation === "cipher")
              f.db.sqlite
                .query("UPDATE v2_reports SET encrypted_payload=? WHERE id=?")
                .run("synthetic-changed-report-envelope", row.id);
            else
              f.db.sqlite
                .query(
                  "UPDATE v2_reports SET snapshot_id=(SELECT snapshot_id FROM v2_reports WHERE id NOT LIKE 'export-%' LIMIT 1) WHERE id=?",
                )
                .run(row.id);
          }
          return result;
        },
      },
    });
    const parent = await reports.get(f.actor.ownerId, f.workspaceId);
    await expect(
      reports.zip(f.actor.ownerId, parent.id, crypto.randomUUID(), [f.fileId]),
    ).rejects.toThrow("NOT_FOUND");
    expect(changed).toBe(true);
  });

for (const mutation of ["deletion", "snapshot", "cipher"] as const)
  test(`a parent ${mutation} during encryption cannot publish an inline ZIP copy`, async () => {
    const f = await reportPreparedAnalysisFixture();
    const reports = createReportsService(f.core, {
      ...f.deps,
      readPreparedAnalysisForScope: async () => f.snapshot,
    });
    const parent = await reports.get(f.actor.ownerId, f.workspaceId);
    const before = f.db.sqlite.query("SELECT count(*) n FROM v2_private_snapshots").get();
    const encrypt = f.core.encrypt;
    let changed = false;
    f.core.encrypt = async (...args: Parameters<typeof encrypt>) => {
      const result = await encrypt(...args);
      if (!changed && args[0] === "v2_reports" && args[1].startsWith("export-")) {
        changed = true;
        if (mutation === "deletion")
          f.db.sqlite
            .query(
              "INSERT INTO v2_tombstones(target_kind,target_id,deleted_at) VALUES('report',?,?)",
            )
            .run(parent.id, f.actor.now);
        else if (mutation === "snapshot")
          f.db.sqlite
            .query(
              "UPDATE v2_reports SET snapshot_id=(SELECT s.id FROM v2_private_snapshots s WHERE s.purpose='summary' LIMIT 1) WHERE id=?",
            )
            .run(parent.id);
        else
          f.db.sqlite
            .query("UPDATE v2_reports SET encrypted_payload=? WHERE id=?")
            .run("synthetic-replaced-parent-cipher", parent.id);
      }
      return result;
    };
    await expect(
      reports.zip(f.actor.ownerId, parent.id, crypto.randomUUID(), [f.fileId]),
    ).rejects.toThrow("STALE_REVISION");
    expect(changed).toBe(true);
    expect(
      f.db.sqlite.query("SELECT count(*) n FROM v2_reports WHERE id LIKE 'export-%'").get(),
    ).toEqual({ n: 0 });
    expect(f.db.sqlite.query("SELECT count(*) n FROM v2_private_snapshots").get()).toEqual(before);
  });

test("a missing inline body part rolls back the copy, snapshots, operation, job and selections", async () => {
  const f = await reportPreparedAnalysisFixture();
  const reports = createReportsService(f.core, {
    ...f.deps,
    readPreparedAnalysisForScope: async () => f.snapshot,
  });
  const parent = await reports.get(f.actor.ownerId, f.workspaceId);
  const totals = () =>
    Object.fromEntries(
      [
        "v2_reports",
        "v2_private_snapshots",
        "v2_private_parts",
        "v2_operations",
        "v2_jobs",
        "v2_report_selections",
        "v2_idempotency",
      ].map((table) => [table, f.db.sqlite.query(`SELECT count(*) n FROM ${table}`).get()]),
    );
  const before = totals();
  f.db.sqlite.exec(
    "CREATE TRIGGER synthetic_missing_export_part BEFORE INSERT ON v2_private_parts WHEN (SELECT target_id FROM v2_private_snapshots WHERE id=NEW.snapshot_id) LIKE 'export-%' BEGIN SELECT RAISE(IGNORE); END",
  );
  await expect(
    reports.zip(f.actor.ownerId, parent.id, crypto.randomUUID(), [f.fileId]),
  ).rejects.toThrow();
  expect(totals()).toEqual(before);
});

for (const byteLength of [98304, 98305])
  test(`a ${byteLength}-byte parent body preserves the inline boundary or staged fallback`, async () => {
    const f = await reportPreparedAnalysisFixture();
    const reports = createReportsService(f.core, {
      ...f.deps,
      readPreparedAnalysisForScope: async () => f.snapshot,
    });
    const parent = await reports.get(f.actor.ownerId, f.workspaceId);
    const row = f.db.sqlite
      .query("SELECT snapshot_id,workspace_revision FROM v2_reports WHERE id=?")
      .get(parent.id) as { snapshot_id: string; workspace_revision: number };
    const body = await readSnapshot(
      f.core,
      f.actor,
      row.snapshot_id,
      "report",
      parent.id,
      row.workspace_revision,
      v2ReportBodySchema(),
    );
    if (!body?.facts[0]) throw new Error("SYNTHETIC_BODY_MISSING");
    const template = body.facts[0];
    while (utf8Bytes(JSON.stringify(body)) < byteLength) {
      const fact = { ...template, id: `synthetic-padding-${body.facts.length}`, text: "A" };
      body.facts.push(fact);
      const remaining = byteLength - utf8Bytes(JSON.stringify(body));
      if (remaining < 0) throw new Error("SYNTHETIC_PADDING_BOUNDARY");
      fact.text += "A".repeat(Math.min(1999, remaining));
    }
    expect(utf8Bytes(JSON.stringify(v2ReportBodySchema().parse(body)))).toBe(byteLength);
    // A separate synthetic parent preserves the original immutable snapshot.
    const seededParentId = crypto.randomUUID();
    const snapshotId = crypto.randomUUID(),
      staging = createV2StagingRepository(f.core);
    const guard = { ...f.actor, workspaceId: f.workspaceId, expectedRevision: f.rev() };
    const parts = fragmentText(JSON.stringify(body));
    expect(
      await staging.begin(guard, {
        id: snapshotId,
        purpose: "report",
        targetId: seededParentId,
        revision: row.workspace_revision,
        partCount: parts.length,
        byteLength,
      }),
    ).toBe(true);
    for (const [index, part] of parts.entries())
      expect(await staging.append(guard, snapshotId, index, part)).toBe(true);
    expect(
      await staging.seal(guard, snapshotId, {
        schemaVersion: "2",
        purpose: "report",
        targetId: seededParentId,
        revision: row.workspace_revision,
      }),
    ).toBe(true);
    expect(await staging.publish(guard, snapshotId)).toBe(true);
    const saved = f.db.sqlite
      .query(
        "SELECT id FROM v2_private_snapshots WHERE purpose='report' AND target_id=? AND revision=?",
      )
      .get(parent.id, row.workspace_revision + 1) as { id: string };
    const review = await readSnapshot(
      f.core,
      f.actor,
      saved.id,
      "report",
      parent.id,
      row.workspace_revision + 1,
      reportReviewSchema,
    );
    const envelope = await f.core.encrypt(
      "v2_reports",
      seededParentId,
      f.actor.ownerId,
      parent.revision,
      {
        request: {
          expectedRevision: row.workspace_revision,
          selectedFileIds: body.selectedFiles.map((file) => file.id),
          editedFields: [],
          maskingChoices: [],
          reviewConfirmed: true,
          includeOriginals: false,
        },
      },
    );
    const claim = crypto.randomUUID();
    await f.core.binding.batch([
      f.core.claim(guard, claim),
      ...(await snapshotStatements(
        f.core,
        {
          id: crypto.randomUUID(),
          ownerId: f.actor.ownerId,
          workspaceId: f.workspaceId,
          targetId: seededParentId,
          purpose: "report",
          revision: row.workspace_revision + 1,
          now: f.actor.now,
        },
        review,
        claim,
      )),
      f.core.statement(
        "INSERT INTO v2_reports(id,revision,workspace_id,workspace_revision,summary_revision,snapshot_id,operation_id,state,encrypted_payload,created_at) SELECT ?,revision,workspace_id,workspace_revision,summary_revision,?,operation_id,'queued',?,created_at FROM v2_reports WHERE id=?",
        [seededParentId, snapshotId, envelope, parent.id],
      ),
      f.core.finish(claim),
    ]);
    const archive = await reports.zip(f.actor.ownerId, seededParentId, crypto.randomUUID(), [
      f.fileId,
    ]);
    expect((await new Response(archive.body).arrayBuffer()).byteLength).toBe(archive.byteLength);
    const copy = f.db.sqlite
      .query(
        "SELECT r.id,r.snapshot_id,r.workspace_revision,s.byte_length,s.written_parts FROM v2_reports r JOIN v2_private_snapshots s ON s.id=r.snapshot_id WHERE r.id LIKE 'export-%'",
      )
      .get() as {
      id: string;
      snapshot_id: string;
      workspace_revision: number;
      byte_length: number;
      written_parts: number;
    };
    expect(copy.byte_length).toBe(byteLength);
    expect(copy.written_parts).toBe(byteLength === 98304 ? 0 : parts.length);
    expect(
      await readSnapshot(
        f.core,
        f.actor,
        copy.snapshot_id,
        "report",
        copy.id,
        copy.workspace_revision,
        v2ReportBodySchema(),
      ),
    ).toEqual(body);
  });
