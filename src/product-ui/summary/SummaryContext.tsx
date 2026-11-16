import type { V2CaseContext } from "../../contracts/v2";

export const purposeLabels = {
  prepare_claim: "고소 준비",
  respond_to_claim: "주장 대응",
  unconfirmed: "미확인 입장",
} as const;
export const kindLabels: Record<V2CaseContext["procedure"]["kind"], string> = {
  unconfirmed: "아직 모름",
  civil: "민사",
  criminal: "형사",
  family: "가사",
  administrative: "행정",
  labor: "노동",
  other: "기타 분야",
};
export const stageLabels: Record<V2CaseContext["procedure"]["stage"], string> = {
  unconfirmed: "아직 모름",
  before_filing: "고소·청구 전",
  investigation: "수사",
  first_instance: "1심 재판",
  appeal: "항소",
  final_appeal: "상고",
  enforcement: "집행",
  other: "기타 단계",
};

export function SummaryContext({ context }: { context: V2CaseContext }) {
  return (
    <aside
      aria-label="사건 입장과 맥락"
      className="flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-xs leading-6 text-[var(--pui-muted)] [overflow-wrap:anywhere]"
    >
      <span>{purposeLabels[context.casePurpose]}</span>
      {context.procedure.kind !== "unconfirmed" && (
        <span>{kindLabels[context.procedure.kind]}</span>
      )}
      {context.procedure.stage !== "unconfirmed" && (
        <span>{stageLabels[context.procedure.stage]}</span>
      )}
      {context.procedure.description && (
        <p className="w-full whitespace-pre-wrap">{context.procedure.description}</p>
      )}
    </aside>
  );
}
