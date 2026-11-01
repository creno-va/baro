import type { V2CaseContext } from "../../contracts/v2";

export const casePurposeLabels = {
  prepare_claim: "고소·청구를 준비하고 싶어요",
  respond_to_claim: "상대방 주장에 대응하고 싶어요",
  unconfirmed: "미확인 입장",
} as const;
const kinds = {
  civil: "민사",
  criminal: "형사",
  family: "가사",
  administrative: "행정",
  labor: "노동",
  other: "기타 분야",
  unconfirmed: "사건 분야 미확인",
};
const stages = {
  before_filing: "고소·청구 전",
  investigation: "수사",
  first_instance: "1심 재판",
  appeal: "항소",
  final_appeal: "상고",
  enforcement: "집행",
  other: "기타 단계",
  unconfirmed: "절차 단계 미확인",
};
export function CaseContextNote({ context }: { context: V2CaseContext }) {
  return (
    <aside className="intake-case-context" aria-label="사건 입장과 맥락">
      <span>{casePurposeLabels[context.casePurpose]}</span>
      <span>{context.subjectContext === "company" ? "기업 사건" : "개인 사건"}</span>
      <span>{kinds[context.procedure.kind]}</span>
      <span>{stages[context.procedure.stage]}</span>
      {context.procedure.description && <p>{context.procedure.description}</p>}
    </aside>
  );
}
