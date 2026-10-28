import { factQuestionPrompts, type IntakeQuestionContext } from "@baro/client-core";
import type { V2Fact } from "../../contracts/v2";
import { referenceLabel } from "../workspace/source-label";

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
  return (
    <div className="fact-answer">
      <p className="fact-answer__question">{prompts.join(" / ") || "확인한 내용"}</p>
      <p className="fact-answer__text">{fact.text}</p>
      {fact.references.some((ref) => ref.kind === "user_material") && (
        <p className="fact-answer__notice">
          {fact.certainty === "observed"
            ? "자료 근거 있음 · 사실 여부는 별도 확인"
            : "자료 근거 연결됨 · 내용 대조 필요"}
        </p>
      )}
      {(fact.certainty === "uncertain" ||
        fact.certainty === "conflicting" ||
        fact.conflictingFactIds.length > 0 ||
        fact.significance === "unfavorable") && (
        <p className="fact-answer__notice">
          {[
            fact.certainty === "uncertain" && "불확실한 내용",
            (fact.certainty === "conflicting" || fact.conflictingFactIds.length > 0) &&
              "서로 다른 진술 확인 필요",
            fact.significance === "unfavorable" && "불리한 사실",
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
      <details className="fact-answer__sources">
        <summary>출처와 확인 상태</summary>
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
              <a href={`${base}/files?file=${encodeURIComponent(ref.fileId)}`}>
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
      </details>
    </div>
  );
}
