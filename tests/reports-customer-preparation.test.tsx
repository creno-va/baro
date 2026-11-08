import { afterEach, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ReportReading } from "../src/components/reports/ReportReading";
import { type V2LegalAnalysisSnapshot, v2LegalAnalysisSnapshotSchema } from "../src/contracts/v2";
import { missingReportAnalysis, reportAnalysisText } from "../src/server/modules/reports/analysis";
import { createReportsService } from "../src/server/modules/reports/service";
import { reportText } from "../src/server/modules/reports/source";
import { reportSections } from "../src/utils/report-sections";
import { reportPreparedAnalysisFixture } from "./helpers/report-prepared-analysis-fixture";

const fixtures: Awaited<ReturnType<typeof reportPreparedAnalysisFixture>>[] = [];
afterEach(() => {
  for (const f of fixtures.splice(0)) f.db.close();
});

for (const purpose of ["prepare_claim", "respond_to_claim"] as const) {
  test(`${purpose}: new encrypted report orients and prepares before detail, with unchanged audited sources`, async () => {
    const f = await reportPreparedAnalysisFixture(purpose);
    fixtures.push(f);
    const before = JSON.stringify(f.snapshot);
    const reports = createReportsService(f.core, {
      ...f.deps,
      readPreparedAnalysis: async () => f.snapshot,
    });
    const report = await reports.get(f.actor.ownerId, f.workspaceId);
    const sections = reportSections(report.content).map((s) => s.title);
    expect(report.title).toBe("내 사건 이해와 해결 준비");
    expect(sections.slice(0, 6)).toEqual([
      "리포트 준비 상태",
      "내 사건 한눈에",
      "사건 입장과 절차",
      "먼저 확인할 핵심 쟁점",
      "다음 행동과 필요 자료",
      "선택지와 확인 조건",
    ]);
    expect(report.content).toContain(
      purpose === "prepare_claim" ? "청구 준비에 부족한 자료" : "인정하는 사실과 다투는 사실",
    );
    expect(report.content).toContain(f.snapshot.evidenceRequirements[0]?.reason ?? "missing");
    expect(report.content).toContain("준비물 · 증거 1");
    expect(report.content).toContain("확인 기준 ·");
    expect(report.content).not.toContain("UTF-16");
    expect(JSON.stringify(f.snapshot)).toBe(before);
    const web = renderToStaticMarkup(<ReportReading content={report.content} />);
    const html = await reports.html(f.actor.ownerId, report.id);
    for (const text of [
      "먼저 확인할 핵심 쟁점",
      "선택지와 확인 조건",
      f.statute.source.body,
      f.precedent.source.body,
      "출처와 분석 기준",
    ]) {
      expect(web).toContain(text);
      expect(html).toContain(text);
    }
    const edited = "사건 요약\n사용자가 보관한 과거 표현\n\n준비할 행동\n직접 적은 원본 확인";
    const saved = await reports.save(f.actor.ownerId, f.workspaceId, crypto.randomUUID(), {
      expectedRevision: report.revision,
      content: edited,
      maskIdentifiers: false,
      excludedFileIds: [],
    });
    const old = await reports.peek(f.actor.ownerId, f.workspaceId);
    expect(old?.content).toBe(saved.content);
    expect(old?.content).toContain("사용자가 보관한 과거 표현");
    expect(old?.content).not.toContain("내 사건 한눈에");
    expect(await reports.html(f.actor.ownerId, saved.id)).toContain("사용자가 보관한 과거 표현");
    expect((await reports.peek(f.actor.ownerId, f.workspaceId))?.content).toBe(saved.content);
  });
}

test("absent materials and analysis preserve unknown position and procedure without fabricating a legal option", async () => {
  const f = await reportPreparedAnalysisFixture();
  fixtures.push(f);
  const body = (await import("../src/server/modules/reports/source")).buildReportSource;
  const source = await body(f.core, f.actor, f.workspaceId, [f.fileId]);
  const content = reportAnalysisText(
    source.body,
    reportText(source.body, source.coverage, source.display),
    missingReportAnalysis(),
  );
  expect(content).toContain("처리 완료된 증거 자료가 없습니다");
  expect(content).toContain("입장과 절차 단계는 검증된 분석에서 아직 확인하지 못했습니다");
  expect(content).toContain("청구 준비와 상대 주장 대응 중 어느 입장인지 아직 확정하지 않았습니다");
  expect(content).toContain("구체적인 행동과 준비물이 아직 연결되지 않았습니다");
  expect(content).not.toContain(f.statute.source.body);
  expect(content).not.toContain("신고·제소 전");
});

test("conflicting and incomplete analysis keeps adverse facts, gaps and official verification separate", async () => {
  const f = await reportPreparedAnalysisFixture("respond_to_claim");
  fixtures.push(f);
  const snapshot: V2LegalAnalysisSnapshot = v2LegalAnalysisSnapshotSchema().parse({
    ...f.snapshot,
    status: "partial",
    context: {
      ...f.snapshot.context,
      procedure: { kind: "unconfirmed", stage: "unconfirmed", description: null },
    },
    issues: f.snapshot.issues.map((issue) => ({
      ...issue,
      requirements: issue.requirements.map((r) => ({
        ...r,
        assessment: "conflicting",
        conflictingFactIds: [f.factId],
        gaps: ["합의와 다른 상대방 설명 확인 필요"],
      })),
    })),
    limitations: ["제출처·기한·공식 절차는 미확인"],
  });
  const reports = createReportsService(f.core, {
    ...f.deps,
    readPreparedAnalysis: async () => snapshot,
  });
  const report = await reports.get(f.actor.ownerId, f.workspaceId);
  for (const text of [
    "보완 필요",
    "상반된 사실·자료",
    "상반된 내용",
    "자료 기재",
    "합의와 다른 상대방 설명 확인 필요",
    "제출처·기한·공식 절차는 미확인",
    "절차 단계 미확인",
    snapshot.perspective.weaknesses[0] ?? "missing",
  ])
    expect(report.content).toContain(text);
  expect(report.content).not.toContain("분석 확인 ·");
});
