import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ReportReading } from "../src/components/reports/ReportReading";
import {
  replaceReportReviewSection,
  reportReviewSections,
} from "../src/components/reports/review-sections";

const original =
  "사건 요약\r\n송금 자료를 정리했다.\r\n\r\n당사자\r\n합성 당사자\r\n\r\n사실·주장·출처\r\n[출처] 합성 원문 · 2쪽\r\n\r\n미확인 사항\r\n거래와 약속의 관계\r\n\r\n공식 출처\r\n보존할 합성 출처\r\n\r\n준비할 행동\r\n원본을 보관한다.";

test("the review omits duplicate fact/source blocks and gives unresolved checks the same hierarchy", () => {
  expect(reportReviewSections(original).map((section) => section.title)).toEqual([
    "사건 요약",
    "당사자",
    "미확인 사항",
  ]);
  const html = renderToStaticMarkup(<ReportReading content={original} />);
  expect(html).not.toContain("사실·주장·출처");
  expect(html).not.toContain("공식 출처");
  expect(html).not.toContain("report-reading-section--uncertain");
  expect(html).toContain("추가 확인 사항");
});

test("inline editing replaces only the chosen body and retains exact hidden source blocks", () => {
  const summary = reportReviewSections(original)[0];
  if (!summary) throw new Error("Missing synthetic section");
  const next = replaceReportReviewSection(original, summary, "확인된 송금일자를 직접 고쳤다.");
  expect(next).toBe(original.replace("송금 자료를 정리했다.", "확인된 송금일자를 직접 고쳤다."));
  expect(reportReviewSections(next)[0]?.text).toBe("확인된 송금일자를 직접 고쳤다.");
  expect(renderToStaticMarkup(<ReportReading content={next} editing />)).toContain(
    'aria-label="사건 개요 수정"',
  );
});

test("empty neighboring sections and an empty final heading keep their boundaries when edited", () => {
  for (const content of ["사건 요약\n미확인 사항\n확인할 날짜", "미확인 사항"]) {
    const first = reportReviewSections(content)[0];
    if (!first) throw new Error("Missing synthetic empty section");
    const next = replaceReportReviewSection(content, first, "직접 입력한 내용");
    expect(reportReviewSections(next)[0]?.text).toBe("직접 입력한 내용");
    if (content.includes("확인할 날짜"))
      expect(reportReviewSections(next)[1]?.text).toBe("확인할 날짜");
  }
});

test("plain reports remain editable and the total server content bound still includes hidden sections", () => {
  const section = reportReviewSections("정리한 내용")[0];
  if (!section) throw new Error("Missing synthetic plain section");
  expect(replaceReportReviewSection("정리한 내용", section, "수정한 내용")).toBe("수정한 내용");
  const first = reportReviewSections(original)[0];
  if (!first) throw new Error("Missing synthetic section");
  expect(replaceReportReviewSection(original, first, "가".repeat(30000))).toBe(original);
});
