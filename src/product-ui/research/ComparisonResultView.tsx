import {
  PRECEDENT_COMPARISON_CRITERIA,
  type V2PrecedentComparison,
} from "../../contracts/v2/precedent-comparison";
import { Button as ControlButton } from "../Button";
import { Dialog } from "../Dialog";
import { Disclosure, DisclosureSummary } from "../Disclosure";
import { PrecedentDocumentView as PrecedentDocument } from "./PrecedentDocumentView";

const verdictLabels = {
  yes: "유사 · +12.5점",
  no: "차이 있음 · +0점",
  unknown: "확인 불가 · +0점",
};
export function ComparisonResultView({
  comparison,
  fullText,
  selected,
  setSelected,
}: {
  comparison: V2PrecedentComparison;
  fullText?: string | undefined;
  selected: number[];
  setSelected: (indices: number[]) => void;
}) {
  return (
    <div
      data-product-comparison-result=""
      className="min-w-0 space-y-5 text-[var(--pui-text)] [overflow-wrap:anywhere]"
    >
      <section
        className="space-y-4 rounded-2xl border border-[var(--pui-border)] bg-[var(--pui-background)] p-4 sm:p-5"
        aria-label="유사도 요약"
      >
        <div className="flex flex-wrap items-center gap-4 [&>strong]:text-4xl [&>strong]:font-semibold [&>strong]:tracking-tight [&_h4]:font-medium [&_p]:mt-1 [&_p]:text-xs [&_p]:text-[var(--pui-muted)]">
          <strong>
            {comparison.percentage}
            <span>%</span>
          </strong>
          <div>
            <h4>사실관계 유사도</h4>
            <p>8개 지표 중 {comparison.matchedCount}개 일치</p>
          </div>
        </div>
        <progress
          className="h-2 w-full overflow-hidden rounded-full bg-[var(--pui-border)] accent-[var(--pui-primary)]"
          value={comparison.percentage}
          max={100}
          aria-label="사실관계 유사도"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={comparison.percentage}
        />
        <p className="text-xs leading-6 text-[var(--pui-muted)]">
          유사 {comparison.matchedCount} · 차이 {comparison.knownCount - comparison.matchedCount} ·
          확인 불가 {8 - comparison.knownCount}
        </p>
        <p className="text-sm leading-6 text-[var(--pui-muted)]">
          승소 가능성이나 판결 예측을 뜻하지 않아요.
        </p>
      </section>
      <div className="space-y-1 [&_h4]:text-base [&_h4]:font-medium [&_p]:text-xs [&_p]:leading-6 [&_p]:text-[var(--pui-muted)]">
        <h4>항목별 비교</h4>
        <p>항목을 누르면 양쪽 근거와 판단 이유를 볼 수 있어요.</p>
      </div>
      <fieldset className="grid min-w-0 grid-cols-1 gap-2 border-0 p-0 sm:grid-cols-2">
        <legend className="sr-only">유사도 산정 지표</legend>
        {comparison.metrics.map((metric, index) => (
          <ControlButton
            type="button"
            key={metric.criterion}
            data-product-comparison-indicator=""
            data-verdict={metric.verdict}
            variant="secondary"
            className="h-auto flex-col items-start gap-2 whitespace-normal p-3 text-left text-sm [&_strong]:text-xs [&_strong]:font-medium [&_strong]:text-[var(--pui-muted)]"
            onClick={() => setSelected([index])}
          >
            <span>{PRECEDENT_COMPARISON_CRITERIA[metric.criterion]}</span>
            <strong>{verdictLabels[metric.verdict]}</strong>
          </ControlButton>
        ))}
      </fieldset>
      <Disclosure className="text-sm">
        <DisclosureSummary>유사도 산정 기준</DisclosureSummary>
        <p>
          8개 지표 중 양쪽 근거와 함께 일치한 항목마다 12.5점씩 더해요. 차이가 있거나 확인할 수 없는
          항목은 0점이며, 백분율은 반올림해 표시해요.
        </p>
      </Disclosure>
      <section
        className="min-w-0 space-y-4 rounded-2xl border border-[var(--pui-border)] p-4 sm:p-5"
        aria-label="유사한 판례 원문"
      >
        <div className="space-y-1 [&_h4]:text-base [&_h4]:font-medium [&_p]:text-xs [&_p]:leading-6 [&_p]:text-[var(--pui-muted)]">
          <h4>{comparison.matchedCount ? "판례에서 유사한 부분" : "비교한 판결문"}</h4>
          {!!comparison.matchedCount && (
            <p>파란색 문장을 눌러 내 사건과 유사한 이유를 확인하세요.</p>
          )}
        </div>
        <PrecedentDocument
          text={fullText ?? comparison.source.excerpt.text}
          startUtf16={fullText ? 0 : comparison.source.excerpt.startUtf16}
          comparison={comparison}
          onSelect={setSelected}
        />
        {!comparison.matchedCount && (
          <p className="text-xs leading-6 text-[var(--pui-muted)]">
            양쪽 근거로 일치가 확인된 부분이 아직 없어요.
          </p>
        )}
        {!fullText && comparison.source.excerpt.truncated && (
          <p className="text-xs leading-6 text-[var(--pui-muted)]">
            원문 일부를 표시했어요. 전체 내용은 공식 원문에서 확인해 주세요.
          </p>
        )}
      </section>
      <Dialog
        className="max-h-[calc(100dvh-3rem)] max-w-4xl overflow-y-auto"
        open={selected.length > 0}
        onClose={() => setSelected([])}
        title="비교 근거와 이유"
        description="저장된 사건 사실과 확인한 판결문 범위를 비교했어요."
      >
        <ComparisonReasons comparison={comparison} selected={selected} />
      </Dialog>
    </div>
  );
}

