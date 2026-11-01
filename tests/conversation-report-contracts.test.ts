import { expect, test } from "bun:test";
import {
  CONVERSATION_REPORT_VERSION,
  v2AnalysisBasisSchema,
  v2ConversationActionRequestSchema,
  v2LegalAnalysisSnapshotSchema,
  v2PreparationStateSchema,
  v2ResolutionDraftSchema,
  v2SummaryReconciliationProposalSchema,
  v2SummaryReconciliationSchema,
  v2WorkspaceSchema,
} from "../src/contracts/v2";
import { sourceClaimSchema } from "../src/server/modules/citation/v2-validate";
import { summary, time, workspace } from "./fixtures/contracts/v2";

const hash = "a".repeat(64);
const basis = {
  researchRevision: 1,
  summaryRevision: summary.revision,
  evidenceHash: hash,
  casePurpose: "unconfirmed" as const,
};
const procedure = {
  kind: "unconfirmed" as const,
  stage: "unconfirmed" as const,
  description: null,
};
const unavailable = () => ({
  contractVersion: CONVERSATION_REPORT_VERSION,
  id: "analysis_1",
  basis,
  context: { casePurpose: "unconfirmed", subjectContext: "individual", procedure },
  basedOnFactIds: [],
  includedEvidence: [],
  asOfDate: "2026-11-01",
  checkedAt: time,
  status: "unavailable",
  issues: [],
  precedents: [],
  sourceClaims: [],
  citations: [],
  retrievalHash: hash,
  perspective: {
    casePurpose: "unconfirmed",
    weaknesses: [],
    claimGaps: [],
    responsePoints: [],
    additionalMaterials: [],
  },
  evidenceRequirements: [],
  limitations: ["공식 자료를 확인하지 못했습니다."],
  availability: [{ kind: "statute", status: "unavailable", reason: "configuration_missing" }],
});

test("legacy strict workspace stays unchanged and does not infer a case purpose", () => {
  expect(v2WorkspaceSchema.safeParse(workspace).success).toBe(true);
  expect(v2WorkspaceSchema.safeParse({ ...workspace, casePurpose: "prepare_claim" }).success).toBe(
    false,
  );
  expect(v2AnalysisBasisSchema.parse(basis).casePurpose).toBe("unconfirmed");
});
test("an unavailable search cannot be marked ready or carry fabricated legal claims", () => {
  const schema = v2LegalAnalysisSnapshotSchema();
  expect(schema.safeParse(unavailable()).success).toBe(true);
  expect(schema.safeParse({ ...unavailable(), status: "ready" }).success).toBe(false);
  expect(
    schema.safeParse({
      ...unavailable(),
      sourceClaims: [
        {
          id: "c",
          text: "근거",
          kind: "quotation",
          citationId: "missing",
          startUtf16: 0,
          endUtf16: 2,
        },
      ],
    }).success,
  ).toBe(false);
  expect(
    schema.safeParse({
      ...unavailable(),
      perspective: { ...unavailable().perspective, casePurpose: "respond_to_claim" },
    }).success,
  ).toBe(false);
});
test("existing citation validator uses the same bounded source claim contract", () => {
  const claim = {
    id: "claim",
    text: "원문",
    kind: "quotation",
    citationId: "citation",
    startUtf16: 0,
    endUtf16: 2,
  };
  expect(sourceClaimSchema.safeParse(claim).success).toBe(true);
  expect(sourceClaimSchema.safeParse({ ...claim, endUtf16: 0 }).success).toBe(false);
  expect(sourceClaimSchema.safeParse({ ...claim, url: "https://example.com" }).success).toBe(false);
});
test("a reconciliation proposal preserves its exact base and identifies the next summary", () => {
  const proposal = {
    id: "proposal",
    requestId: "request",
    baseWorkspaceRevision: 2,
    baseIntakeRevision: summary.intakeRevision,
    baseSummaryRevision: summary.revision,
    before: summary,
    after: { ...summary, revision: summary.revision + 1 },
    reasons: ["추가 진술 반영"],
    createdAt: time,
  };
  expect(v2SummaryReconciliationProposalSchema.safeParse(proposal).success).toBe(true);
  expect(
    v2SummaryReconciliationProposalSchema.safeParse({ ...proposal, after: summary }).success,
  ).toBe(false);
  const state = {
    contractVersion: CONVERSATION_REPORT_VERSION,
    workspaceRevision: 3,
    status: "proposed",
    request: {
      id: "request",
      input: {
        expectedRevision: 2,
        summaryRevision: summary.revision,
        kind: "addition",
        explanation: "빠진 내용을 확인해 주세요.",
      },
      createdAt: time,
    },
    proposal,
    currentJobId: null,
    failure: null,
    confirmedSummaryRevision: null,
    confirmedWorkspaceRevision: null,
  };
  expect(v2SummaryReconciliationSchema.safeParse(state).success).toBe(true);
  expect(
    v2SummaryReconciliationSchema.safeParse({
      ...state,
      request: { ...state.request, id: "different" },
    }).success,
  ).toBe(false);
  expect(v2SummaryReconciliationSchema.safeParse({ ...state, status: "confirmed" }).success).toBe(
    false,
  );
});
test("action inputs cannot smuggle arbitrary tools, URLs or stale report choices", () => {
  const request = { requestId: "request", expectedRevision: 1, action: "resolve_followup" };
  expect(v2ConversationActionRequestSchema.safeParse(request).success).toBe(true);
  expect(
    v2ConversationActionRequestSchema.safeParse({ ...request, url: "https://example.com" }).success,
  ).toBe(false);
  expect(
    v2ConversationActionRequestSchema.safeParse({ ...request, action: "run_shell" }).success,
  ).toBe(false);
  expect(
    v2ConversationActionRequestSchema.safeParse({
      ...request,
      action: "save_report",
      reportId: "report",
    }).success,
  ).toBe(false);
});
test("readiness preserves real job and failure boundaries", () => {
  const state = {
    status: "not_started",
    basis: null,
    currentJobId: null,
    missingItems: [],
    failure: null,
  };
  expect(v2PreparationStateSchema.safeParse(state).success).toBe(true);
  expect(v2PreparationStateSchema.safeParse({ ...state, basis }).success).toBe(false);
  expect(v2PreparationStateSchema.safeParse({ ...state, status: "running", basis }).success).toBe(
    false,
  );
  expect(v2PreparationStateSchema.safeParse({ ...state, status: "failed", basis }).success).toBe(
    false,
  );
});
test("a resolution draft fixes scope and cannot be saved without user review", () => {
  const draft = {
    id: "draft",
    revision: 1,
    documentKind: "fact_statement",
    title: "사실 정리 초안",
    content: "확인한 사실만 기재합니다.",
    basis: {
      ...basis,
      workspaceRevision: 1,
      analysisId: "analysis",
      reportId: "report",
      reportRevision: 1,
      procedure,
    },
    selectedFileIds: [],
    maskIdentifiers: true,
    userEdited: false,
    missingFields: ["절차 확인 필요"],
    reviewed: false,
    status: "draft",
    createdAt: time,
    updatedAt: time,
  };
  expect(v2ResolutionDraftSchema.safeParse(draft).success).toBe(true);
  expect(v2ResolutionDraftSchema.safeParse({ ...draft, status: "saved" }).success).toBe(false);
  expect(
    v2ResolutionDraftSchema.safeParse({ ...draft, status: "saved", reviewed: true }).success,
  ).toBe(true);
});
