import { expect, test } from "bun:test";
import type { V2LegalAnalysisSnapshot } from "../src/contracts/v2";
import { renderReportPdf } from "../src/server/modules/reports/pdf";
import { createReportsService } from "../src/server/modules/reports/service";
import { reportPreparedAnalysisFixture } from "./helpers/report-prepared-analysis-fixture";

test("a combined current-scope proof preserves exclusion/masking boundaries and immutable prior prose", async () => {
  const f = await reportPreparedAnalysisFixture();
  const scopes: { excludedFileIds: readonly string[]; maskIdentifiers: boolean }[] = [];
  const reports = createReportsService(f.core, {
    ...f.deps,
    readPreparedAnalysis: async () => {
      throw new Error("Legacy loader must not duplicate the scoped proof");
    },
    preparedAnalysisMatchesScope: async () => {
      throw new Error("Legacy proof must not duplicate the scoped proof");
    },
    readPreparedAnalysisForScope: async (actor, caseId, scope) => {
      expect(actor.ownerId).toBe(f.actor.ownerId);
      expect(caseId).toBe(f.workspaceId);
      scopes.push(structuredClone(scope));
      return scope.maskIdentifiers || scope.excludedFileIds.length ? null : f.snapshot;
    },
  });
  const first = await reports.get(f.actor.ownerId, f.workspaceId);
  expect(first.content).toContain(f.statute.source.body);
  const masked = await reports.save(f.actor.ownerId, f.workspaceId, crypto.randomUUID(), {
    expectedRevision: first.revision,
    content: first.content,
    maskIdentifiers: true,
    excludedFileIds: [f.fileId],
  });
  expect(masked.content).not.toContain(f.statute.source.body);
  expect(masked.content).not.toContain("합성 자료 관찰용 비공개 표식");
  expect((await reports.peek(f.actor.ownerId, f.workspaceId))?.analysisReview.status).toBe(
    "review_required",
  );
  expect(scopes).toContainEqual({ excludedFileIds: [f.fileId], maskIdentifiers: true });
  expect(await reports.html(f.actor.ownerId, first.id)).toContain(f.statute.source.body);
});

test("a fresh combined proof still rejects an analysis replaced during asynchronous PDF rendering before storage", async () => {
  const f = await reportPreparedAnalysisFixture();
  let current: V2LegalAnalysisSnapshot | null = f.snapshot;
  let reads = 0;
  let reviewed: Awaited<ReturnType<ReturnType<typeof createReportsService>["get"]>>;
  const reports = createReportsService(f.core, {
    ...f.deps,
    readPreparedAnalysisForScope: async (_actor, _caseId, scope) => {
      expect(scope).toEqual({ excludedFileIds: [], maskIdentifiers: false });
      reads++;
      return current;
    },
    // Existing test fixture's explicit legacy font writer produces a real PDF.
    // This test checks the post-render currentness fence, not native capacity.
    renderPdf: async () => {
      const bytes = await renderReportPdf(await f.deps.font(), reviewed);
      expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe("%PDF-");
      current = { ...f.snapshot, id: "synthetic-newer-during-render" };
      return bytes;
    },
  });
  reviewed = await reports.get(f.actor.ownerId, f.workspaceId);
  const before = reads;
  const storage = { ...f.bucket.calls };
  await expect(reports.pdf(f.actor.ownerId, reviewed.id)).rejects.toThrow("STALE_REVISION");
  expect(reads - before).toBeGreaterThanOrEqual(2);
  expect(f.bucket.calls.put).toBe(storage.put);
  expect((await reports.peek(f.actor.ownerId, f.workspaceId))?.stale).toBe(true);
  expect((await reports.peek(f.actor.ownerId, f.workspaceId))?.content).toBe(reviewed.content);
});

test("a combined-proof outage cannot fall back to a previously available unscoped analysis", async () => {
  const f = await reportPreparedAnalysisFixture();
  let legacyReads = 0;
  const reports = createReportsService(f.core, {
    ...f.deps,
    readPreparedAnalysis: async () => {
      legacyReads++;
      return f.snapshot;
    },
    readPreparedAnalysisForScope: async () => {
      throw new Error("synthetic current proof unavailable");
    },
  });
  await expect(reports.get(f.actor.ownerId, f.workspaceId)).rejects.toThrow(
    "synthetic current proof unavailable",
  );
  expect(legacyReads).toBe(0);
  expect(f.db.sqlite.query("SELECT count(*) AS n FROM v2_reports").get()).toEqual({ n: 0 });
});
