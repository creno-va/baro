import type { V2Job } from "@baro/contracts/v2";

/** A current server phase survives refresh; it is not an estimated completion percentage. */
export function workspaceProgressText(job: Pick<V2Job, "status" | "phase" | "kind">) {
  if (job.status === "queued") return "처리 순서를 기다리고 있어요.";
  if (job.phase === "retrieving") return "공식 법률 자료를 확인하고 있어요.";
  if (job.phase === "validating") return "정리한 내용과 근거를 검증하고 있어요.";
  if (job.phase === "assembling") return "확인한 결과를 저장하고 있어요.";
  if (job.phase === "generating") {
    if (job.kind === "intake_questions") return "다음 질문을 준비하고 있어요.";
    if (job.kind === "intake_summary") return "사건 요약을 정리하고 있어요.";
    return "추가한 내용을 바탕으로 답변을 작성하고 있어요.";
  }
  return "저장된 내용을 확인하고 있어요.";
}
