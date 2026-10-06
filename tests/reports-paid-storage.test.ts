import { expect, test } from "bun:test";
import { createFilesService } from "../src/server/modules/files/service";
import { createReportDependencies } from "../src/server/modules/reports/runtime";
import { createReportsService } from "../src/server/modules/reports/service";
import { r2 } from "./helpers/file-processing-fixture";
import { reportFixture } from "./helpers/report-fixture";
import { ready } from "./helpers/storage-capacity";

test("real report paid SQL and physical capacity reserve before PUT, preserve unresolved billing, then authorize actual decrypt download", async () => {
  const p = await ready({ getLimit: 100, headLimit: 100, deleteLimit: 100 });
  const bucket = r2();
  const f = await reportFixture({
    ...p,
    bucket,
    service: createFilesService(p.core, {
      environment: "preview",
      bucket: bucket.port,
      clock: () => p.actor.now,
    }),
    rev: () =>
      Number(
        (
          p.db.sqlite.query("SELECT revision FROM v2_workspaces WHERE id=?").get(p.workspaceId) as {
            revision: number;
          }
        ).revision,
      ),
  });
  const env = { APP_ENV: "preview", CASE_PRIVATE_R2: f.bucketPort } as Env;
  const { testOnlyUnmeteredStorage: _test, ...actualDeps } = f.deps;
  const costs = createReportDependencies(env, p.core, p.actor.ownerId, () => p.actor.now).costs;
  if (!costs) throw new Error("Report paid factory unavailable");
  const deps = { ...actualDeps, costs };
  const reports = createReportsService(p.core, deps),
    draft = await reports.get(p.actor.ownerId, p.workspaceId);
  const pdf = await reports.pdf(p.actor.ownerId, draft.id);
  expect((await new Response(pdf.body).arrayBuffer()).byteLength).toBe(pdf.byteLength);
  expect(
    p.db.sqlite.query("SELECT state,writer_state FROM v2_physical_blob_bindings").get(),
  ).toEqual({ state: "held", writer_state: "stopped" });
  expect(p.db.sqlite.query("SELECT state FROM v2_paid_holds").get()).toEqual({
    state: "dispatched",
  });
  expect(
    (
      p.db.sqlite
        .query("SELECT reserved_krw FROM v2_monthly_budget WHERE environment='preview'")
        .get() as { reserved_krw: number }
    ).reserved_krw,
  ).toBeGreaterThan(0);
  expect(f.bucket.objects.size).toBe(1);
  const next = await reports.generate(p.actor.ownerId, p.workspaceId, crypto.randomUUID(), {
    expectedRevision: draft.revision,
  });
  // The next write has a distinct immutable invocation; prior unresolved usage
  // is kept charged, rather than relabelled as a free local successful write.
  await new Response((await reports.pdf(p.actor.ownerId, next.id)).body).arrayBuffer();
  expect(
    p.db.sqlite
      .query(
        "SELECT count(DISTINCT invocation_id) AS n FROM v2_runtime_plans WHERE job_id IS NOT NULL",
      )
      .get(),
  ).toEqual({ n: 2 });
});
