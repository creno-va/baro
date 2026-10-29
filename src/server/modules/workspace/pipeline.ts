import type { z } from "zod";
import type {
  V2Fact,
  V2FactReference,
  V2Intake,
  V2LookupToolId,
  V2Message,
  V2OfficialCitation,
  V2ReferenceContext,
  V2Summary,
  V2ToolResult,
  V2UserMessage,
} from "../../../contracts/v2";
import {
  V2_INTAKE_POLICY,
  v2ReferenceIsAuthorized,
  v2ToolResultsSchema,
} from "../../../contracts/v2";
import { legalFailureMessages } from "../../../contracts/v2/legal-availability";
import {
  type precedentComparisonSourceSchema,
  type V2PrecedentComparison,
  v2PrecedentComparisonSchema,
} from "../../../contracts/v2/precedent-comparison";
import {
  reportWorkspaceFactFailure,
  type WorkspaceFactFailure,
} from "../../dependency-diagnostics";
import type { ClaimFailure } from "../citation/claim-diagnostics";
import { instrumentNumbersGrounded } from "../citation/instrument-numbers";
import { type QuotationResolution, resolveQuotationSpans } from "../citation/quotation-spans";
import { claimReviewHash, type SourceClaim, validateV2Claims } from "../citation/v2-validate";
import type { lookupCatalog } from "../external-tools/catalog";
import {
  type ComparisonEvidenceObservation,
  inspectPrecedentComparison,
  precedentComparisonScore,
} from "../legal-retrieval/research/comparison";
import type { RetrievalOutput } from "../legal-retrieval/v2/contracts";
import type { WorkspaceSourceRequest } from "../legal-retrieval/v2/workspace-plans";
import type { projectWorkspaceSources } from "../legal-retrieval/v2/workspace-sources";
import { type Phase, workspaceStrategyRefusal } from "../llm-gateway/prompts";
import type { createLlmGateway } from "../llm-gateway/service";
import { ModelError } from "../llm-gateway/service";
import {
  workspaceAuditOutputSchema,
  workspaceChatOutputSchema,
  workspaceQuestionsOutputSchema,
  workspaceSummaryOutputSchema,
} from "../llm-gateway/v2/schemas";
import type { WorkspaceAuditFailure } from "./audit-diagnostics";
import type { WorkspaceContentFailure } from "./content-diagnostics";
import type { MaterialWindow, MaterialWindowRequest } from "./materials";
import { normalizeIntakeQuestion } from "./questions";
import { normalizeTimelineDates } from "./timeline-dates";

