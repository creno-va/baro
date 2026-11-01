import { timestampSchema } from "../../../../contracts";
import {
  type V2LegalAnalysisSnapshot,
  v2LegalAnalysisSnapshotSchema,
} from "../../../../contracts/v2/legal-analysis";
import { legalFailureMessages } from "../../../../contracts/v2/legal-availability";
import type { V2PrecedentTopic } from "../../../../contracts/v2/precedent-research";
import { v2ReworkVersionSchema } from "../../../../contracts/v2/rework";
import { instrumentNumbersGrounded } from "../../citation/instrument-numbers";
import { claimReviewHash, validateV2Claims } from "../../citation/v2-validate";
import {
  type LegalAnalysisPlan,
  legalAnalysisAuditSchema,
  legalAnalysisOutputSchema,
  legalAnalysisPlanSchema,
} from "../../llm-gateway/analysis-schema";
import { createPrecedentRelevance } from "../research/relevance";
import { RESEARCH_CONCEPTS } from "../research/topics";
import { textHash } from "../service";
import type { Access, RetrievalOutput, RetrievalPlan, SourceChunk } from "../v2/contracts";
import { safePermit } from "../v2/contracts";
import { isWorkspacePublicQuery, workspaceRetrievalPlans } from "../v2/workspace-plans";
import { projectWorkspaceSources } from "../v2/workspace-sources";
import {
  analysisBasis,
  analysisCaseFacts,
  analysisScopeValid,
  canonicalAnalysisJson,
  type LegalAnalysisInput,
  legalAnalysisInputSchema,
} from "./context";
import { analysisDraftGrounded } from "./grounding";

export type LegalPlanningInput = LegalAnalysisInput & { asOfDate: string };
export type LegalAnalysisModelInput = LegalPlanningInput & {
  plan: LegalAnalysisPlan;
  citations: Awaited<ReturnType<typeof projectWorkspaceSources>>["citations"];
  sourceTexts: Awaited<ReturnType<typeof projectWorkspaceSources>>["sourceTexts"];
  sourceCoverage: Awaited<ReturnType<typeof projectWorkspaceSources>>["sourceCoverage"];
};
export type LegalAnalysisModel = {
  plan(input: LegalPlanningInput): Promise<unknown>;
  analyze(input: LegalAnalysisModelInput): Promise<unknown>;
  audit(input: {
    phase: "legal_analysis";
    context: LegalAnalysisModelInput;
    draft: unknown;
  }): Promise<unknown>;
};
export type PreparedLegalAnalysis = {
  snapshot: V2LegalAnalysisSnapshot;
  sourceRetrieval: RetrievalOutput;
};
export class LegalAnalysisError extends Error {
  constructor(
    readonly code:
      | "NOT_AUTHORIZED"
      | "CANCELLED"
      | "INVALID_INPUT"
      | "INVALID_PLAN"
      | "MODEL_SCHEMA_INVALID"
      | "POLICY_REJECTED"
      | "SOURCE_UNAVAILABLE"
      | "STALE_REVISION",
  ) {
    super(code);
  }
}

/** Internal service for ONE admitted durable job. The caller owns the existing
 * quota/lease/attempt ledger, encrypted persistence and atomic publication fence.
 * Public reads/polls/export never call prepare. No model or legal fallback exists. */
