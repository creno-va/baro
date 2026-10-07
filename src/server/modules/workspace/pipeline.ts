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
import { V2_INTAKE_POLICY, v2ReferenceIsAuthorized } from "../../../contracts/v2";
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
export type WorkspaceOutputPolicyReason =
  | "unauthorized_reference"
  | "unsupported_fact"
  | "prohibited_content"
  | "question_repetition"
  | "audit_rejected";

/** A rejected generated draft can be regenerated; a provider refusal cannot. */
export class WorkspaceOutputPolicyError extends ModelError {
  constructor(readonly reason: WorkspaceOutputPolicyReason) {
    super("POLICY_REJECTED");
  }
}

const privateIdentifiers = (text: string) =>
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|01[016789][- ]?\d{3,4}[- ]?\d{4}/i.test(text);
const prohibited = (text: string) =>
  privateIdentifiers(text) ||
  /승소\s*(확률|가능성\s*\d|보장)|반드시\s*승소|변호사로서|무조건\s*(승소|이깁)|(?:고소|소송|협상)\s*전략/i.test(
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
    throw new WorkspaceOutputPolicyError("unauthorized_reference");
}
export function assertWorkspaceFacts(context: WorkspaceContext, facts: readonly V2Fact[]) {
  for (const fact of facts) {
    assertWorkspaceReferences(context, fact.references);
    // Reported statements and extracted observations cannot gain invented numbers or facts.
    if (fact.attribution === "user_statement" || fact.attribution === "user_material") {
      if (!fact.references.some((ref) => sourceText(context, ref)?.includes(fact.text)))
        throw new WorkspaceOutputPolicyError("unsupported_fact");
      // A verbatim attributed report of a demand or legal topic is not AI advice.
      // It still must not expose identifiers, and the independent audit checks attribution.
      if (privateIdentifiers(fact.text)) throw new WorkspaceOutputPolicyError("prohibited_content");
    } else if (prohibited(fact.text)) {
      throw new WorkspaceOutputPolicyError("prohibited_content");
    }
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
  const regenerateDraft = async <T>(
    context: WorkspaceContext,
    generateAndValidate: (input: unknown) => Promise<T>,
  ): Promise<T> => {
    try {
      return await generateAndValidate(context);
    } catch (error) {
      if (!(error instanceof WorkspaceOutputPolicyError)) throw error;
      // One newly admitted generation, with a sanitized reason and full revalidation.
      // Provider refusals and infrastructure failures do not enter this recovery path.
      return generateAndValidate({ ...context, draftCorrection: { reason: error.reason } });
    }
  };
  const audit = async (
    phase: "workspace_questions" | "workspace_summary" | "workspace_chat",
    context: WorkspaceContext,
    draft: unknown,
    requestId: string,
  ) => {
    const checked = workspaceAuditOutputSchema.parse(
      await call("workspace_audit", { phase, context, draft }, requestId),
    );
    if (
      !checked.pass ||
      checked.strategyDetected ||
      !checked.legalClaimsSupported ||
      checked.unsupportedFactIds.length ||
      checked.findings.some((f) => f.severity === "critical")
    )
      throw new WorkspaceOutputPolicyError("audit_rejected");
  };
  return {
    async questions(context: WorkspaceContext, requestId: string) {
      if (
        context.intake.batches.reduce((count, batch) => count + batch.questions.length, 0) >=
        V2_INTAKE_POLICY.followupLimit
      )
        throw new ModelError("POLICY_REJECTED");
      return regenerateDraft(context, async (input) => {
        const draft = workspaceQuestionsOutputSchema.parse(
          await call("workspace_questions", input, requestId),
        );
        if (
          draft.questions.some(
            (question) => prohibited(question.prompt) || question.options.some(prohibited),
          )
        )
          throw new WorkspaceOutputPolicyError("prohibited_content");
        const normalized = (prompt: string) => prompt.normalize("NFKC").replace(/\s+/g, "");
        const prior = new Set(
          context.intake.batches.flatMap((batch) =>
            batch.questions.map((question) => normalized(question.prompt)),
          ),
        );
        // Never publish exact normalized repetitions, including previously skipped questions.
        // A repeated single-question draft is regenerated within the same follow-up slot.
        draft.questions = draft.questions.filter((question) => {
          const prompt = normalized(question.prompt);
          if (prior.has(prompt)) return false;
          prior.add(prompt);
          return true;
        });
        if (!draft.questions.length) throw new WorkspaceOutputPolicyError("question_repetition");
        await audit("workspace_questions", context, draft, requestId);
        return draft.questions.map((question) => ({ ...question, id: crypto.randomUUID() }));
      });
    },
    async summary(context: WorkspaceContext, requestId: string) {
      return regenerateDraft(context, async (input) => {
        const draft = workspaceSummaryOutputSchema.parse(
          await call("workspace_summary", input, requestId),
        );
        assertWorkspaceFacts(context, draft.facts);
        if (
          prohibited(draft.overview) ||
          draft.parties.some((party) => prohibited(JSON.stringify(party)))
        )
          throw new WorkspaceOutputPolicyError("prohibited_content");
        await audit("workspace_summary", context, draft, requestId);
        return draft;
      });
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
        throw new WorkspaceOutputPolicyError("prohibited_content");
      await audit("workspace_chat", context, draft, requestId);
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
