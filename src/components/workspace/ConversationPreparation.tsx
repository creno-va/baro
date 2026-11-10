import { RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import type { WorkspaceView } from "../../client/api/types";
import { Button } from "../ui/button";
import { Disclosure, DisclosureSummary } from "../ui/disclosure";
import { Input as ControlInput, Label as FieldLabel } from "../ui/form";
import { timelineDateLabel } from "./source-label";
import { TimelineEvidence } from "./TimelineEvidence";

/** Conversation and tabs consume the same workspace projection and mutations. */
export function ConversationPreparation({
  view,
  disabled,
  onReviewFile,
  onActionChange,
  onRefresh,
  history,
}: {
  view: WorkspaceView;
  disabled: boolean;
  onReviewFile: (fileId: string) => void;
  onActionChange: (actionId: string, done: boolean) => void;
  onRefresh: (target: "timeline" | "actions") => void;
  history?: { timeline: ReactNode; actions: ReactNode };
}) {
  return (
    <div className="conversation-preparation">
      <Disclosure open>
        <DisclosureSummary>사건의 흐름 · {view.timeline.length}개</DisclosureSummary>
        {!view.timeline.length && (
          <p>아직 저장된 일정이 없어요. 날짜가 모호하면 미확인으로 정리할 수 있어요.</p>
        )}
        <ol className="workspace-timeline">
          {[...view.timeline]
            .sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999"))
            .map((item) => (
              <li key={item.id}>
                <time>{timelineDateLabel(item)}</time>
                <div>
                  <h4>{item.title}</h4>
                  <p>{item.detail}</p>
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
            <p className="workspace-muted">현재 불러온 일정만 표시했어요. 이전 기록도 보존돼요.</p>
          ))}
        <Button variant="ghost" size="sm" disabled={disabled} onClick={() => onRefresh("timeline")}>
          <RefreshCw size={15} /> 최신 자료로 흐름 정리
        </Button>
      </Disclosure>
      <Disclosure open>
        <DisclosureSummary>
          다음 행동 · {view.actions.filter((action) => action.done).length}/{view.actions.length}{" "}
          완료
        </DisclosureSummary>
        {!view.actions.length && (
          <p>아직 저장된 행동이 없어요. 현재 사실과 자료에서 필요한 준비를 정리할 수 있어요.</p>
        )}
        <ul className="workspace-action-list">
          {view.actions.map((action) => (
            <li key={action.id} className={action.done ? "is-done" : ""}>
              <FieldLabel>
                <ControlInput
                  type="checkbox"
                  checked={action.done}
                  disabled={disabled}
                  onChange={(event) => onActionChange(action.id, event.target.checked)}
                />
                <span>
                  <strong>{action.title}</strong>
                  <small>{action.detail}</small>
                </span>
              </FieldLabel>
            </li>
          ))}
        </ul>
        {history?.actions ??
          (view.pagination?.actions && (
            <p className="workspace-muted">현재 불러온 행동만 표시했어요. 이전 기록도 보존돼요.</p>
          ))}
        <Button variant="ghost" size="sm" disabled={disabled} onClick={() => onRefresh("actions")}>
          <RefreshCw size={15} /> 최신 자료로 행동 정리
        </Button>
      </Disclosure>
    </div>
  );
}
