import { expect, spyOn, test } from "bun:test";
import * as pdf from "../src/server/modules/reports/pdf";
import { reportFixture } from "./helpers/report-fixture";

test("compression rejection preserves the report and fails its lease before any storage write", async () => {
  const f = await reportFixture();
  try {
    const prior = await f.reports.get(f.actor.ownerId, f.workspaceId);
    const before = f.db.sqlite.query("SELECT count(*) n FROM v2_blobs").get();
    const render = spyOn(pdf, "renderReportPdf").mockRejectedValue(
      new Error("synthetic compression failure"),
    );
    try {
      await expect(f.reports.pdf(f.actor.ownerId, prior.id)).rejects.toThrow(
        "synthetic compression failure",
      );
    } finally {
      render.mockRestore();
    }
    expect(f.bucket.objects.size).toBe(0);
    expect(f.db.sqlite.query("SELECT count(*) n FROM v2_blobs").get()).toEqual(before);
    expect(
      f.db.sqlite
        .query(
          "SELECT status,failure_code,retryable,lease_token FROM v2_jobs WHERE kind='report_build'",
        )
        .all(),
    ).toEqual([
      { status: "failed", failure_code: "STORAGE_UNAVAILABLE", retryable: 1, lease_token: null },
    ]);
    expect((await f.reports.get(f.actor.ownerId, f.workspaceId)).content).toBe(prior.content);
  } finally {
    f.db.close();
  }
});
