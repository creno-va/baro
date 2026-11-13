import { expect, test } from "bun:test";
import { draftReviewGuidance, draftReviewState } from "../src/components/resolution/draft-review";
import type { V2ResolutionDraft } from "../src/contracts/v2/resolution";

const draft = { status: "draft", reviewed: false } as V2ResolutionDraft;
test("reviewing a draft is distinct from saving it, and editing invalidates the saved presentation", () => {
  expect(draftReviewState(draft, true, false, false)).toBe("초안 준비됨 · 사용자 검토 필요");
  expect(draftReviewState(draft, true, true, false)).toBe("작성 중 · 미저장 수정 있음");
  expect(draftReviewState(draft, true, true, true)).toBe("검토 완료 · 수정 내용 저장 전");
  expect(draftReviewState(draft, true, false, true)).toBe("검토 완료 · 저장 전");
  const saved = { ...draft, status: "saved" as const, reviewed: true };
  expect(draftReviewState(saved, true, false, true)).toBe("검토 완료 · 저장됨");
  expect(draftReviewState(saved, true, true, false)).toBe("작성 중 · 미저장 수정 있음");
  expect(draftReviewState(saved, false, true, false)).toBe("이전 기준 · 새 초안 준비 필요");
});

test("document review guidance distinguishes received documents and the purpose of criminal preparation", () => {
  expect(draftReviewGuidance.answer).toContain("소장인지 지급명령인지");
  expect(draftReviewGuidance.civil_claim).toContain("청구할 내용과 금액");
  expect(draftReviewGuidance.criminal_complaint).toContain("추측");
  expect(draftReviewGuidance.statement).toContain("기억이 불명확한 부분");
  expect(new Set(Object.values(draftReviewGuidance)).size).toBe(8);
});
