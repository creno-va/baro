import { factQuestionPrompts, type IntakeQuestionContext } from "@baro/client-core";
import { referenceLabel } from "../../components/workspace/source-label";
import type { V2Fact } from "../../contracts/v2";
import { SummaryDisclosure } from "./SummaryDisclosure";

export function FactAnswer({
  fact,
  context,
  base,
  files,
}: {
  fact: V2Fact;
  context?: IntakeQuestionContext | undefined;
  base: string;
  files: readonly { id: string; name: string }[];
}) {
  const prompts = factQuestionPrompts(fact.references, context);
  const notices = [
    fact.certainty === "uncertain" && "불확실한 내용",
    (fact.certainty === "conflicting" || fact.conflictingFactIds.length > 0) &&
      "서로 다른 진술 확인 필요",
    fact.significance === "unfavorable" && "불리한 사실",
  ].filter(Boolean);
  return (
    <div
      data-product-summary-fact=""
      className="min-w-0 border-b border-[var(--pui-border)] py-5 last:border-b-0 [overflow-wrap:anywhere]"
    >
      <p className="mb-2 text-xs font-medium leading-5 text-[var(--pui-muted)]">
        {prompts.join(" / ") || "확인한 내용"}
      </p>
      <p
        data-product-summary-fact-text=""
        className="whitespace-pre-wrap text-base leading-7 text-[var(--pui-text)]"
      >
        {fact.text}
      </p>
      {notices.length > 0 && (
        <p className="mt-3 text-xs leading-5 text-[var(--pui-muted)]">{notices.join(" · ")}</p>
      )}
      <div className="mt-2">
        <SummaryDisclosure title="출처와 확인 상태">
          <p>
            {fact.attribution === "user_statement"
              ? "사용자 진술"
              : fact.attribution === "official_source"
                ? "공식 자료"
                : "자료에서 추출"}{" "}
            ·{" "}
            {fact.certainty === "observed"
              ? "자료 내용 확인됨 · 사실 여부는 별도 확인 필요"
              : fact.certainty === "uncertain"
                ? "불확실"
                : "보고된 사실"}
          </p>
          {fact.references.map((ref) => (
            <p key={JSON.stringify(ref)}>
              {ref.kind === "user_material" ? (
                <a
                  className="underline decoration-[var(--pui-border)] underline-offset-4"
                  href={`${base}/files?file=${encodeURIComponent(ref.fileId)}`}
                >
                  {files.find((file) => file.id === ref.fileId)?.name ?? "원본 범위 확인"} ·{" "}
                  {referenceLabel(ref)}
                </a>
              ) : ref.kind === "user_message" ? (
                "대화에서 제공"
              ) : ref.kind === "intake_answer" ? (
                "질문 답변에서 제공"
              ) : ref.kind === "intake_narrative" ? (
                "처음 제공한 이야기"
              ) : (
                "공식 출처"
              )}
            </p>
          ))}
        </SummaryDisclosure>
      </div>
    </div>
  );
}
