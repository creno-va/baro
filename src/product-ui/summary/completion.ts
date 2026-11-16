import type { CaseView } from "../../client/api/types";
import {
  type V2ConversationState,
  type V2Summary,
  type V2SummaryReconciliation,
  v2SummarySchema,
} from "../../contracts/v2";

export type Completion =
  | {
      kind: "proposal";
      caseId: string;
      proposalId: string;
      requestId: string;
      revision: number;
      summaryRevision: number;
    }
  | {
      kind: "initial";
      caseId: string;
      revision: number;
      summaryRevision: number | null;
      canonical: V2Summary | null;
      acknowledged: boolean;
    };
export function matches(
  item: CaseView,
  state: V2SummaryReconciliation | null,
  intent: Completion,
  conversation: V2ConversationState | null,
) {
  if (item.stage !== "active") return false;
  if (intent.kind === "initial")
    return (
      intent.acknowledged &&
      item.id === intent.caseId &&
      item.summaryNeedsConfirmation !== true &&
      (item.summaryDetails?.revision ?? null) === intent.summaryRevision &&
      (!intent.canonical ||
        (item.summaryDetails &&
          JSON.stringify(v2SummarySchema.parse(item.summaryDetails)) ===
            JSON.stringify(intent.canonical))) &&
      (intent.canonical === null
        ? item.revision === intent.revision
        : // Continuing to this identical confirmed summary does not assert that
          // its later analysis/report basis is still current.
          item.revision >= intent.revision &&
          conversation?.workspaceRevision === item.revision &&
          conversation.summaryConfirmed)
    );
  return (
    // The server keeps confirmed only while the exact snapshot and source
    // basis still match. Automatic preparation may advance the current CAS.
    item.id === intent.caseId &&
    state?.status === "confirmed" &&
    state.proposal?.id === intent.proposalId &&
    state.request?.id === intent.requestId &&
    state.proposal.requestId === intent.requestId &&
    state.confirmedWorkspaceRevision === intent.revision &&
    state.workspaceRevision === item.revision &&
    item.revision >= intent.revision &&
    state.confirmedSummaryRevision === intent.summaryRevision &&
    item.summaryDetails?.revision === intent.summaryRevision &&
    item.summaryNeedsConfirmation !== true &&
    JSON.stringify(v2SummarySchema.parse(item.summaryDetails)) ===
      JSON.stringify(v2SummarySchema.parse(state.proposal.after))
  );
}

export { matches as summaryCompletionMatches };
