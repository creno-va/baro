import { CalendarDays, ListChecks, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import type { WorkspaceView } from "../../client/api/types";
import { timelineDateLabel } from "../../components/workspace/source-label";
import { TimelineEvidence } from "../../components/workspace/TimelineEvidence";
import { Button } from "../Button";
import { Disclosure, DisclosureSummary } from "../Disclosure";

export type PreparationProps = {
  view: WorkspaceView;
  disabled: boolean;
  onReviewFile: (fileId: string) => void;
  onActionChange: (actionId: string, done: boolean) => void;
  onRefresh: (target: "timeline" | "actions") => void;
  history?: { timeline: ReactNode; actions: ReactNode };
};

/** The same workspace projection, explicit refreshes and native checkbox events. */
export function PreparationView({
  view,
  disabled,
  onReviewFile,
  onActionChange,
  onRefresh,
  history,
}: PreparationProps) {
  return (
    <div data-product-conversation-preparation="" className="grid min-w-0 gap-4">
      <Disclosure open className="bg-[var(--pui-surface)]">
        <DisclosureSummary>
          <span className="flex items-center gap-2">
            <CalendarDays size={17} aria-hidden="true" />
            사건의 흐름 · {view.timeline.length}개
          </span>
        </DisclosureSummary>
        {!view.timeline.length && (
          <p className="rounded-lg bg-[var(--pui-background)] p-3">
            아직 저장된 일정이 없어요. 날짜가 모호하면 미확인으로 정리할 수 있어요.
          </p>
        )}
        <ol data-product-preparation-timeline="" className="m-0 grid list-none gap-3 p-0">
          {[...view.timeline]
            .sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999"))
            .map((item) => (
              <li
                key={item.id}
                className="grid min-w-0 gap-2 border-l-2 border-[var(--pui-border)] pl-4"
              >
                <time className="text-xs font-medium text-[var(--pui-muted)]">
                  {timelineDateLabel(item)}
                </time>
                <div className="min-w-0 space-y-2 [overflow-wrap:anywhere]">
                  <h4 className="text-sm font-semibold text-[var(--pui-text)]">{item.title}</h4>
                  <p className="text-sm leading-6">{item.detail}</p>
                  <TimelineEvidence
                    entry={item}
                    files={view.files}
                    facts={view.facts}
                    base={`/cases/${encodeURIComponent(view.case.id)}`}
                    onReviewFile={onReviewFile}
                  />
                </div>
              </li>
            ))}
        </ol>
        {history?.timeline ??
          (view.pagination?.timeline && (
            <p className="text-xs text-[var(--pui-muted)]">
              현재 불러온 일정만 표시했어요. 이전 기록도 보존돼요.
            </p>
          ))}
        <Button
          variant="secondary"
          size="sm"
          disabled={disabled}
          onClick={() => onRefresh("timeline")}
        >
          <RefreshCw size={15} aria-hidden="true" />
          최신 자료로 흐름 정리
        </Button>
      </Disclosure>
      <Disclosure open>
        <DisclosureSummary>
          <span className="flex items-center gap-2">
            <ListChecks size={17} aria-hidden="true" />
            다음 행동 · {view.actions.filter((action) => action.done).length}/{view.actions.length}{" "}
            완료
          </span>
        </DisclosureSummary>
        {!view.actions.length && (
          <p className="rounded-lg bg-[var(--pui-background)] p-3">
            아직 저장된 행동이 없어요. 현재 사실과 자료에서 필요한 준비를 정리할 수 있어요.
          </p>
        )}
        <ul data-product-preparation-actions="" className="m-0 grid list-none gap-2 p-0">
          {view.actions.map((action) => (
            <li
              key={action.id}
              data-done={action.done || undefined}
              className="rounded-lg border border-[var(--pui-border)] bg-[var(--pui-background)]"
            >
              <label className="flex min-h-11 cursor-pointer items-start gap-3 p-3">
                <input
                  type="checkbox"
                  checked={action.done}
                  disabled={disabled}
                  onChange={(event) => onActionChange(action.id, event.target.checked)}
                  className="mt-1 h-4 w-4 shrink-0 appearance-auto accent-[var(--pui-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--pui-focus)] disabled:cursor-not-allowed disabled:opacity-50"
                />
                <span className="min-w-0 space-y-1 [overflow-wrap:anywhere]">
                  <strong className="block text-sm font-medium text-[var(--pui-text)]">
                    {action.title}
                  </strong>
                  <small className="block text-xs leading-5 text-[var(--pui-muted)]">
                    {action.detail}
                  </small>
                </span>
              </label>
            </li>
          ))}
        </ul>
        {history?.actions ??
          (view.pagination?.actions && (
            <p className="text-xs text-[var(--pui-muted)]">
              현재 불러온 행동만 표시했어요. 이전 기록도 보존돼요.
            </p>
          ))}
        <Button
          variant="secondary"
          size="sm"
          disabled={disabled}
          onClick={() => onRefresh("actions")}
        >
          <RefreshCw size={15} aria-hidden="true" />
          최신 자료로 행동 정리
        </Button>
      </Disclosure>
    </div>
  );
}