export type WorkspaceContext = {
  subjectContext?: "individual" | "company";
  /** Server clock only; never derived from user text or persisted event timestamps. */
  calendar?: { localDate: string; timeZone: "Asia/Seoul" };
  intake: V2Intake;
  confirmedSummary: V2Summary | null;
  precedentComparison?: {
    basedOnWorkspaceRevision: number;
    summaryRevision: number;
    source: z.infer<typeof precedentComparisonSourceSchema>;
  };
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
  materialLookupPerformed?: boolean;
  history?: V2Message[];
  lookupTools?: ReturnType<typeof lookupCatalog>;
  toolResults?: V2ToolResult[];
  toolLookupPerformed?: boolean;
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
  materialWindows?: Omit<MaterialWindow, "materials">[];
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
    readonly auditFailure?: WorkspaceAuditFailure,
    readonly contentFailure?: WorkspaceContentFailure,
    readonly claimFailure?: ClaimFailure,
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

const factualPreparationRefusal = workspaceStrategyRefusal;
function prohibitedChatText(text: string) {
  if (privateIdentifiers(text)) return true;
  const [opening, ...remaining] = text.trim().split(/\r?\n/u);
  // Only this exact standalone opening is a known refusal, not strategy.
  // Keep every other line under the guard and send the full original to audit.
  return prohibited(opening === factualPreparationRefusal ? remaining.join("\n") : text);
}

// Diagnostics run only after the unchanged rejection predicate has matched.
function textFailure(
  field: WorkspaceContentFailure["field"],
  text: string,
  canonicalRefusalOpening: boolean | null = null,
): WorkspaceContentFailure {
  const category = privateIdentifiers(text)
    ? "private_identifier"
    : /(?:고소|소송|협상)\s*전략/i.test(text)
      ? "strategy"
      : /승소\s*(확률|가능성\s*\d|보장)|반드시\s*승소|무조건\s*(승소|이깁)/i.test(text)
        ? "outcome_claim"
        : /변호사로서/i.test(text)
          ? "professional_role"
          : "unclassified";
  return { field, category, canonicalRefusalOpening };
}
function chatContentFailure(
  context: WorkspaceContext,
  draft: ReturnType<typeof workspaceChatOutputSchema.parse>,
  ids: Set<string>,
): WorkspaceContentFailure {
  const [opening, ...remaining] = draft.text.trim().split(/\r?\n/u);
  const canonical = opening === factualPreparationRefusal;
  const entity = (
    field: WorkspaceContentFailure["field"],
    category: WorkspaceContentFailure["category"],
  ): WorkspaceContentFailure => ({ field, category, canonicalRefusalOpening: canonical });
  for (const fact of draft.facts) {
    if (context.facts.some((existing) => existing.id === fact.id))
      return entity("fact_relation", "duplicate_fact_id");
    if (fact.conflictingFactIds.some((id) => !ids.has(id)))
      return entity("fact_relation", "unknown_conflicting_fact");
  }
  for (const action of draft.actions) {
    if (action.revision !== 1) return entity("action_state", "invalid_revision");
    if (action.status !== "todo") return entity("action_state", "invalid_status");
    if (action.factIds.some((id) => !ids.has(id))) return entity("action_relation", "unknown_fact");
    const text = `${action.title} ${action.instructions} ${action.caution}`;
    if (prohibited(text)) return textFailure("action_text", text, canonical);
  }
  for (const entry of draft.timeline) {
    if (entry.revision !== 1) return entity("timeline_state", "invalid_revision");
    if (entry.userEdited) return entity("timeline_state", "user_edited");
    if (entry.factIds.some((id) => !ids.has(id)))
      return entity("timeline_relation", "unknown_fact");
    if (prohibited(entry.event)) return textFailure("timeline_event", entry.event, canonical);
  }
  if (prohibitedChatText(draft.text))
    return textFailure(
      "chat_text",
      privateIdentifiers(draft.text) || !canonical ? draft.text : remaining.join("\n"),
      canonical,
    );
  for (const party of draft.parties) {
    const text = JSON.stringify(party);
    if (prohibited(text)) return textFailure("party", text, canonical);
  }
  return entity("chat_draft", "unclassified");
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
        .flatMap((ref) =>
          ref.kind === "user_material"
            ? context.materials
                .filter((material) => JSON.stringify(material.reference) === JSON.stringify(ref))
                .map((material) => material.text)
            : [sourceText(context, ref)],
        )
        .filter((text): text is string => typeof text === "string");
      if (!sources.some((text) => text.includes(fact.text)))
        throw unsupported(
          fact,
          sources.length ? "source_text_mismatch" : "source_text_unavailable",
          sources.length,
        );
      // A verbatim attributed report of a demand or legal topic is not AI advice.
      // It still must not expose identifiers, and the independent audit checks attribution.
      if (privateIdentifiers(fact.text))
        throw new WorkspaceOutputPolicyError(
          "prohibited_content",
          undefined,
          undefined,
          textFailure("fact_text", fact.text),
        );
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
      throw new WorkspaceOutputPolicyError(
        "prohibited_content",
        undefined,
        undefined,
        textFailure("fact_text", fact.text),
      );
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
    } else if (
      fact.certainty === "reported" &&
      sources.length > 0 &&
      sources.every((source) => {
        const coverage = source.coverage as { observationCertainty?: string; userEdited?: boolean };
        return coverage?.observationCertainty === "observed" && coverage?.userEdited === false;
      })
    ) {
      // This confirms the exact excerpt in a machine-read source, never the
      // underlying event or the document's authenticity. Users cannot set it.
      fact.certainty = "observed";
      changed = true;
    }
  }
  return changed;
}

