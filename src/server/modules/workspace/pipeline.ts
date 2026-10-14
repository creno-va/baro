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
import {
  reportWorkspaceFactFailure,
  type WorkspaceFactFailure,
} from "../../dependency-diagnostics";
import { claimReviewHash, type SourceClaim, validateV2Claims } from "../citation/v2-validate";
import type { RetrievalOutput } from "../legal-retrieval/v2/contracts";
import type { WorkspaceSourceRequest } from "../legal-retrieval/v2/workspace-plans";
import type { projectWorkspaceSources } from "../legal-retrieval/v2/workspace-sources";
import type { Phase } from "../llm-gateway/prompts";
import type { createLlmGateway } from "../llm-gateway/service";
import { ModelError } from "../llm-gateway/service";
import {
  workspaceAuditOutputSchema,
  workspaceChatOutputSchema,
  workspaceQuestionsOutputSchema,
  workspaceSummaryOutputSchema,
} from "../llm-gateway/v2/schemas";

import { normalizeTimelineDates } from "./timeline-dates";

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
  /** Full originals are proof inputs and must never be sent to the model. */
  sourceRetrieval?: RetrievalOutput;
  sourceCoverage?: Awaited<ReturnType<typeof projectWorkspaceSources>>["sourceCoverage"];
  sourceLookupPerformed?: boolean;
  history?: V2Message[];
  contextCoverage?: {
    factsPartial: boolean;
    partiesPartial: boolean;
    summaryPartial: boolean;
    messagesPartial: boolean;
    materialsPartial: boolean;
    sourcesPartial?: boolean;
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
  constructor(
    readonly reason: WorkspaceOutputPolicyReason,
    readonly factFailure?: WorkspaceFactFailure,
  ) {
    super("POLICY_REJECTED");
  }
}

const unavailableSourceWarning =
  "공식 자료를 확인하지 못해 법률 설명을 제공하지 않았어요. 사실 정리는 계속할 수 있어요.";

const privateIdentifiers = (text: string) =>
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|01[016789][- ]?\d{3,4}[- ]?\d{4}/i.test(text);
const prohibited = (text: string) =>
  privateIdentifiers(text) ||
  /승소\s*(확률|가능성\s*\d|보장)|반드시\s*승소|변호사로서|무조건\s*(승소|이깁)|(?:고소|소송|협상)\s*전략/i.test(
    text,
  );

const factualPreparationRefusal = "소송 전략은 제공하지 않으며 사실과 자료 정리를 돕겠습니다.";
function prohibitedChatText(text: string) {
  if (privateIdentifiers(text)) return true;
  const [opening, ...remaining] = text.trim().split(/\r?\n/u);
  // Only this exact standalone opening is a known refusal, not strategy.
  // Keep every other line under the guard and send the full original to audit.
  return prohibited(opening === factualPreparationRefusal ? remaining.join("\n") : text);
}

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
export function assertWorkspaceFacts(
  context: WorkspaceContext,
  facts: readonly V2Fact[],
  claims: readonly SourceClaim[] = [],
) {
  const unsupported = (
    fact: V2Fact,
    category: WorkspaceFactFailure["category"],
    availableSourceCount: number,
  ) => {
    const kinds = new Set(fact.references.map((ref) => ref.kind));
    return new WorkspaceOutputPolicyError("unsupported_fact", {
      category,
      attribution: fact.attribution,
      referenceKind: kinds.size > 1 ? "mixed" : (fact.references[0]?.kind ?? "none"),
      factCount: facts.length,
      referenceCount: fact.references.length,
      availableSourceCount,
    });
  };
  for (const fact of facts) {
    assertWorkspaceReferences(context, fact.references);
    // Reported statements and extracted observations cannot gain invented numbers or facts.
    if (fact.attribution === "user_statement" || fact.attribution === "user_material") {
      const sources = fact.references
        .map((ref) => sourceText(context, ref))
        .filter((text): text is string => typeof text === "string");
      if (!sources.some((text) => text.includes(fact.text)))
        throw unsupported(
          fact,
          sources.length ? "source_text_mismatch" : "source_text_unavailable",
          sources.length,
        );
      // A verbatim attributed report of a demand or legal topic is not AI advice.
      // It still must not expose identifiers, and the independent audit checks attribution.
      if (privateIdentifiers(fact.text)) throw new WorkspaceOutputPolicyError("prohibited_content");
    } else if (
      fact.attribution === "official_source" &&
      !claims.some(
        (claim) =>
          claim.text === fact.text &&
          fact.references.some(
            (ref) => ref.kind === "official_source" && ref.citationId === claim.citationId,
          ),
      )
    ) {
      const matchingClaims = claims.filter((claim) => claim.text === fact.text);
      throw unsupported(
        fact,
        matchingClaims.length ? "claim_reference_mismatch" : "claim_text_missing",
        matchingClaims.length,
      );
    } else if (prohibited(fact.text)) {
      throw new WorkspaceOutputPolicyError("prohibited_content");
    }
  }
}

