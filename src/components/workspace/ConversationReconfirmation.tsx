import { useEffect, useRef, useState } from "react";
import { SummaryReconfirmation } from "../intake/SummaryReconfirmation";
import type { ConversationPaneProps } from "./ConversationAgent";
import { ConversationContextReview } from "./ConversationContextReview";
import "../../styles/intake.css";

/** Composes the owning summary UI and explicit user context without copying
 * reconciliation or analysis logic. Only one editor may mutate at a time. */
export function ConversationReconfirmation({
  caseId,
  pane,
  access,
}: {
  caseId: string;
  pane: ConversationPaneProps;
  access: {
    ticket: () => number;
    current: (epoch: number) => boolean;
    verify: (hide?: boolean, write?: boolean) => Promise<boolean>;
  };
}) {
  const [summaryDirty, setSummaryDirty] = useState(false),
    [contextDirty, setContextDirty] = useState(false);
  const [summaryBusy, setSummaryBusy] = useState(false),
    [contextBusy, setContextBusy] = useState(false);
  const [summaryKey, setSummaryKey] = useState(0);
  const mounted = useRef(false);
  const continuation = useRef(0);
  const callbacks = useRef(pane);
  callbacks.current = pane;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      continuation.current++;
    };
  }, []);
  useEffect(() => {
    callbacks.current.onDirtyChange(summaryDirty || contextDirty);
  }, [summaryDirty, contextDirty]);
  useEffect(() => {
    callbacks.current.onBusyChange(summaryBusy || contextBusy);
  }, [summaryBusy, contextBusy]);
  useEffect(
    () => () => {
      callbacks.current.onDirtyChange(false);
      callbacks.current.onBusyChange(false);
    },
    [],
  );
  async function afterConfirmation() {
    const epoch = access.ticket();
    const serial = ++continuation.current;
    const fresh = await callbacks.current.onChanged().catch(() => null);
    if (
      !mounted.current ||
      serial !== continuation.current ||
      !access.current(epoch) ||
      !(await access.verify(false, false)) ||
      !mounted.current ||
      serial !== continuation.current ||
      !access.current(epoch)
    )
      return;
    // The owning UI has already verified the confirmation. A superseding
    // background read can return null while publishing fresher state; it must
    // not strand this finished editor. This only opens a read view. The agent
    // still fences its content/readiness against the current workspace.
    callbacks.current.onOpenPane(
      fresh && ["pending", "ready"].includes(fresh.report.status) ? "report" : "analysis",
    );
  }
  return (
    <>
      <ConversationContextReview
        caseId={caseId}
        context={pane.state.caseContext}
        disabled={pane.disabled || summaryBusy || summaryDirty}
        readDisabled={pane.readDisabled || summaryBusy || summaryDirty}
        access={access}
        onChanged={async () => {
          await callbacks.current.onChanged();
          setSummaryKey((key) => key + 1);
        }}
        onSaved={afterConfirmation}
        onDirtyChange={setContextDirty}
        onBusyChange={setContextBusy}
      />
      {summaryDirty && (
        <p className="workspace-muted">
          작성 중인 재확인 설명을 먼저 저장하거나 닫은 뒤 입장·절차를 바꿀 수 있어요.
        </p>
      )}
      <div inert={pane.readDisabled || contextBusy}>
        <SummaryReconfirmation
          key={summaryKey}
          caseId={caseId}
          embedded
          onConfirmed={() => void afterConfirmation()}
          onChanged={() => void callbacks.current.onChanged()}
          onCancel={pane.onCancel}
          onDirtyChange={setSummaryDirty}
          onBusyChange={setSummaryBusy}
        />
      </div>
    </>
  );
}