/** Apply the same projection to paid admission and execution wire identities. */
export function workspaceModelInput(input: unknown): unknown {
  if (!input || typeof input !== "object") return input;
  const { sourceRetrieval: _proof, ...rest } = input as Record<string, unknown>;
  // Citation IDs still bind claims, but supplier database IDs are not legal
  // numbers and have no role in the generation/audit evidence projection.
  if (Array.isArray(rest.citations))
    rest.citations = rest.citations.map((citation) => {
      const { officialId: _internalId, ...evidence } = citation;
      return evidence;
    });
  if (Array.isArray(rest.history)) rest.history = rest.history.map(workspaceModelInput);
  if (rest.precedentComparison) {
    const context = rest as unknown as WorkspaceContext;
    return {
      calendar: context.calendar,
      facts: context.facts,
      confirmedSummary: context.confirmedSummary
        ? {
            revision: context.confirmedSummary.revision,
            overview: context.confirmedSummary.overview,
            unknowns: context.confirmedSummary.unknowns,
          }
        : null,
      precedentComparison: context.precedentComparison,
      contextCoverage: context.contextCoverage,
      ...(rest.draftCorrection ? { draftCorrection: rest.draftCorrection } : {}),
    };
  }
  return "context" in rest ? { ...rest, context: workspaceModelInput(rest.context) } : rest;
}

