import type {
  V2Fact,
  V2FactReference,
  V2Intake,
  V2Message,
  V2OfficialCitation,
  V2ReferenceContext,
  V2Summary,
  V2UserMessage,
} from "../../../contracts/v2";
import { v2ReferenceIsAuthorized } from "../../../contracts/v2";
import type { WorkspaceSourceRequest } from "../legal-retrieval/v2/workspace-plans";
import type { Phase } from "../llm-gateway/prompts";
import type { createLlmGateway } from "../llm-gateway/service";
import { ModelError } from "../llm-gateway/service";
import {
  workspaceAuditOutputSchema,
  workspaceChatOutputSchema,
  workspaceQuestionsOutputSchema,
  workspaceSummaryOutputSchema,
} from "../llm-gateway/v2/schemas";

export type WorkspaceContext = {
  intake: V2Intake;
  confirmedSummary: V2Summary | null;
  messages: V2UserMessage[];
  latestMessage: V2UserMessage | null;
  facts: V2Fact[];
  references: V2ReferenceContext;
  citations: V2OfficialCitation[];
  sourceTexts?: { citationId: string; text: string }[];
  sourceStatus?: "verified" | "unavailable" | "not_requested";
  history?: V2Message[];
  contextCoverage?: {
    factsPartial: boolean;
    partiesPartial: boolean;
    summaryPartial: boolean;
    messagesPartial: boolean;
    materialsPartial: boolean;
  };
  /** Exact bounded source text and coverage, populated by trusted file readers. */
  materials: {
    reference: Extract<V2FactReference, { kind: "user_material" }>;
    text: string;
    coverage: unknown;
  }[];
};
const prohibited = (text: string) =>
  /승소\s*(확률|가능성\s*\d|보장)|반드시\s*승소|변호사로서|무조건\s*(승소|이깁)|합의금\s*\d+|(?:고소|소송|협상)\s*전략|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|01[016789][- ]?\d{3,4}[- ]?\d{4}/i.test(
    text,
  );

function sourceText(context: WorkspaceContext, ref: V2FactReference) {
  if (ref.kind === "intake_narrative") return context.intake.narrative;
  if (ref.kind === "intake_answer") {
    const answer = context.intake.batches
      .flatMap((batch) => batch.answers)
      .find((a) => a.questionId === ref.questionId);
    return answer?.status === "answered" ? answer.value : null;
  }
  if (ref.kind === "user_message")
    return (
      [...context.messages, ...(context.latestMessage ? [context.latestMessage] : [])].find(
        (message) =>
          message.id === ref.messageId && message.workspaceRevision === ref.workspaceRevision,
      )?.text ?? null
    );
  if (ref.kind === "user_material")
    return (
      context.materials.find((m) => JSON.stringify(m.reference) === JSON.stringify(ref))?.text ??
      null
    );
  return null;
}
export function assertWorkspaceReferences(
  context: WorkspaceContext,
  references: readonly V2FactReference[],
) {
  if (references.some((ref) => !v2ReferenceIsAuthorized(ref, context.references)))
    throw new ModelError("POLICY_REJECTED");
}
export function assertWorkspaceFacts(context: WorkspaceContext, facts: readonly V2Fact[]) {
  for (const fact of facts) {
    assertWorkspaceReferences(context, fact.references);
    // Reported statements and extracted observations cannot gain invented numbers or facts.
    if (fact.attribution === "user_statement" || fact.attribution === "user_material") {
      if (!fact.references.some((ref) => sourceText(context, ref)?.includes(fact.text)))
        throw new ModelError("POLICY_REJECTED");
    }
    if (prohibited(fact.text)) throw new ModelError("POLICY_REJECTED");
  }
}