function normalizeNewFacts(context: WorkspaceContext, facts: V2Fact[]) {
  let changed = false;
  for (const fact of facts) {
    if (fact.userEdited) {
      fact.userEdited = false;
      changed = true;
    }
    if (
      fact.attribution !== "user_material" ||
      fact.certainty === "uncertain" ||
      fact.certainty === "conflicting"
    )
      continue;
    const sources = context.materials.filter(
      (material) =>
        fact.references.some((ref) => JSON.stringify(ref) === JSON.stringify(material.reference)) &&
        material.text.includes(fact.text),
    );
    if (
      sources.some((source) => {
        const coverage = source.coverage as { observationCertainty?: string; userEdited?: boolean };
        return coverage?.observationCertainty === "uncertain" || coverage?.userEdited === true;
      })
    ) {
      fact.certainty = "uncertain";
      changed = true;
    }
  }
  return changed;
}

/** Apply the same projection to paid admission and execution wire identities. */
export function workspaceModelInput(input: unknown): unknown {
  if (!input || typeof input !== "object") return input;
  const { sourceRetrieval: _proof, ...rest } = input as Record<string, unknown>;
  return "context" in rest ? { ...rest, context: workspaceModelInput(rest.context) } : rest;
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
      workspaceModelInput(input),
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
      const factFailure = error.factFailure
        ? reportWorkspaceFactFailure(error.factFailure, "draft_retry")
        : undefined;
      // One newly admitted generation, with a sanitized reason and full revalidation.
      // Provider refusals and infrastructure failures do not enter this recovery path.
      return generateAndValidate({
        ...context,
        draftCorrection: {
          reason: error.reason,
          ...(factFailure
            ? {
                factFailure: {
                  category: factFailure.category,
                  referenceKind: factFailure.referenceKind,
                },
              }
            : {}),
        },
      });
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
    return checked;
  };
  return {
    async questions(context: WorkspaceContext, requestId: string) {
      if (context.intake.batches.length >= V2_INTAKE_POLICY.followupRounds)
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
        // A fully repeated draft is regenerated within the same follow-up round.
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
        normalizeNewFacts(context, draft.facts);
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
      context = { ...context, sourceLookupPerformed: false };
      let draft = workspaceChatOutputSchema.parse(await call("workspace_chat", context, requestId));
      if (draft.requestedSources.length) {
        context = (await deps.retrieve?.(context, draft.requestedSources)) ?? {
          ...context,
          sourceStatus: "unavailable",
        };
        context.sourceLookupPerformed = true;
        draft = workspaceChatOutputSchema.parse(await call("workspace_chat", context, requestId));
        if (draft.requestedSources.length)
          throw new WorkspaceOutputPolicyError("unauthorized_reference");
      }
      const factsChanged = normalizeNewFacts(context, draft.facts);
      assertWorkspaceFacts(context, draft.facts, draft.sourceClaims);
      assertWorkspaceReferences(context, [
        ...draft.references,
        ...draft.actions.flatMap((a) => a.references),
        ...draft.timeline.flatMap((t) => t.references),
      ]);
      const ids = new Set([...context.facts, ...draft.facts].map((fact) => fact.id));
      if (
        draft.facts.some(
          (fact) =>
            context.facts.some((existing) => existing.id === fact.id) ||
            fact.conflictingFactIds.some((id) => !ids.has(id)),
        ) ||
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
        prohibitedChatText(draft.text) ||
        draft.parties.some((party) => prohibited(JSON.stringify(party)))
      )
        throw new WorkspaceOutputPolicyError("prohibited_content");
      const dates = normalizeTimelineDates(
        {
          ...context,
          facts: [
            ...context.facts,
            ...draft.facts.filter(
              (fact) =>
                fact.attribution === "user_statement" || fact.attribution === "user_material",
            ),
          ],
        },
        draft.timeline,
        (ref) => sourceText(context, ref),
      );
      draft.timeline = dates.timeline;
      const serverWarnings = [
        ...(context.sourceStatus === "unavailable" ? [unavailableSourceWarning] : []),
        ...(context.sourceCoverage?.sourcesPartial
          ? ["공식 자료 일부만 확인했어요. 출처별 제한과 원문에서 빠진 범위를 확인해 주세요."]
          : []),
        ...(factsChanged
          ? ["새 사실의 교정·미확인 표시는 원자료와 실제 사용자 수정 기록을 기준으로 유지했어요."]
          : []),
        ...(dates.changed
          ? [
              "타임라인 날짜는 원문에서 확인한 정밀도로만 표시했어요. 근거가 없으면 날짜 미확인으로 남겼어요.",
            ]
          : []),
      ];
      draft.warnings = [
        ...draft.warnings
          .filter((warning) => !serverWarnings.includes(warning))
          .slice(0, 20 - serverWarnings.length),
        ...serverWarnings,
      ];
      const claimIds = new Set(draft.sourceClaims.map((claim) => claim.citationId));
      const officialRefs = [
        ...draft.references,
        ...draft.facts.flatMap((f) => f.references),
        ...draft.actions.flatMap((a) => a.references),
        ...draft.timeline.flatMap((t) => t.references),
      ].filter((ref) => ref.kind === "official_source");
      if (
        officialRefs.some((ref) => !claimIds.has(ref.citationId)) ||
        draft.sourceClaims.some(
          (claim) =>
            !draft.text.includes(claim.text) &&
            !draft.facts.some((fact) => fact.text === claim.text),
        )
      )
        throw new WorkspaceOutputPolicyError("unsupported_fact");
      const checked = await audit("workspace_chat", context, draft, requestId);
      if (draft.sourceClaims.length) {
        const retrieval = context.sourceRetrieval;
        if (
          !retrieval ||
          draft.sourceClaims.some((claim) => {
            const source = context.sourceTexts?.find(
              (text) => text.citationId === claim.citationId,
            );
            return !source || claim.endUtf16 > source.text.length;
          })
        )
          throw new WorkspaceOutputPolicyError("unsupported_fact");
        const reviews = await Promise.all(
          draft.sourceClaims.map(async (claim) => ({
            claimId: claim.id,
            claimHash: await claimReviewHash(claim, retrieval.asOfDate),
            sourceHash:
              retrieval.chunks.find((chunk) => chunk.citation.id === claim.citationId)?.citation
                .contentHash ?? "",
            accepted: checked.legalClaimsSupported,
            policyAccepted: checked.pass && !checked.strategyDetected,
          })),
        );
        const result = await validateV2Claims(
          draft.sourceClaims,
          context.citations.filter((citation) => claimIds.has(citation.id)),
          retrieval,
          reviews,
        );
        if (!result.valid) throw new WorkspaceOutputPolicyError("unsupported_fact");
        // Claims are independently audited and integrity-checked above. Preserve
        // their provenance even when the model omitted the redundant message ref.
        // Publication rechecks these refs against current citation bindings.
        const referenced = new Set(
          draft.references.flatMap((ref) =>
            ref.kind === "official_source" ? [ref.citationId] : [],
          ),
        );
        for (const citationId of claimIds) {
          if (!referenced.has(citationId))
            draft.references.push({ kind: "official_source", citationId });
        }
        if (draft.references.length > 100)
          throw new WorkspaceOutputPolicyError("unauthorized_reference");
      }
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
