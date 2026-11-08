import type { V2ResolutionDocumentKind, V2ResolutionDraft } from "../../contracts/v2/resolution";

/** Reading guidance only; eligibility remains the server's allowedDocumentKinds. */
export const draftReviewGuidance: Record<V2ResolutionDocumentKind, string> = {
  fact_statement:
    "날짜·당사자·사건 순서와 자료의 연결을 확인하세요. 모르는 내용은 미확인으로 남겨 주세요.",
  civil_claim:
    "청구할 내용과 금액, 그 이유를 뒷받침하는 자료를 대조하세요. 제출처와 기한은 별도로 확인하세요.",
  answer:
    "상대방 주장별로 인정하는 사실과 다투는 사실을 나누어 확인하세요. 받은 문서가 소장인지 지급명령인지 먼저 확인하세요.",
  criminal_complaint:
    "피해 경위와 상대방의 행동, 각 설명을 뒷받침하는 자료를 대조하세요. 추측을 확인한 사실로 바꾸지 마세요.",
  statement:
    "기억하는 사실과 자료로 확인한 내용, 기억이 불명확한 부분을 구분하세요. 질문의 취지와 실제 진술 내용은 직접 확인하세요.",
  opinion:
    "현재 절차와 제출 목적, 본인 설명과 자료의 관계를 확인하세요. 의견을 확인한 사실과 구분해 주세요.",
  appeal:
    "받은 재판 문서와 불복 대상, 이유와 기한을 확인하세요. 항소 절차가 맞는지 별도로 확인해야 해요.",
  final_appeal:
    "불복 대상과 상고 이유, 제출 기한을 확인하세요. 항소와 상고의 요건을 같은 것으로 다루지 마세요.",
};

export function draftReviewState(
  draft: V2ResolutionDraft,
  current: boolean,
  dirty: boolean,
  reviewed: boolean,
) {
  if (!current) return "이전 기준 · 새 초안 준비 필요";
  if (dirty) return reviewed ? "검토 완료 · 수정 내용 저장 전" : "작성 중 · 미저장 수정 있음";
  if (draft.status === "saved" && draft.reviewed) return "검토 완료 · 저장됨";
  return reviewed ? "검토 완료 · 저장 전" : "초안 준비됨 · 사용자 검토 필요";
}
