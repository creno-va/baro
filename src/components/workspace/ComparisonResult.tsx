import { useState } from "react";
import { precedentHighlights } from "../../client/precedent-highlights";
import {
  PRECEDENT_COMPARISON_CRITERIA,
  type V2PrecedentComparison,
} from "../../contracts/v2/precedent-comparison";
import { Dialog } from "../ui/dialog";

const verdictLabels = {
  yes: "유사 · +12.5점",
  no: "차이 있음 · +0점",
  unknown: "확인 불가 · +0점",
};
export function ComparisonResult({ comparison }: { comparison: V2PrecedentComparison }) {
  const [selected, setSelected] = useState<number[]>([]);
  return (
    <div className="comparison-result">
      <section className="comparison-summary" aria-label="유사도 요약">
        <div className="comparison-score">
          <strong>
            {comparison.percentage}
            <span>%</span>
          </strong>
          <div>
            <h4>사실관계 유사도</h4>
            <p>8개 지표 중 {comparison.matchedCount}개 일치</p>
          </div>
        </div>
        <progress value={comparison.percentage} max={100} aria-label="사실관계 유사도" />
        <p className="comparison-caption">
          유사 {comparison.matchedCount} · 차이 {comparison.knownCount - comparison.matchedCount} ·
          확인 불가 {8 - comparison.knownCount}
        </p>
        <p className="comparison-disclaimer">승소 가능성이나 판결 예측을 뜻하지 않아요.</p>
      </section>
      <div className="comparison-section-heading">
        <h4>항목별 비교</h4>
        <p>항목을 누르면 양쪽 근거와 판단 이유를 볼 수 있어요.</p>
      </div>
      <fieldset className="comparison-indicators">
        <legend className="sr-only">유사도 산정 지표</legend>
        {comparison.metrics.map((metric, index) => (
          <button
            type="button"
            key={metric.criterion}
            className={`comparison-indicator comparison-indicator--${metric.verdict}`}
            onClick={() => setSelected([index])}
          >
            <span>{PRECEDENT_COMPARISON_CRITERIA[metric.criterion]}</span>
            <strong>{verdictLabels[metric.verdict]}</strong>
          </button>
        ))}
      </fieldset>
      <details className="comparison-method">
        <summary>유사도 산정 기준</summary>
        <p>
          8개 지표 중 양쪽 근거와 함께 일치한 항목마다 12.5점씩 더해요. 차이가 있거나 확인할 수 없는
          항목은 0점이며, 백분율은 반올림해 표시해요.
        </p>
      </details>
      <section className="comparison-excerpt" aria-label="유사한 판례 원문">
        <div className="comparison-section-heading">
          <h4>{comparison.matchedCount ? "판례에서 유사한 부분" : "비교한 판결문"}</h4>
          {!!comparison.matchedCount && (
            <p>파란색 문장을 눌러 내 사건과 유사한 이유를 확인하세요.</p>
          )}
        </div>
        <p className="precedent-body">
          {precedentHighlights(comparison).map((segment) =>
            segment.metrics.length ? (
              <button
                key={segment.start}
                type="button"
                className="comparison-highlight"
                onClick={() => setSelected(segment.metrics)}
                aria-label={`${segment.text} · 유사한 이유 보기`}
              >
                {segment.text}
              </button>
            ) : (
              <span key={segment.start}>{segment.text}</span>
            ),
          )}
        </p>
        {!comparison.matchedCount && (
          <p className="precedent-scope">양쪽 근거로 일치가 확인된 부분이 아직 없어요.</p>
        )}
        {comparison.source.excerpt.truncated && (
          <p className="precedent-scope">
            원문 일부를 표시했어요. 전체 내용은 공식 원문에서 확인해 주세요.
          </p>
        )}
      </section>
      <Dialog
        open={selected.length > 0}
        onOpenChange={(open) => {
          if (!open) setSelected([]);
        }}
        title="비교 근거와 이유"
        description="저장된 사건 사실과 확인한 판결문 범위를 비교했어요."
      >
        {selected.map((index) => {
          const metric = comparison.metrics[index];
          if (!metric) return null;
          return (
            <section key={metric.criterion} className="comparison-reason">
              <header className="comparison-reason-heading">
                <h3>{PRECEDENT_COMPARISON_CRITERIA[metric.criterion]}</h3>
                <span className={`comparison-verdict comparison-verdict--${metric.verdict}`}>
                  {verdictLabels[metric.verdict]}
                </span>
              </header>
              <p>{metric.explanation}</p>
              <div className="comparison-evidence-grid">
                <section className="comparison-evidence">
                  <h4>내 사건</h4>
                  {metric.caseEvidence.length ? (
                    metric.caseEvidence.map((e) => (
                      <blockquote key={`${e.factId}:${e.text}`}>
                        <mark className={metric.verdict === "yes" ? "comparison-match" : undefined}>
                          {e.text}
                        </mark>
                      </blockquote>
                    ))
                  ) : (
                    <p>비교할 근거가 부족해요.</p>
                  )}
                </section>
                <section className="comparison-evidence">
                  <h4>판례</h4>
                  {metric.precedentEvidence.length ? (
                    metric.precedentEvidence.map((e) => (
                      <blockquote key={`${e.startUtf16}:${e.endUtf16}`}>
                        <mark className={metric.verdict === "yes" ? "comparison-match" : undefined}>
                          {e.text}
                        </mark>
                      </blockquote>
                    ))
                  ) : (
                    <p>확인한 원문에서 근거를 찾지 못했어요.</p>
                  )}
                </section>
              </div>
            </section>
          );
        })}
      </Dialog>
    </div>
  );
}
