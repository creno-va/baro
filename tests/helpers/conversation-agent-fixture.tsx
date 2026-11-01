import { useEffect, useRef, useState } from "react";
import type { WorkspaceView } from "../../src/client/api/types";
import { Button } from "../../src/components/ui/button";
import {
  ConversationAgent,
  type ConversationClient,
} from "../../src/components/workspace/ConversationAgent";
import type { ConversationFixtureControl } from "./conversation-agent-browser-api";
import { limitedConversationState } from "./conversation-state";

/** Explicit isolated UI adapter; never imported from a product route or service. */
export function ConversationAgentFixture() {
  const state = useRef(limitedConversationState());
  const [incoming, setIncoming] = useState<Set<string>>(new Set());
  const [visible, setVisible] = useState(true);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [workspaceRevision, setWorkspaceRevision] = useState(8);
  const [canMutate, setCanMutate] = useState(true);
  const scope = useRef(0);
  const control = useRef<ConversationFixtureControl>({
    calls: [],
    delay: false,
    fail: false,
    failureCode: "UNAVAILABLE",
    resolve: null,
    aborted: false,
    needsConsent: false,
    withdrawConsent: () => {},
    emitIntent: () => {},
    advanceWorkspace: () => {},
    catchUpState: () => {},
  });
  useEffect(() => {
    const value = control.current;
    value.withdrawConsent = () => {
      value.needsConsent = true;
      setCanMutate(false);
    };
    value.advanceWorkspace = () => setWorkspaceRevision(9);
    value.catchUpState = () => {
      state.current.workspaceRevision = 9;
    };
    value.emitIntent = (intent, revision = state.current.workspaceRevision) => {
      const id = crypto.randomUUID();
      state.current.intents.push({
        messageId: id,
        requestId: id,
        intent,
        workspaceRevision: revision,
      });
      setIncoming(new Set([id]));
    };
    // An old stored intent must be display-only on first load.
    state.current.intents = [
      {
        messageId: "old-message",
        requestId: "old-operation",
        intent: "prepare_report",
        workspaceRevision: 8,
      },
    ];
    window.conversationFixture = value;
  }, []);
  const client = useRef<ConversationClient>({
    getConversation: async () => structuredClone(state.current),
    executeAction: async (_id, request, options) => {
      const value = control.current;
      value.calls.push(structuredClone(request));
      options?.signal?.addEventListener(
        "abort",
        () => {
          value.aborted = true;
        },
        { once: true },
      );
      if (value.delay)
        await new Promise<void>((resolve) => {
          value.resolve = resolve;
        });
      if (value.fail)
        throw Object.assign(
          new Error(
            value.failureCode === "USER_QUOTA_EXCEEDED"
              ? "합성 이용 한도에 도달했어요."
              : "합성 timeout: 접수 여부를 확인해 주세요.",
          ),
          {
            code: value.failureCode,
          },
        );
      if (request.action === "prepare_report")
        state.current.report = {
          status: "ready",
          id: "report",
          revision: 1,
          basis: state.current.analysis.basis,
          currentJobId: null,
          failure: null,
        };
      const panes = {
        add_material: "materials",
        reconfirm_case: "reconfirmation",
        show_preparation: "preparation",
        analyze_legal: "analysis",
        prepare_report: "report",
        resolve_followup: "followup",
        save_report: "report",
        open_lawyers: "lawyers",
      } as const;
      return {
        contractVersion: "conversation-report-v1",
        requestId: request.requestId,
        workspaceRevision: 8,
        pane: panes[request.action],
        status: "require_confirmation",
        operationId: null,
        missingItems: [],
      };
    },
  }).current;
  const workspace: WorkspaceView = {
    case: {
      id: "synthetic-case",
      title: "합성 사건",
      subjectContext: "individual",
      stage: "active",
      schemaVersion: "2",
      revision: workspaceRevision,
      updatedAt: "2026-11-01T00:00:00.000Z",
      summary: "합성 사건",
    },
    files: [],
    actions: [],
    timeline: [],
    messages: [],
  };
  return (
    <div
      className="app-main workspace workspace--chat"
      style={{ maxWidth: "840px", margin: "auto", padding: "16px", width: "100%" }}
    >
      <h1>합성 사건 대화</h1>
      <Button
        variant="ghost"
        onClick={() => {
          ++scope.current;
          setVisible(false);
        }}
      >
        합성 계정 전환
      </Button>
      <div className="workspace-main" style={{ height: "calc(100svh - 180px)" }}>
        <div className="workspace-messages" role="log" aria-label="사건 대화">
          <p>합성 자료의 미확인 사항을 정리하고 있어요.</p>
          {visible && (
            <ConversationAgent
              workspace={workspace}
              client={client}
              incomingMessageIds={incoming}
              disabled={false}
              access={{
                ready: true,
                canMutate,
                ticket: () => scope.current,
                current: (epoch) => scope.current === epoch,
                verify: async (_hide, write) => !write || !control.current.needsConsent,
              }}
              onChanged={async () => {}}
              onBusyChange={setBusy}
              onReviewFile={() => {}}
              renderPane={(pane, props) => (
                <>
                  <p>
                    {pane === "materials"
                      ? "기존 자료 컴포넌트 연결 자리"
                      : "기존 담당 컴포넌트 연결 자리"}
                  </p>
                  <Button disabled={props.readDisabled}>기존 저장본 읽기</Button>
                  <label>
                    검토 중인 입력
                    <textarea
                      disabled={props.disabled}
                      value={text}
                      onChange={(event) => {
                        setText(event.target.value);
                        props.onDirtyChange(true);
                      }}
                    />
                  </label>
                  <Button
                    disabled={props.disabled}
                    onClick={() => {
                      props.onDirtyChange(false);
                    }}
                  >
                    합성 입력 저장
                  </Button>
                </>
              )}
            />
          )}
        </div>
        <form className="workspace-composer" onSubmit={(event) => event.preventDefault()}>
          <label htmlFor="fixture-composer">추가 사실 또는 질문</label>
          <textarea id="fixture-composer" disabled={busy} />
        </form>
      </div>
    </div>
  );
}
