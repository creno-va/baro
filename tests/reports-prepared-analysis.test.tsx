import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ReportReading } from "../src/components/reports/ReportReading";
import { type V2LegalAnalysisSnapshot, v2LegalAnalysisSnapshotSchema } from "../src/contracts/v2";
import { createV2ReportsRepository } from "../src/server/db/v2-reports";
import { reportAnalysisReviewSchema } from "../src/server/modules/reports/analysis-review";
import { createReportsService } from "../src/server/modules/reports/service";
import { reportPreparedAnalysisFixture } from "./helpers/report-prepared-analysis-fixture";

async function fixture(purpose: "prepare_claim" | "respond_to_claim" = "prepare_claim") {
  const f = await reportPreparedAnalysisFixture(purpose);
  let prepared: V2LegalAnalysisSnapshot | null = v2LegalAnalysisSnapshotSchema().parse(f.snapshot);
  let unavailable = false;
  const reports = createReportsService(f.core, {
    ...f.deps,
    readPreparedAnalysis: async () => {
      if (unavailable) throw new Error("synthetic immutable analysis read failure");
      return prepared;
    },
  });
  return {
    ...f,
    reports,
    setPrepared: (value: typeof prepared) => {
      prepared = value;
    },
    fail: (value: boolean) => {
      unavailable = value;
    },
  };
}

test("read-only peek creates no report, operation or analysis job", async () => {
  const f = await fixture();
  const count = () =>
    f.db.sqlite.query("SELECT count(*) AS n FROM v2_reports").get() as { n: number };
  expect(count().n).toBe(0);
  expect(await f.reports.peek(f.actor.ownerId, f.workspaceId)).toBeNull();
  expect(count().n).toBe(0);
});

for (const purpose of ["prepare_claim", "respond_to_claim"] as const)
  test(`${purpose}: stored validated requirements, comparison, exact quotes and next actions share one body`, async () => {
    const f = await fixture(purpose);
    const report = await f.reports.get(f.actor.ownerId, f.workspaceId);
    const peek = await f.reports.peek(f.actor.ownerId, f.workspaceId);
    expect(peek?.analysisReview.status).toBe("ready");
    expect(report).not.toHaveProperty("analysisReview");
    const html = await f.reports.html(f.actor.ownerId, report.id);
    const web = renderToStaticMarkup(<ReportReading content={report.content} />);
    for (const text of [
      f.statute.source.body,
      f.precedent.source.body,
      "반환 약정과 이행 조건",
      `관련 법 조항 · ${f.statute.citation.title} ${f.statute.citation.kind === "statute" ? f.statute.citation.article : ""} (근거 1)`,
      "증거 1 · 1쪽",
      "송금 경위가 공통입니다.",
      "판례에는 서명 원본이 있으나 사건에는 원본을 확인하지 못했습니다.",
      "원본 대화 확인 필요",
      "출처와 분석 기준",
    ]) {
      expect(html).toContain(text);
      expect(web).toContain(text);
    }
    expect(html).not.toContain("<strong>원문 기호</strong>");
    expect(html).not.toContain("<s>서로 구별</s>");
    const canonical = await createV2ReportsRepository(f.core).read(f.actor, report.id);
    expect(canonical?.body.citations.map((citation) => citation.id)).toContain(
      f.statute.citation.id,
    );
    expect(canonical?.body.citations.map((citation) => citation.id)).toContain(
      f.precedent.citation.id,
    );
    const expected =
      purpose === "prepare_claim"
        ? "청구할 반환 조건과 이행기"
        : "증여 또는 정산이었다는 우리 설명";
    expect(report.content).toContain(expected);
    const pdf = await f.reports.pdf(f.actor.ownerId, report.id);
    expect(new TextDecoder().decode((await new Response(pdf.body).arrayBuffer()).slice(0, 5))).toBe(
      "%PDF-",
    );
  });

test("a newer immutable analysis marks the old report stale without changing its body or prior HTML", async () => {
  const f = await fixture();
  const first = await f.reports.get(f.actor.ownerId, f.workspaceId);
  f.setPrepared(
    v2LegalAnalysisSnapshotSchema().parse({
      ...f.snapshot,
      id: "synthetic-next-analysis",
      perspective: { ...f.snapshot.perspective, weaknesses: ["새 분석에만 있는 약점"] },
    }),
  );
  const old = await f.reports.peek(f.actor.ownerId, f.workspaceId);
  expect(old?.id).toBe(first.id);
  expect(old?.stale).toBe(true);
  expect(old?.content).toBe(first.content);
  expect(old?.analysisReview.analysisId).toBe(f.snapshot.id);
  expect(await f.reports.html(f.actor.ownerId, first.id)).not.toContain("새 분석에만 있는 약점");
  const next = await f.reports.generate(f.actor.ownerId, f.workspaceId, crypto.randomUUID(), {
    expectedRevision: first.revision,
  });
  expect(next.content).toContain("새 분석에만 있는 약점");
  expect(next.revision).toBe(first.revision + 1);
});

