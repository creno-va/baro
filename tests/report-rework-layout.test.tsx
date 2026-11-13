import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createReportHtml } from "../src/components/reports/document";
import { ReportReading } from "../src/components/reports/ReportReading";
import { reportReworkLayoutFixture } from "./helpers/report-rework-layout-fixture";

for (const side of ["claim", "response"] as const) {
  test(`${side}: web and HTML retain the same requirements, exact quotations and concrete comparison`, () => {
    const fixture = reportReworkLayoutFixture(side, true);
    const web = renderToStaticMarkup(<ReportReading content={fixture.report.content} />);
    const html = createReportHtml(fixture.report);
    for (const text of [
      fixture.position,
      fixture.quote,
      fixture.comparisonQuote,
      "송금 기록은 있으나 반환 약정의 해석을 다투는 점이 같습니다.",
      "이 사건에서는 같은 자료를 확인하지 못했습니다.",
      "증거 1 · 1쪽",
      "긴 조항 검증 35",
      "생략되지 않은 원본 대화",
      "실제 공급자 호출이나 법률 검토 승인",
      "비교 항목 55",
    ]) {
      expect(web).toContain(text);
      expect(html).toContain(text);
    }
    expect(html).not.toContain("<script");
    expect(html).toContain('<th scope="col">확인할 항목</th>');
    expect(web).toContain('<th scope="col">확인할 항목</th>');
    expect(fixture.report.content.length).toBeLessThan(30000);
  });
}

test("claim and response fixtures change the substantive weakness and next action", () => {
  const claim = reportReworkLayoutFixture("claim").report.content;
  const response = reportReworkLayoutFixture("response").report.content;
  expect(claim).toContain("청구 내용과 제출 자료");
  expect(response).not.toContain("청구 내용과 제출 자료");
  expect(response).toContain("인정하는 사실과 다투는 사실");
  expect(claim).not.toContain("인정하는 사실과 다투는 사실");
});