export function ComparisonReasons({
  comparison,
  selected,
}: {
  comparison: V2PrecedentComparison;
  selected: number[];
}) {
  return (
    <>
      {selected.map((index) => {
        const metric = comparison.metrics[index];
        if (!metric) return null;
        return (
          <section
            key={metric.criterion}
            data-product-comparison-reason=""
            className="min-w-0 space-y-4 [overflow-wrap:anywhere]"
          >
            <header className="flex flex-wrap items-center justify-between gap-2 [&_h3]:font-medium">
              <h3>{PRECEDENT_COMPARISON_CRITERIA[metric.criterion]}</h3>
              <span
                data-verdict={metric.verdict}
                className="rounded-lg bg-[var(--pui-background)] px-2 py-1 text-xs font-medium text-[var(--pui-muted)]"
              >
                {verdictLabels[metric.verdict]}
              </span>
            </header>
            <p>{metric.explanation}</p>
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              <section
                data-product-comparison-evidence=""
                className="min-w-0 space-y-2 rounded-xl border border-[var(--pui-border)] p-3 text-sm leading-7 [&_h4]:font-medium [&_p]:text-[var(--pui-muted)] [&_blockquote]:whitespace-pre-wrap"
              >
                <h4>내 사건</h4>
                {metric.caseEvidence.length ? (
                  metric.caseEvidence.map((e) => (
                    <blockquote key={`${e.factId}:${e.text}`}>
                      <mark
                        data-match={metric.verdict === "yes" || undefined}
                        className={
                          metric.verdict === "yes"
                            ? "bg-[var(--pui-background)] text-[var(--pui-focus)]"
                            : "bg-transparent text-[var(--pui-text)]"
                        }
                      >
                        {e.text}
                      </mark>
                    </blockquote>
                  ))
                ) : (
                  <p>비교할 근거가 부족해요.</p>
                )}
              </section>
              <section
                data-product-comparison-evidence=""
                className="min-w-0 space-y-2 rounded-xl border border-[var(--pui-border)] p-3 text-sm leading-7 [&_h4]:font-medium [&_p]:text-[var(--pui-muted)] [&_blockquote]:whitespace-pre-wrap"
              >
                <h4>판례</h4>
                {metric.precedentEvidence.length ? (
                  metric.precedentEvidence.map((e) => (
                    <blockquote key={`${e.startUtf16}:${e.endUtf16}`}>
                      <mark
                        data-match={metric.verdict === "yes" || undefined}
                        className={
                          metric.verdict === "yes"
                            ? "bg-[var(--pui-background)] text-[var(--pui-focus)]"
                            : "bg-transparent text-[var(--pui-text)]"
                        }
                      >
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
    </>
  );
}