test("excluding evidence removes all dependent legal, precedent and weakness prose from the new snapshot", async () => {
  const f = await fixture();
  const first = await f.reports.get(f.actor.ownerId, f.workspaceId);
  const next = await f.reports.save(f.actor.ownerId, f.workspaceId, crypto.randomUUID(), {
    expectedRevision: first.revision,
    content: first.content,
    maskIdentifiers: false,
    excludedFileIds: [f.fileId],
  });
  expect(next.content).not.toContain("합성 자료 관찰용 비공개 표식");
  expect(next.content).not.toContain("서명 원본이 있으나");
  expect(next.content).not.toContain(f.statute.source.body);
  expect((await f.reports.peek(f.actor.ownerId, f.workspaceId))?.analysisReview.status).toBe(
    "review_required",
  );
  expect(await f.reports.html(f.actor.ownerId, next.id)).not.toContain(
    "합성 자료 관찰용 비공개 표식",
  );
  expect(await f.reports.html(f.actor.ownerId, first.id)).toContain("합성 자료 관찰용 비공개 표식");
  const regenerated = await f.reports.generate(
    f.actor.ownerId,
    f.workspaceId,
    crypto.randomUUID(),
    { expectedRevision: next.revision },
  );
  expect(regenerated.excludedFileIds).toEqual([f.fileId]);
  expect(regenerated.content).not.toContain("합성 자료 관찰용 비공개 표식");
});

test("mask changes invalidate derived analysis, retain the original report and preserve scope on regeneration", async () => {
  const f = await fixture();
  const first = await f.reports.get(f.actor.ownerId, f.workspaceId);
  const masked = await f.reports.save(f.actor.ownerId, f.workspaceId, crypto.randomUUID(), {
    expectedRevision: first.revision,
    content: first.content,
    maskIdentifiers: true,
    excludedFileIds: [],
  });
  expect(masked.content).not.toContain("송금 경위가 공통입니다");
  expect(
    (await f.reports.peek(f.actor.ownerId, f.workspaceId))?.analysisReview.analysisId,
  ).toBeNull();
  const next = await f.reports.generate(f.actor.ownerId, f.workspaceId, crypto.randomUUID(), {
    expectedRevision: masked.revision,
  });
  expect(next.maskIdentifiers).toBe(true);
  expect(await f.reports.html(f.actor.ownerId, first.id)).toContain("송금 경위가 공통입니다");
});

test("editing the body cannot keep the validated completion label, while the original remains immutable", async () => {
  const f = await fixture();
  const first = await f.reports.get(f.actor.ownerId, f.workspaceId);
  const edited = await f.reports.save(f.actor.ownerId, f.workspaceId, crypto.randomUUID(), {
    expectedRevision: first.revision,
    content: first.content.replace("원문 기호", "직접 고친 인용"),
    maskIdentifiers: false,
    excludedFileIds: [],
  });
  const review = await f.reports.peek(f.actor.ownerId, f.workspaceId);
  expect(review?.analysisReview.userEdited).toBe(true);
  expect(review?.analysisReview.status).toBe("review_required");
  expect(edited.content).toContain("사용자가 수정한 리포트");
  expect(edited.content).not.toContain("완성 · 법 조항과 판례 비교를 확인한 리포트");
  expect(await f.reports.html(f.actor.ownerId, first.id)).not.toContain("직접 고친 인용");
});

