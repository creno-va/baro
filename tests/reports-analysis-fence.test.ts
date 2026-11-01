import { expect, test } from "bun:test";
import { v2LegalAnalysisSnapshotSchema } from "../src/contracts/v2";
import { createV2ReworkRepository } from "../src/server/db/v2-rework";
import { exportFence } from "../src/server/modules/reports/fence";
import { createReportsService } from "../src/server/modules/reports/service";
import { type ReportSourceOptions, sourceDigest } from "../src/server/modules/reports/source";
import { reportPreparedAnalysisFixture } from "./helpers/report-prepared-analysis-fixture";

const options: ReportSourceOptions = {
  includeAnalysis: true,
  scope: { excludedFileIds: [], maskIdentifiers: false },
};
async function fixture() {
  const f = await reportPreparedAnalysisFixture();
  const repository = createV2ReworkRepository(f.core, { clock: () => f.actor.now });
  async function publish(expectedVersion: number, entityId: string = f.workspaceId) {
    const result = await repository.write(
      { ...f.actor, workspaceId: f.workspaceId, expectedRevision: f.rev() },
      {
        kind: "analysis",
        entityId,
        expectedVersion,
        value: f.snapshot,
        schema: v2LegalAnalysisSnapshotSchema(),
      },
    );
    expect(result).not.toBeNull();
  }
  await publish(0);
  const reports = createReportsService(f.core, {
    ...f.deps,
    readPreparedAnalysis: async () => f.snapshot,
  });
  const report = await reports.get(f.actor.ownerId, f.workspaceId);
  const row = await f.core
    .statement(
      "SELECT id,revision,workspace_id,snapshot_id,encrypted_payload FROM v2_reports WHERE id=?",
      [report.id],
    )
    .first<{
      id: string;
      revision: number;
      workspace_id: string;
      snapshot_id: string;
      encrypted_payload: string;
    }>();
  if (!row) throw new Error("Synthetic report missing");
  const digest = await sourceDigest(f.core, f.actor, f.workspaceId, options);
  const fence = await exportFence(
    f.core,
    f.actor,
    row,
    digest,
    () => f.actor.now,
    undefined,
    [f.statute.citation.id, f.precedent.citation.id],
    options,
  );
  return { ...f, reports, report, publish, digest, fence };
}

test("a newly published canonical analysis is fenced even when the DI loader still returns the old value", async () => {
  const f = await fixture();
  await f.fence.check();
  await f.publish(0, "unrelated-analysis-entity");
  await f.fence.check();
  await f.publish(1);
  await expect(f.fence.check()).rejects.toThrow("STALE_REVISION");
  expect((await f.reports.peek(f.actor.ownerId, f.workspaceId))?.stale).toBe(true);
  expect((await f.reports.peek(f.actor.ownerId, f.workspaceId))?.content).toBe(f.report.content);
});

test("case context payload changes invalidate opt-in reports while legacy digest bytes remain stable", async () => {
  const f = await fixture();
  const legacy = await sourceDigest(f.core, f.actor, f.workspaceId);
  // Report bookkeeping may bump workspace revision without changing source content.
  f.db.sqlite.query("UPDATE v2_workspaces SET revision=revision+1 WHERE id=?").run(f.workspaceId);
  await f.fence.check();
  expect(await sourceDigest(f.core, f.actor, f.workspaceId)).toBe(legacy);
  f.db.sqlite
    .query("UPDATE v2_workspaces SET encrypted_payload=? WHERE id=?")
    .run("synthetic changed context ciphertext", f.workspaceId);
  expect(await sourceDigest(f.core, f.actor, f.workspaceId)).toBe(legacy);
  await expect(f.fence.check()).rejects.toThrow("STALE_REVISION");
  expect(
    await sourceDigest(f.core, f.actor, f.workspaceId, {
      ...options,
      scope: { ...options.scope, maskIdentifiers: true },
    }),
  ).not.toBe(f.digest);
});