/** The draft and independent audit remain private. No unvalidated tokens are streamed. */
export function createWorkspacePipeline(
  gateway: ReturnType<typeof createLlmGateway>,
  deps: {
    reserve: (phase: Phase) => Promise<boolean>;
    invocation: (phase: Phase) => string;
    observeQuotationResolution?: (resolution: QuotationResolution) => void;
    observeComparisonEvidence?: (observation: ComparisonEvidenceObservation) => void;
    retrieve?: (
      context: WorkspaceContext,
      requests: WorkspaceSourceRequest[],
    ) => Promise<WorkspaceContext>;
    lookup?: (tools: V2LookupToolId[]) => Promise<V2ToolResult[]>;
    /** Server-owned IDs from this operation's encrypted explicit consent.
     * Keep the initial model admission unchanged; execute before its final answer. */
    explicitLookupTools?: V2LookupToolId[];
    readMaterials?: (
      context: WorkspaceContext,
      requests: MaterialWindowRequest[],
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
    phase:
      | "workspace_questions"
      | "workspace_summary"
      | "workspace_chat"
      | "workspace_precedent_compare",
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
      throw new WorkspaceOutputPolicyError("audit_rejected", undefined, {
        pass: checked.pass,
        legalClaimsSupported: checked.legalClaimsSupported,
        strategyDetected: checked.strategyDetected,
        findings: checked.findings.map(({ severity, code, target, basis, sourceClaimReason }) => ({
          severity,
          code,
          target,
          basis,
          ...(severity === "critical" && target === "source_claim" && basis === "verified_source"
            ? { sourceClaimReason }
            : {}),
        })),
        unsupportedFactCount: checked.unsupportedFactIds.length,
      });
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
        // Normalize only newly generated UI choices before independent audit.
        // Saved questions/answers and the source context remain unchanged.
        draft.questions = draft.questions.map(normalizeIntakeQuestion);
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
        const { caseTitle, ...summary } = workspaceSummaryOutputSchema.parse(
          await call("workspace_summary", input, requestId),
        );
        // Null is the strict wire representation of an absent title. Keep old
        // audit inputs unchanged while still auditing every generated title.
        const draft = { ...summary, ...(caseTitle ? { caseTitle } : {}) };
        normalizeNewFacts(context, draft.facts);
        assertWorkspaceFacts(context, draft.facts);
        if (
          prohibited(draft.overview) ||
          prohibited(draft.caseTitle ?? "") ||
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
      const comparison = context.precedentComparison;
      if (comparison) {
        if (comparison.summaryRevision !== context.confirmedSummary.revision)
          throw new ModelError("POLICY_REJECTED");
        return regenerateDraft(context, async (input) => {
          const raw = await call("workspace_precedent_compare", input, requestId);
          const checked = inspectPrecedentComparison(raw, context.facts, comparison.source);
          try {
            deps.observeComparisonEvidence?.(checked.observation);
          } catch {
            /* Diagnostics never change acceptance. */
          }
          const draft = checked.draft;
          if (!draft) throw new WorkspaceOutputPolicyError("unsupported_fact");
          if (draft.metrics.some((metric) => prohibited(JSON.stringify(metric))))
            throw new WorkspaceOutputPolicyError("prohibited_content");
          await audit("workspace_precedent_compare", context, draft, requestId);
          const result: V2PrecedentComparison = v2PrecedentComparisonSchema.parse({
            schemaVersion: "2",
            criteriaVersion: "1",
            ...comparison,
            publishedWorkspaceRevision: comparison.basedOnWorkspaceRevision + 2,
            checkedAt: new Date().toISOString(),
            metrics: draft.metrics,
            ...precedentComparisonScore(draft),
            factsPartial:
              !!context.contextCoverage?.factsPartial || !!context.contextCoverage?.summaryPartial,
          });
          return {
            text: "선택한 판례와 사건 사실의 항목별 비교를 마쳤어요. 유사 판례 탭에서 일치한 점과 다른 점, 확인하지 못한 점의 근거를 확인할 수 있어요.",
            references: [
              { kind: "official_source" as const, citationId: comparison.source.citation.id },
            ],
            citations: [comparison.source.citation],
            warnings: [],
            facts: [],
            parties: [],
            actions: [],
            timeline: [],
            toolResults: [],
            sourceClaims: [],
            precedentComparison: result,
          };
        });
      }
      context = {
        ...context,
        sourceLookupPerformed: false,
        ...(context.lookupTools ? { toolLookupPerformed: false, toolResults: [] } : {}),
      };
      let draft = workspaceChatOutputSchema.parse(await call("workspace_chat", context, requestId));
      const requestedTools = deps.explicitLookupTools?.length
        ? deps.explicitLookupTools
        : draft.requestedTools;
      const toolsRequested = requestedTools.length > 0;
      if (toolsRequested) {
        if (
          !deps.lookup ||
          requestedTools.length > 2 ||
          new Set(requestedTools).size !== requestedTools.length ||
          requestedTools.some((tool) => !context.lookupTools?.some((entry) => entry.tool === tool))
        )
          throw new WorkspaceOutputPolicyError("unauthorized_reference");
        const toolResults = v2ToolResultsSchema.parse(await deps.lookup(requestedTools));
        if (
          toolResults.length !== requestedTools.length ||
          toolResults.some((result, index) => result.tool !== requestedTools[index])
        )
          throw new WorkspaceOutputPolicyError("unauthorized_reference");
        context = { ...context, toolResults, toolLookupPerformed: true };
      }
      if (draft.requestedMaterials.length) {
        if (
          !deps.readMaterials ||
          draft.requestedMaterials.some(
            (request) =>
              !context.references.files.some(
                (file) => file.id === request.fileId && file.revision === request.fileRevision,
              ),
          )
        )
          throw new WorkspaceOutputPolicyError("unauthorized_reference");
        context = {
          ...(await deps.readMaterials(context, draft.requestedMaterials)),
          materialLookupPerformed: true,
        };
        draft = workspaceChatOutputSchema.parse(await call("workspace_chat", context, requestId));
        if (draft.requestedMaterials.length)
          throw new WorkspaceOutputPolicyError("unauthorized_reference");
      } else if (toolsRequested) {
        draft = workspaceChatOutputSchema.parse(await call("workspace_chat", context, requestId));
      }
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
      if (draft.requestedMaterials.length || draft.requestedTools.length)
        throw new WorkspaceOutputPolicyError("unauthorized_reference");
      const finishDraft = async () => {
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
          throw new WorkspaceOutputPolicyError(
            "prohibited_content",
            undefined,
            undefined,
            chatContentFailure(context, draft, ids),
          );
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
          ...new Set(
            context.sourceCoverage?.outcomes
              .flatMap((outcome) => [
                ...(outcome.reason ? [legalFailureMessages[outcome.reason]] : []),
                ...(outcome.sourceFailures ?? []).map((reason) => legalFailureMessages[reason]),
              ])
              .filter((message): message is string => !!message)
              .slice(0, 8) ?? [],
          ),
          ...(context.sourceStatus === "unavailable" ? [unavailableSourceWarning] : []),
          ...(context.sourceCoverage?.sourcesPartial
            ? ["공식 자료 일부만 확인했어요. 출처별 제한과 원문에서 빠진 범위를 확인해 주세요."]
            : []),
          ...(factsChanged
            ? ["새 사실의 확인 상태는 자료에 적힌 내용과 직접 수정한 기록을 기준으로 표시했어요."]
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
        if (draft.sourceClaims.some((claim) => claim.kind === "quotation")) {
          const resolved = resolveQuotationSpans(draft.sourceClaims, context);
          draft.sourceClaims = resolved.claims;
          // Diagnostic observers cannot affect acceptance. Audit and claim hashes
          // below both receive these final coordinates, never a pre-repair receipt.
          try {
            deps.observeQuotationResolution?.(resolved.resolution);
          } catch {}
        }
        if (
          !instrumentNumbersGrounded(
            {
              ...draft,
              // Already checked exact user quotations remain attributed reports;
              // they do not establish a number in the assistant's explanation.
              facts: draft.facts.filter(
                (fact) =>
                  fact.attribution !== "user_statement" && fact.attribution !== "user_material",
              ),
            },
            draft.sourceClaims,
            context.sourceTexts ?? [],
          )
        )
          throw new WorkspaceOutputPolicyError(
            "unsupported_fact",
            undefined,
            undefined,
            undefined,
            "unsupported_instrument_number",
          );
        const checked = await audit("workspace_chat", context, draft, requestId);
        if (draft.sourceClaims.length) {
          const retrieval = context.sourceRetrieval;
          const rejectClaim = (failure: ClaimFailure) =>
            new WorkspaceOutputPolicyError(
              "unsupported_fact",
              undefined,
              undefined,
              undefined,
              failure,
            );
          if (!retrieval) throw rejectClaim("retrieval_missing");
          for (const claim of draft.sourceClaims) {
            const source = context.sourceTexts?.find(
              (text) => text.citationId === claim.citationId,
            );
            if (!source) throw rejectClaim("excerpt_missing");
            if (claim.endUtf16 > source.text.length) throw rejectClaim("excerpt_span_bounds");
          }
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
          if (!result.valid) {
            throw new WorkspaceOutputPolicyError(
              "unsupported_fact",
              undefined,
              undefined,
              undefined,
              result.failure,
            );
          }
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
          toolResults: context.toolResults ?? [],
          citations: context.citations.filter((citation) => cited.has(citation.id)),
        };
      };
      try {
        return await finishDraft();
      } catch (error) {
        if (!(error instanceof WorkspaceOutputPolicyError)) throw error;
        const bodyFailure =
          error.reason === "prohibited_content" &&
          error.contentFailure?.field === "chat_text" &&
          error.contentFailure.category === "strategy" &&
          !error.contentFailure.canonicalRefusalOpening &&
          (draft.timeline.length > 0 || draft.actions.length > 0);
        const auditFailure = error.auditFailure;
        const timelineFailure =
          error.reason === "audit_rejected" &&
          draft.timeline.length > 0 &&
          auditFailure?.legalClaimsSupported === true &&
          auditFailure.strategyDetected === false &&
          auditFailure.unsupportedFactCount === 0 &&
          auditFailure.findings.length > 0 &&
          auditFailure.findings.every(
            (finding) =>
              finding.severity === "critical" &&
              finding.code === "unsupported_fact" &&
              finding.target === "timeline" &&
              finding.basis === "intake_narrative",
          );
        const metadataFailure =
          error.reason === "unsupported_fact" &&
          error.claimFailure === "unsupported_instrument_number";
        if (!bodyFailure && !timelineFailure && !metadataFailure) throw error;
        // One shared newly admitted correction for these narrow failures. Never expose the
        // rejected draft, repeat lookup side effects, or relax the full validation/audit.
        draft = workspaceChatOutputSchema.parse(
          await call(
            "workspace_chat",
            {
              ...context,
              draftCorrection: bodyFailure
                ? {
                    reason: "prohibited_content",
                    contentFailure: { field: "chat_text", category: "strategy" },
                  }
                : metadataFailure
                  ? {
                      reason: "unsupported_fact",
                      claimFailure: "unsupported_instrument_number",
                    }
                  : {
                      reason: "audit_rejected",
                      auditFailure: {
                        code: "unsupported_fact",
                        target: "timeline",
                        basis: "intake_narrative",
                      },
                    },
            },
            requestId,
          ),
        );
        if (
          draft.requestedSources.length ||
          draft.requestedMaterials.length ||
          draft.requestedTools.length
        )
          throw new WorkspaceOutputPolicyError("unauthorized_reference");
        return finishDraft();
      }
    },
  };
}
export type ValidatedChat = Awaited<ReturnType<ReturnType<typeof createWorkspacePipeline>["chat"]>>;
