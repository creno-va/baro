import type { CaseStatus } from "../../contracts";

export const statusLabels: Record<CaseStatus, string> = {
  screening: "입력 확인",
  needs_clarification: "추가 질문",
  queued: "분석 대기",
  analyzing: "공식 자료 확인·결과 점검",
  completed: "결과 완료",
  out_of_scope: "지원 범위 안내",
  urgent_redirect: "긴급 안전 안내",
  failed: "분석 실패",
};

export const terminal = new Set(["completed", "out_of_scope", "urgent_redirect", "failed"]);
export const delays = [1000, 2000, 4000, 8000, 15000];
export const stages: Record<string, string> = {
  queued: "분석 대기",
  screening: "입력 확인",
  retrieving: "공식 자료 확인",
  generating: "결과 정리",
  validating: "결과 점검",
  waiting_for_answers: "추가 질문 대기",
  completed: "분석 완료",
  failed: "분석 실패",
  superseded: "최신 입력 확인",
};
