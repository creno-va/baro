import type { V2ConversationIntent, V2ConversationState } from "../../contracts/v2";

export const conversationActionLabels: Record<V2ConversationIntent, string> = {
  add_material: "자료 추가·검토",
  reconfirm_case: "사건 정리 재확인",
  show_preparation: "타임라인·다음 행동 확인",
  analyze_legal: "법률·판례와 현재 약점 확인",
  prepare_report: "리포트 준비·검토",
  resolve_followup: "이후 해결 방법 선택",
  save_report: "검토한 리포트 저장",
  open_lawyers: "변호사와 해결 준비",
};

/** Chooses a UI action only; neither a read nor this projection executes work. */
export function nextConversationAction(state: V2ConversationState): V2ConversationIntent {
  if (!state.summaryConfirmed) return "reconfirm_case";
  if (state.pendingEvidenceIds.length) return "add_material";
  if (["not_started", "stale", "pending", "running", "failed"].includes(state.analysis.status))
    return "analyze_legal";
  if (state.report.status !== "ready") return "prepare_report";
  return "resolve_followup";
}

export const conversationPaneTitles = {
  materials: "자료 추가와 검토",
  reconfirmation: "사건 정리 재확인",
  preparation: "사건의 흐름과 다음 행동",
  analysis: "법률·판례와 현재 약점",
  report: "리포트 준비와 검토",
  followup: "이후 해결 방법",
  lawyers: "변호사와 해결 준비",
} as const;
