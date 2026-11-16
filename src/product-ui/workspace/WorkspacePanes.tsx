import type {
  ConversationPane,
  ConversationPaneProps,
} from "../../components/workspace/ConversationAgent";
import { ConversationPreparation } from "../../components/workspace/ConversationPreparation";
import { Button, ButtonLink } from "../Button";
import type { WorkspaceComponents } from "./slots";
import type { WorkspaceController } from "./useWorkspaceController";
export function workspacePanes(
  controller: WorkspaceController,
  components: WorkspaceComponents,
  historyButton: (
    collection: "messages" | "actions" | "timeline",
    label: string,
  ) => React.ReactNode,
) {
  const {
    caseId,
    view,
    setConversationRequest,
    openMaterials,
    verify,
    ticket,
    current,
    readonly,
    refreshPreparation,
    toggleAction,
    saveConversationReport,
    openConversationFile,
    base,
  } = controller;
  const { ConversationReconfirmation, FollowUpResolution } = components;
  function renderConversationPane(pane: ConversationPane, props: ConversationPaneProps) {
    if (!view) return null;
    if (pane === "reconfirmation")
      return (
        <ConversationReconfirmation
          caseId={caseId}
          pane={props}
          access={{ ticket, current, verify }}
        />
      );
    if (pane === "report")
      return (
        <div
          data-product-workspace-conversation-report-entry=""
          className="space-y-3 rounded-xl border border-[var(--pui-border)] p-4 text-sm leading-7 text-[var(--pui-muted)]"
        >
          <p>
            준비·실행 상태는 이 대화에서 확인할 수 있어요. 전체 내용의 확인·편집·저장은 리포트
            화면에서 이어가세요.
          </p>
          <ButtonLink href={`${base}/reports?mode=conversation`}>리포트 열기</ButtonLink>
        </div>
      );
    if (pane === "materials") return <Button onClick={openMaterials}>자료 패널 열기</Button>;
    if (pane === "preparation")
      return (
        <ConversationPreparation
          view={view}
          disabled={
            props.disabled ||
            readonly ||
            view.messages.some((message) => message.status === "pending")
          }
          onReviewFile={openConversationFile}
          onActionChange={(id, done) => void toggleAction(id, done)}
          onRefresh={(target) => void refreshPreparation(target)}
          history={{
            timeline: historyButton("timeline", "이전 흐름 더 불러오기"),
            actions: historyButton("actions", "이전 행동 더 불러오기"),
          }}
        />
      );
    if (pane === "followup" || pane === "lawyers")
      return (
        <>
          {props.state.report.status !== "ready" && (
            <div
              data-product-workspace-error=""
              className="space-y-3 rounded-xl border border-[var(--pui-danger)] bg-[var(--pui-surface)] p-4 text-sm leading-7 text-[var(--pui-danger)] [overflow-wrap:anywhere]"
            >
              <p>현재 사건 기준의 리포트를 먼저 준비하고 검토하면 해결 방법을 이어갈 수 있어요.</p>
              <Button
                variant="secondary"
                disabled={props.disabled}
                onClick={() =>
                  setConversationRequest({ id: crypto.randomUUID(), action: "prepare_report" })
                }
              >
                리포트 준비로 이어가기
              </Button>
            </div>
          )}
          <FollowUpResolution
            caseId={caseId}
            embedded
            {...(props.state.report.id && props.state.report.revision
              ? { reportId: props.state.report.id, reportRevision: props.state.report.revision }
              : {})}
            disabled={props.readDisabled || props.state.report.status !== "ready"}
            onSaveReport={() =>
              saveConversationReport(props.state.report.id, props.state.report.revision)
            }
            onChanged={() => {
              void props.onChanged();
            }}
            onCancel={props.onCancel}
            onDirtyChange={props.onDirtyChange}
            onBusyChange={props.onBusyChange}
          />
        </>
      );
    return null;
  }

  return renderConversationPane;
}