export function createAutomaticLegalAnalysis(deps: {
  model: LegalAnalysisModel;
  retrieve: (
    request: { plans: RetrievalPlan[]; asOfDate: string; now: string },
    access: Access,
  ) => Promise<RetrievalOutput>;
  readBoundSources: (ids: readonly string[], now: string) => Promise<(SourceChunk | null)[]>;
  authorize: () => Promise<boolean>;
  reserveRequest: Access["reserveRequest"];
  clock?: () => string;
  signal?: AbortSignal;
  guideHosts?: readonly string[];
}) {
  const clock = () =>
    new Date(
      timestampSchema.parse((deps.clock ?? (() => new Date().toISOString()))()),
    ).toISOString();
  const authorize = async () => {
    if (deps.signal?.aborted) throw new LegalAnalysisError("CANCELLED");
    if (!(await safePermit(deps.authorize))) throw new LegalAnalysisError("NOT_AUTHORIZED");
    if (deps.signal?.aborted) throw new LegalAnalysisError("CANCELLED");
  };
  async function bound(retrieval: RetrievalOutput) {
    await authorize();
    const chunks = await deps.readBoundSources(
      retrieval.chunks.map((c) => c.citation.id),
      clock(),
    );
    if (
      chunks.length !== retrieval.chunks.length ||
      chunks.some(
        (c, i) =>
          !c ||
          canonicalAnalysisJson(c.citation) !==
            canonicalAnalysisJson(retrieval.chunks[i]?.citation) ||
          c.source.body !== retrieval.chunks[i]?.source.body,
      )
    )
      throw new LegalAnalysisError("SOURCE_UNAVAILABLE");
    await authorize();
  }
  async function run(raw: LegalAnalysisInput): Promise<PreparedLegalAnalysis> {
    await authorize();
    const parsed = legalAnalysisInputSchema.safeParse(raw);
    if (
      !parsed.success ||
      !analysisScopeValid(parsed.data) ||
      new TextEncoder().encode(canonicalAnalysisJson(parsed.data)).byteLength > 192 * 1024
    )
      throw new LegalAnalysisError("INVALID_INPUT");
    const input = parsed.data;
    const basis = await analysisBasis(input);
    const now = clock(),
      asOfDate = new Date(Date.parse(now) + 9 * 3600000).toISOString().slice(0, 10);
    const planning: LegalPlanningInput = { ...input, facts: analysisCaseFacts(input), asOfDate };
    // Old official/AI facts remain in storage, but cannot establish case-side evidence.
    planning.confirmedSummary = { ...input.confirmedSummary, facts: planning.facts };
    await authorize();
    const planParsed = legalAnalysisPlanSchema.safeParse(
      await deps.model.plan(structuredClone(planning)),
    );
    if (
      !planParsed.success ||
      planParsed.data.issues.some((i) =>
        i.factIds.some((id) => !planning.facts.some((f) => f.id === id)),
      )
    )
      throw new LegalAnalysisError("INVALID_PLAN");
    const plan = planParsed.data;
    const requests = [
      ...new Map(
        plan.issues.flatMap((i) => i.requests).map((r) => [canonicalAnalysisJson(r), r]),
      ).values(),
    ];
    const plans = requests.flatMap((r) => workspaceRetrievalPlans([r]));
    await authorize();
    let attempts = 0;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120000);
    const signal = deps.signal
      ? AbortSignal.any([controller.signal, deps.signal])
      : controller.signal;
    let retrieval: RetrievalOutput;
    try {
      retrieval = await deps.retrieve(
        { plans, asOfDate, now },
        {
          authorize: deps.authorize,
          authorizeQuery: async (q) => isWorkspacePublicQuery(q),
          reserveRequest: (attempt) =>
            ++attempts <= 12 ? deps.reserveRequest(attempt) : Promise.resolve(false),
          signal,
        },
      );
    } finally {
      clearTimeout(timer);
    }
    await authorize();
    if (retrieval.outcomes.some((o) => o.reason === "not_authorized" || o.reason === "cancelled"))
      throw new LegalAnalysisError(
        controller.signal.aborted && !deps.signal?.aborted
          ? "SOURCE_UNAVAILABLE"
          : "NOT_AUTHORIZED",
      );
    const topics = (Object.keys(RESEARCH_CONCEPTS) as V2PrecedentTopic[]).filter((t) =>
      plans.some((p) => p.kind === "precedent" && p.query === RESEARCH_CONCEPTS[t]),
    );
    const relevance = createPrecedentRelevance(planning.confirmedSummary);
    const irrelevant = new Set(
      retrieval.chunks
        .filter(
          (c) =>
            c.citation.kind === "precedent" &&
            topics.length &&
            !relevance.score(c.citation.title, c.source.body, topics).relevant,
        )
        .map((c) => c.citation.id),
    );
    const relevant: RetrievalOutput = {
      ...retrieval,
      chunks: retrieval.chunks.filter((c) => !irrelevant.has(c.citation.id)),
      outcomes: retrieval.outcomes.map((o) => {
        const chunks = o.chunks.filter((c) => !irrelevant.has(c.citation.id));
        return o.availability === "verified" && !chunks.length
          ? { ...o, chunks, availability: "unavailable", reason: "no_results" }
          : { ...o, chunks };
      }),
    };
    relevant.retrievalHash = await textHash(
      JSON.stringify(relevant.chunks.map((c) => c.citation.sourceId)),
    );
    const projection = await projectWorkspaceSources(relevant, irrelevant.size);
    retrieval = projection.sourceRetrieval;
    await bound(retrieval); // Public originals/search readTokens never establish this authority.
    const availability: V2LegalAnalysisSnapshot["availability"] = retrieval.outcomes.map((o) => ({
      kind: o.kind,
      status:
        o.reason === "no_results"
          ? "empty"
          : o.availability === "not_requested"
            ? "unavailable"
            : o.availability,
      reason: o.reason,
    }));
    const limitations = [
      ...new Set([
        ...retrieval.outcomes.flatMap((o) =>
          [o.reason, ...(o.sourceFailures ?? [])].flatMap((r) =>
            r ? [legalFailureMessages[r]] : [],
          ),
        ),
        ...(irrelevant.size
          ? ["사건 쟁점과 관련성이 부족한 판례는 분석 근거에서 제외했어요."]
          : []),
        ...(projection.sourceCoverage.sourcesPartial
          ? [
              "제한된 검색과 원문 일부를 바탕으로 확인했으며 모든 관련 자료를 찾았다는 뜻은 아니에요.",
            ]
          : []),
        ...(input.context.casePurpose === "unconfirmed"
          ? [
              "고소·청구를 준비하는 쪽인지 상대방 주장에 대응하는 쪽인지 확인해야 입장별 분석을 완성할 수 있어요.",
            ]
          : []),
        ...(input.materials.some((material) => !material.coverage)
          ? [
              "일부 자료는 관찰·교정 상태를 확인하지 못했어요. 확인된 자료 관찰로 취급하지 않고 원본과 확인해야 해요.",
            ]
          : []),
        ...(input.materials.some(
          (material) => material.coverage?.observationCertainty === "uncertain",
        )
          ? ["불확실하게 읽힌 자료 내용은 확인이 필요하며 확정된 관찰이나 사건 사실로 보지 않아요."]
          : []),
        ...(input.materials.some((material) => material.coverage?.userEdited)
          ? [
              "사용자가 교정한 자료 내용은 원본과 확인해야 하며 기계가 확인한 관찰로 승격하지 않아요.",
            ]
          : []),
        "현재 법령 기준의 검토 자료예요. 사건 발생 시점의 적용과 최종 법적 판단은 별도로 확인해야 해요.",
      ]),
    ];
    const metadata = {
      contractVersion: v2ReworkVersionSchema.value,
      id: crypto.randomUUID(),
      basis,
      context: input.context,
      basedOnFactIds: planning.facts.map((f) => f.id),
      includedEvidence: input.includedEvidence,
      asOfDate,
      availability,
      retrievalHash: retrieval.retrievalHash,
    };
    if (!retrieval.chunks.length) {
      const empty = availability.length > 0 && availability.every((a) => a.status === "empty");
      const snapshot = v2LegalAnalysisSnapshotSchema(deps.guideHosts).parse({
        ...metadata,
        checkedAt: clock(),
        status: empty ? "empty" : "unavailable",
        citations: [],
        issues: [],
        precedents: [],
        sourceClaims: [],
        evidenceRequirements: [],
        perspective: {
          casePurpose: input.context.casePurpose,
          weaknesses: [],
          claimGaps: [],
          responsePoints: [],
          additionalMaterials: [
            "사건 요약과 포함 자료를 확인하고 공식 근거를 확보한 뒤 다시 분석해 주세요.",
          ],
        },
        limitations: [
          ...limitations,
          ...(!plans.length
            ? ["제공된 사실에서 조사할 쟁점을 특정하지 못했어요. 사건 내용과 자료를 보완해 주세요."]
            : []),
        ],
      });
      await authorize();
      return { snapshot, sourceRetrieval: retrieval };
    }
    const modelInput: LegalAnalysisModelInput = {
      ...planning,
      plan,
      citations: projection.citations,
      sourceTexts: projection.sourceTexts,
      sourceCoverage: projection.sourceCoverage,
    };
    await authorize();
    const draftParsed = legalAnalysisOutputSchema.safeParse(
      await deps.model.analyze(structuredClone(modelInput)),
    );
    if (!draftParsed.success) throw new LegalAnalysisError("MODEL_SCHEMA_INVALID");
    const draft = draftParsed.data;
    if (
      !analysisDraftGrounded(draft, input, plan, retrieval.chunks) ||
      !instrumentNumbersGrounded(draft, draft.sourceClaims, projection.sourceTexts)
    )
      throw new LegalAnalysisError("POLICY_REJECTED");
    await authorize();
    const auditParsed = legalAnalysisAuditSchema.safeParse(
      await deps.model.audit({
        phase: "legal_analysis",
        context: structuredClone(modelInput),
        draft: structuredClone(draft),
      }),
    );
    if (!auditParsed.success) throw new LegalAnalysisError("MODEL_SCHEMA_INVALID");
    const audit = auditParsed.data;
    if (
      !audit.pass ||
      !audit.legalClaimsSupported ||
      audit.strategyDetected ||
      audit.unsupportedFactIds.length ||
      audit.findings.some((f) => f.severity === "critical")
    )
      throw new LegalAnalysisError("POLICY_REJECTED");
    const reviews = await Promise.all(
      draft.sourceClaims.map(async (claim) => ({
        claimId: claim.id,
        claimHash: await claimReviewHash(claim, asOfDate),
        sourceHash:
          retrieval.chunks.find((c) => c.citation.id === claim.citationId)?.citation.contentHash ??
          "",
        accepted: true,
        policyAccepted: true,
      })),
    );
    const usedIds = new Set(draft.sourceClaims.map((c) => c.citationId));
    const citations = projection.citations.filter((c) => usedIds.has(c.id));
    if (!(await validateV2Claims(draft.sourceClaims, citations, retrieval, reviews)).valid)
      throw new LegalAnalysisError("POLICY_REJECTED");
    await bound(retrieval);
    const complete =
      input.context.casePurpose !== "unconfirmed" &&
      !projection.sourceCoverage.sourcesPartial &&
      availability.every((a) => a.status === "verified") &&
      draft.issues.length > 0 &&
      draft.precedents.length > 0 &&
      draft.precedents.every((p) => p.commonalities.length && p.differences.length);
    const snapshot = v2LegalAnalysisSnapshotSchema(deps.guideHosts).parse({
      ...draft,
      ...metadata,
      citations,
      status: complete ? "ready" : "partial",
      checkedAt: clock(),
      limitations: [...new Set([...draft.limitations, ...limitations])].slice(0, 100),
    });
    await authorize();
    return { snapshot, sourceRetrieval: retrieval };
  }
  let execution: { key: string; promise: Promise<PreparedLegalAnalysis> } | undefined;
  return {
    async prepare(input: LegalAnalysisInput): Promise<PreparedLegalAnalysis> {
      const key = canonicalAnalysisJson(input);
      if (execution && execution.key !== key) throw new LegalAnalysisError("STALE_REVISION");
      execution ??= { key, promise: run(input) };
      const result = await execution.promise;
      // Same-job single flight/replay cannot release stale sources or revoked private data.
      await bound(result.sourceRetrieval);
      return structuredClone(result);
    },
  };
}