test("only an explicit matching-scope receipt can include a freshly masked analysis", async () => {
  const f = await reportPreparedAnalysisFixture();
  let snapshot = v2LegalAnalysisSnapshotSchema().parse(f.snapshot);
  let permit = true;
  const reports = createReportsService(f.core, {
    ...f.deps,
    readPreparedAnalysis: async () => snapshot,
    preparedAnalysisMatchesScope: async (_actor, caseId, analysis, scope) => {
      expect(caseId).toBe(f.workspaceId);
      return (
        permit &&
        !scope.excludedFileIds.length &&
        (scope.maskIdentifiers
          ? analysis.id === "synthetic-masked-analysis"
          : analysis.id === f.snapshot.id)
      );
    },
  });
  const first = await reports.get(f.actor.ownerId, f.workspaceId);
  const masked = await reports.save(f.actor.ownerId, f.workspaceId, crypto.randomUUID(), {
    expectedRevision: first.revision,
    content: first.content,
    maskIdentifiers: true,
    excludedFileIds: [],
  });
  expect((await reports.peek(f.actor.ownerId, f.workspaceId))?.analysisReview.status).toBe(
    "review_required",
  );
  snapshot = v2LegalAnalysisSnapshotSchema().parse({
    ...f.snapshot,
    id: "synthetic-masked-analysis",
    basis: { ...f.snapshot.basis, evidenceHash: "b".repeat(64) },
    perspective: { ...f.snapshot.perspective, weaknesses: ["가림 범위로 다시 분석한 약점"] },
  });
  const fresh = await reports.generate(f.actor.ownerId, f.workspaceId, crypto.randomUUID(), {
    expectedRevision: masked.revision,
  });
  expect(fresh.maskIdentifiers).toBe(true);
  expect(fresh.content).toContain("가림 범위로 다시 분석한 약점");
  expect((await reports.peek(f.actor.ownerId, f.workspaceId))?.analysisReview.status).toBe("ready");
  permit = false;
  expect((await reports.peek(f.actor.ownerId, f.workspaceId))?.stale).toBe(true);
  const rejected = await reports.generate(f.actor.ownerId, f.workspaceId, crypto.randomUUID(), {
    expectedRevision: fresh.revision,
  });
  expect(rejected.content).not.toContain("가림 범위로 다시 분석한 약점");
});

test("a missing snapshot or missing original excerpts cannot be persisted as complete analysis", () => {
  expect(
    reportAnalysisReviewSchema.safeParse({
      snapshot: null,
      status: "ready",
      userEdited: false,
      excerpts: [],
    }).success,
  ).toBe(false);
});

for (const status of ["empty", "unavailable"] as const)
  test(`${status}: no source list is promoted to completed analysis`, async () => {
    const f = await fixture();
    f.setPrepared(
      v2LegalAnalysisSnapshotSchema().parse({
        ...f.snapshot,
        status,
        issues: [],
        precedents: [],
        citations: [],
        sourceClaims: [],
        availability: [
          {
            kind: "statute",
            status,
            reason: status === "empty" ? "no_results" : "upstream_unavailable",
          },
        ],
      }),
    );
    const report = await f.reports.get(f.actor.ownerId, f.workspaceId);
    expect((await f.reports.peek(f.actor.ownerId, f.workspaceId))?.analysisReview.status).toBe(
      status,
    );
    expect(report.content).not.toContain("완성 ·");
    expect(report.content).toContain(
      status === "empty" ? "관련 결과 없음" : "공식 기관에서 응답 오류",
    );
  });

test("quote mismatch, altered originals, loader failure and foreign ownership fail without a synthetic success", async () => {
  const f = await fixture();
  f.setPrepared(
    v2LegalAnalysisSnapshotSchema().parse({
      ...f.snapshot,
      sourceClaims: f.snapshot.sourceClaims.map((claim, index) =>
        index ? claim : { ...claim, text: "원문과 다른 합성 인용" },
      ),
    }),
  );
  await expect(f.reports.get(f.actor.ownerId, f.workspaceId)).rejects.toThrow(
    "LEGAL_SOURCE_UNAVAILABLE",
  );
  f.setPrepared(v2LegalAnalysisSnapshotSchema().parse(f.snapshot));
  f.fail(true);
  await expect(f.reports.get(f.actor.ownerId, f.workspaceId)).rejects.toThrow(
    "synthetic immutable analysis read failure",
  );
  f.fail(false);
  const report = await f.reports.get(f.actor.ownerId, f.workspaceId);
  await expect(f.reports.peek("synthetic-foreign-owner", f.workspaceId)).rejects.toThrow(
    "NOT_FOUND",
  );
  f.db.sqlite
    .query("UPDATE v2_official_sources SET body=? WHERE source_id=?")
    .run("바뀐 합성 원문", f.statute.source.sourceId);
  await expect(
    f.reports.generate(f.actor.ownerId, f.workspaceId, crypto.randomUUID(), {
      expectedRevision: report.revision,
    }),
  ).rejects.toThrow("LEGAL_SOURCE_UNAVAILABLE");
});
