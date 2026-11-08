import { expect, test } from "bun:test";
import { reportOrientation } from "../src/components/reports/orientation";
import { reportReviewSections } from "../src/components/reports/review-sections";

test("orientation reuses current edited text and does not guess absent facts, actions or attribution", () => {
  const text =
    "사건 개요\n사용자가 직접 고친 설명\n\n다음 행동과 필요 자료\n- 합성 원본을 확인\n\n추가 확인 사항\n- 상대 설명은 미확인";
  const before = text;
  const result = reportOrientation(reportReviewSections(text));
  expect(result.map((item) => item.text)).toEqual([
    "사용자가 직접 고친 설명",
    "- 합성 원본을 확인",
    "- 상대 설명은 미확인",
  ]);
  expect(result.map((item) => item.index)).toEqual([0, 1, 2]);
  expect(text).toBe(before);
  expect(
    reportOrientation(reportReviewSections("확인되지 않은 내용")).every(
      (item) => item.index === -1,
    ),
  ).toBe(true);
});

test("legacy headings remain supported and truncated excerpts explicitly retain the full section destination", () => {
  const text = `사건 요약\n과거 저장본\n\n준비할 행동\n${"원본 조건 확인 ".repeat(100)}\n\n미확인 사항\n아직 모르는 날짜`;
  const [summary, action, gap] = reportOrientation(reportReviewSections(text));
  expect(summary?.text).toBe("과거 저장본");
  expect(action?.truncated).toBe(true);
  expect(action?.text.length).toBe(400);
  expect(action?.index).toBe(1);
  expect(gap?.text).toBe("아직 모르는 날짜");
});