/** The draft and independent audit remain private. No unvalidated tokens are streamed. */
export function createWorkspacePipeline(
  gateway: ReturnType<typeof createLlmGateway>,
  deps: {
    reserve: (phase: Phase) => Promise<boolean>;
    invocation: (phase: Phase) => string;
    retrieve?: (
      context: WorkspaceContext,
      requests: WorkspaceSourceRequest[],
    ) => Promise<WorkspaceContext>;
  },
) {
  const call = (phase: Phase, input: unknown, requestId: string) =>
    gateway.call(
      phase,
      input,
      requestId,
      () => deps.reserve(phase),
      () => deps.reserve(phase),
      deps.invocation(phase),
    );
  const audit = async (context: WorkspaceContext, draft: unknown, requestId: string) => {
    const checked = workspaceAuditOutputSchema.parse(
      await call("workspace_audit", { context, draft }, requestId),
    );
    if (
      !checked.pass ||
      checked.strategyDetected ||
      !checked.legalClaimsSupported ||
      checked.unsupportedFactIds.length ||
      checked.findings.some((f) => f.severity === "critical")
    )
      throw new ModelError("POLICY_REJECTED");
  };
  return {
    async questions(context: WorkspaceContext, requestId: string) {
      const draft = workspaceQuestionsOutputSchema.parse(
        await call("workspace_questions", context, requestId),
      );
      const prior = new Set(
        context.intake.batches.flatMap((batch) =>
          batch.questions.map((q) => q.prompt.normalize("NFKC").replace(/\s+/g, "")),
        ),
      );
      const prompts = draft.questions.map((q) => q.prompt.normalize("NFKC").replace(/\s+/g, ""));
      if (
        new Set(prompts).size !== prompts.length ||
        draft.questions.some((q, i) => prior.has(prompts[i] ?? "") || prohibited(q.prompt))
      )
        throw new ModelError("POLICY_REJECTED");
      await audit(context, draft, requestId);
      return draft.questions.map((question) => ({ ...question, id: crypto.randomUUID() }));
    },
    async summary(context: WorkspaceContext, requestId: string) {
      const draft = workspaceSummaryOutputSchema.parse(
        await call("workspace_summary", context, requestId),
      );
      assertWorkspaceFacts(context, draft.facts);
      if (
        prohibited(draft.overview) ||
        draft.parties.some((party) => prohibited(JSON.stringify(party)))
      )
        throw new ModelError("POLICY_REJECTED");
      await audit(context, draft, requestId);
      return draft;
    },
    async chat(context: WorkspaceContext, requestId: string) {
      if (
        !context.confirmedSummary ||
        context.intake.status !== "confirmed" ||
        !context.latestMessage
      )
        throw new ModelError("POLICY_REJECTED");
      let draft = workspaceChatOutputSchema.parse(await call("workspace_chat", context, requestId));
      if (draft.requestedSources.length) {
        context = (await deps.retrieve?.(context, draft.requestedSources)) ?? {
          ...context,
          sourceStatus: "unavailable",
        };
        draft = workspaceChatOutputSchema.parse(await call("workspace_chat", context, requestId));
      }
      if (context.sourceStatus === "unavailable")
        draft.warnings = [
          ...draft.warnings.slice(0, 19),
          "공식 자료를 확인하지 못해 법률 설명을 제공하지 않았어요. 사실 정리는 계속할 수 있어요.",
        ];
      assertWorkspaceFacts(context, draft.facts);
      assertWorkspaceReferences(context, [
        ...draft.references,
        ...draft.actions.flatMap((a) => a.references),
        ...draft.timeline.flatMap((t) => t.references),
      ]);
      const ids = new Set([...context.facts, ...draft.facts].map((fact) => fact.id));
      if (
        draft.facts.some((fact) => context.facts.some((existing) => existing.id === fact.id)) ||
        draft.actions.some(
          (action) =>
            action.revision !== 1 ||
            action.status !== "todo" ||
            action.factIds.some((id) => !ids.has(id)) ||
            prohibited(`${action.title} ${action.instructions} ${action.caution}`),
        ) ||
        draft.timeline.some(
          (entry) =>
            entry.revision !== 1 ||
            entry.userEdited ||
            entry.factIds.some((id) => !ids.has(id)) ||
            prohibited(entry.event),
        ) ||
        prohibited(draft.text) ||
        draft.parties.some((party) => prohibited(JSON.stringify(party)))
      )
        throw new ModelError("POLICY_REJECTED");
      await audit(context, draft, requestId);
      const cited = new Set(
        [
          ...draft.references,
          ...draft.facts.flatMap((f) => f.references),
          ...draft.actions.flatMap((a) => a.references),
          ...draft.timeline.flatMap((t) => t.references),
        ].flatMap((ref) => (ref.kind === "official_source" ? [ref.citationId] : [])),
      );
      return {
        ...draft,
        citations: context.citations.filter((citation) => cited.has(citation.id)),
      };
    },
  };
}
export type ValidatedChat = Awaited<ReturnType<ReturnType<typeof createWorkspacePipeline>["chat"]>>;
