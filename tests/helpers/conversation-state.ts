import {
  type V2ConversationState,
  v2ConversationStateSchema,
  v2ReworkVersionSchema,
} from "../../src/contracts/v2";

export function conversationState(
  casePurpose: V2ConversationState["caseContext"]["casePurpose"] = "prepare_claim",
): V2ConversationState {
  return v2ConversationStateSchema().parse({
    contractVersion: v2ReworkVersionSchema.value,
    workspaceRevision: 8,
    caseContext: {
      casePurpose,
      subjectContext: "individual",
      procedure: { kind: "civil", stage: "before_filing", description: null },
    },
    summaryConfirmed: true,
    pendingEvidenceIds: [],
    analysis: {
      status: "not_started",
      basis: null,
      currentJobId: null,
      missingItems: [],
      failure: null,
    },
    snapshot: null,
    report: {
      status: "not_started",
      id: null,
      revision: null,
      basis: null,
      currentJobId: null,
      failure: null,
    },
    intents: [],
  });
}

/** An honestly limited synthetic analysis: no fabricated legal source or success. */
export function limitedConversationState(
  casePurpose: V2ConversationState["caseContext"]["casePurpose"] = "prepare_claim",
): V2ConversationState {
  const state = conversationState(casePurpose);
  const basis = {
    researchRevision: 7,
    summaryRevision: 2,
    evidenceHash: "a".repeat(64),
    casePurpose,
  };
  state.analysis = {
    status: "unavailable",
    basis,
    currentJobId: null,
    missingItems: ["공식 원문을 확인하지 못했어요. 남은 금액의 반환 약속 날짜는 미확인이에요."],
    failure: null,
  };
  state.snapshot = {
    contractVersion: v2ReworkVersionSchema.value,
    id: "synthetic-analysis",
    basis,
    context: state.caseContext,
    basedOnFactIds: [],
    includedEvidence: [],
    asOfDate: "2026-11-01",
    checkedAt: "2026-11-01T00:00:00.000Z",
    status: "unavailable",
    citations: [],
    retrievalHash: "b".repeat(64),
    availability: [{ kind: "statute", status: "unavailable", reason: null }],
    issues: [],
    precedents: [],
    perspective: {
      casePurpose,
      weaknesses: [],
      claimGaps: ["남은 금액의 반환 약속 날짜"],
      responsePoints: [],
      additionalMaterials: [],
    },
    evidenceRequirements: [],
    sourceClaims: [],
    limitations: state.analysis.missingItems,
  };
  return v2ConversationStateSchema().parse(state);
}
