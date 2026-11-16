import { workspaceProgressText } from "@baro/client-core";
import { CircleAlert } from "lucide-react";
import { errorMessage } from "../../client/api/errors";
import { ComparisonResult } from "../../components/workspace/ComparisonResult";
import { Button } from "../Button";
import type { ComparisonPanelController } from "./useComparisonPanelController";
export function ComparisonPanelView({ controller }: { controller: ComparisonPanelController }) {
  const {
    selected,
    sourceNeedsRefresh,
    access,
    onRefreshSources,
    heading,
    originalLink,
    children,
    fullText,
    state,
    error,
    pending,
    sourceExpired,
    comparison,
    refreshRequired,
    comparisonStale,
    needsResearch,
    incomplete,
    unreadable,
    setError,
    start,
  } = controller;
  if (!access.ready) return null;

  return (
    <section
      data-product-precedent-comparison=""
      className="min-w-0 space-y-5 text-[var(--pui-text)] [overflow-wrap:anywhere]"
      aria-label="유사 판례 비교"
    >
      <h3 className="sr-only">사건과 판례 비교</h3>
      <div className="grid min-w-0 gap-4">
        {heading}
        <div className="flex flex-wrap items-start gap-2">
          {originalLink}
          <Button
            variant="secondary"
            aria-label="내 사건과 유사도 비교"
            aria-busy={pending || undefined}
            disabled={
              !selected || pending || sourceExpired || sourceNeedsRefresh || !access.canMutate
            }
            onClick={() => void start()}
          >
            {pending ? "비교하고 있어요" : comparison ? "다시 비교" : "유사도 비교"}
          </Button>
        </div>
      </div>
      {((needsResearch && !pending) || unreadable || incomplete) && (
        <div
          data-product-precedent-state=""
          className="space-y-3 rounded-2xl border border-[var(--pui-border)] bg-[var(--pui-background)] p-4 text-sm leading-7 sm:p-5 [&_h4]:text-base [&_h4]:font-medium"
          role={sourceExpired || unreadable ? "alert" : "status"}
        >
          <span className="inline-flex rounded-xl border border-[var(--pui-border)] p-2 text-[var(--pui-muted)]">
            <CircleAlert size={28} aria-hidden="true" />
          </span>
          <h4>
            {needsResearch
              ? "판례를 다시 확인해 주세요"
              : incomplete
                ? "비교를 완료하지 못했어요"
                : "비교 상태를 확인하지 못했어요"}
          </h4>
          <p>
            {sourceExpired
              ? "판례 확인 시간이 지났거나 원문이 바뀌었어요. 다시 검색한 판례를 선택해 주세요."
              : comparisonStale
                ? "비교 이후 사건이나 확인한 원문 상태가 바뀌었어요. 최신 요약과 판례로 다시 비교해 주세요."
                : sourceNeedsRefresh
                  ? "새 비교를 시작하려면 최신 사건으로 판례를 다시 검색해 주세요."
                  : error
                    ? errorMessage(error)
                    : "최신 요약과 판례를 다시 확인한 뒤 비교해 주세요."}
          </p>
          {!!error && refreshRequired && !sourceExpired && <p>{errorMessage(error)}</p>}
          <p className="text-xs leading-6 text-[var(--pui-muted)]">
            처리 중인 작업과 저장한 내용은 유지돼요.
          </p>
          {!pending &&
            (needsResearch ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setError(null);
                  onRefreshSources();
                }}
              >
                판례 다시 검색
              </Button>
            ) : (
              <Button
                variant="secondary"
                disabled={!selected || !access.canMutate}
                onClick={() => void start()}
              >
                다시 비교
              </Button>
            ))}
        </div>
      )}
      {pending && (
        <p role="status" className="text-sm leading-7 text-[var(--pui-muted)]">
          {state ? workspaceProgressText(state.job) : "비교를 준비하고 있어요."}
        </p>
      )}
      {comparison && state && (
        <>
          <ComparisonResult key={state.job.id} comparison={comparison} fullText={fullText} />
          {comparison.factsPartial && (
            <p className="rounded-xl bg-[var(--pui-background)] p-3 text-xs leading-6 text-[var(--pui-muted)]">
              저장된 사실 중 일부가 이번 비교에 포함되지 않았어요.
            </p>
          )}
          <p className="text-xs text-[var(--pui-muted)]">
            {new Date(comparison.checkedAt).toLocaleString("ko-KR")}에 비교
          </p>
        </>
      )}
      {!comparison && children}
    </section>
  );
}
