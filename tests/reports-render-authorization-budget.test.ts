import { expect, test } from "bun:test";
import { createFilesService } from "../src/server/modules/files/service";
import { reportRequestCore } from "../src/server/modules/reports/limits";
import { renderReportPdf } from "../src/server/modules/reports/pdf";
import { createReportDependencies } from "../src/server/modules/reports/runtime";
import { createReportsService } from "../src/server/modules/reports/service";
import { r2 } from "./helpers/file-processing-fixture";
import { reportFixture } from "./helpers/report-fixture";
import { ready } from "./helpers/storage-capacity";

// Native transport may split identical PDF bytes into many response chunks.
// Its live authorization callback remains mandatory for every such chunk.
// This offline boundary adapter drives those callbacks against real SQLite,
// physical write permits, encrypted R2 artifacts and the actual request meter.
// PDF layout/native rendering and provider success are separate acceptance.
async function fixture(renderChecks: number, revokeAt?: number) {
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
  const core = reportRequestCore(p.core, false);
  const { testOnlyUnmeteredStorage: _test, ...deps } = f.deps;
  const costs = createReportDependencies(
    { APP_ENV: "preview", CASE_PRIVATE_R2: f.bucketPort } as Env,
    core,
    p.actor.ownerId,
    () => p.actor.now,
  ).costs;
  if (!costs) throw new Error("SYNTHETIC_STORAGE_COST_ADAPTER_UNAVAILABLE");
  let checked = 0;
  const reports = createReportsService(core, {
    ...deps,
    costs,
    renderPdf: async (_html, input) => {
      for (let i = 0; i < renderChecks; i++) {
        if (i === revokeAt)
          p.db.sqlite
            .query(
              "UPDATE v2_workspaces SET confirmed_summary_revision=confirmed_summary_revision+1 WHERE id=?",
            )
            .run(p.workspaceId);
        await input.authorize();
        checked++;
      }
      return renderReportPdf(await deps.font(), {
        title: "합성 렌더 저장 경계",
        content: "이 PDF는 오프라인 저장·권한 경계 회귀용입니다.",
        revision: 1,
        updatedAt: p.actor.now,
        maskIdentifiers: false,
        excludedFileCount: 0,
      });
    },
  });
  return { ...f, reports, checked: () => checked };
}

test.each([1, 400])(
  "cold encrypted PDF retains every live render fence (%i checks) within the same hard query ceiling",
  async (checks) => {
    const f = await fixture(checks);
    try {
      const report = await f.reports.get(f.actor.ownerId, f.workspaceId);
      const before = f.db.queryCount;
      const pdf = await f.reports.pdf(f.actor.ownerId, report.id);
      const bytes = new Uint8Array(await new Response(pdf.body).arrayBuffer());
      expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe("%PDF-");
      expect(bytes.byteLength).toBe(pdf.byteLength);
      expect(f.checked()).toBe(checks);
      expect(f.db.queryCount - before).toBeLessThan(900);
      expect(
        f.db.sqlite.query("SELECT state,writer_state FROM v2_physical_blob_bindings").get(),
      ).toEqual({ state: "held", writer_state: "stopped" });
      expect(f.db.sqlite.query("SELECT state FROM v2_paid_holds").get()).toEqual({
        state: "dispatched",
      });
      expect(f.bucket.objects.size).toBe(1);
    } finally {
      f.db.close();
    }
  },
);

test("measured rendering cannot enlarge the hard query ceiling or authorize stale source storage", async () => {
  for (const revokeAt of [undefined, 200]) {
    const f = await fixture(500, revokeAt);
    try {
      const report = await f.reports.get(f.actor.ownerId, f.workspaceId);
      const before = f.db.queryCount;
      await expect(f.reports.pdf(f.actor.ownerId, report.id)).rejects.toThrow(
        revokeAt === undefined ? "EXPORT_LIMIT_EXCEEDED" : "STALE_REVISION",
      );
      expect(f.checked()).toBe(revokeAt ?? 500);
      expect(f.db.queryCount - before).toBeLessThanOrEqual(900);
      expect(f.bucket.objects.size).toBe(0);
      expect(
        f.db.sqlite.query("SELECT count(*) AS n FROM v2_physical_blob_bindings").get(),
      ).toEqual({ n: 0 });
    } finally {
      f.db.close();
    }
  }
});
