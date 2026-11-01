import { expect, test } from "bun:test";
import {
  type V2Fact,
  type V2LegalAnalysisSnapshot,
  v2LegalAnalysisSnapshotSchema,
} from "../src/contracts/v2";
import {
  analysisBasis,
  type LegalAnalysisInput,
} from "../src/server/modules/legal-retrieval/analysis/context";
import {
  buildResolutionSource,
  type ResolutionSourceInput,
} from "../src/server/modules/resolution/source-loader";
import { resolutionHarness, resolutionMutation } from "./helpers/resolution-fixture";

function required<T>(value: T | null | undefined): T {
  if (value == null) throw Error("fixture");
  return value;
}

const now = "2026-11-01T12:00:00.000Z";
const ref = {
  kind: "user_material" as const,
  fileId: "file",
  fileRevision: 2,
  position: { kind: "document" as const, page: 1, paragraph: 2, table: null },
};
async function fixture(
  purpose: "prepare_claim" | "respond_to_claim" = "prepare_claim",
): Promise<ResolutionSourceInput> {
  const facts: V2Fact[] = [
    {
      id: "statement",
      text: "합성실명은 수령하지 못했다고 진술했다.",
      attribution: "user_statement",
      certainty: "reported",
      significance: "favorable",
      references: [{ kind: "intake_narrative", intakeRevision: 1 }],
      conflictingFactIds: [],
      userEdited: false,
    },
    {
      id: "material",
      text: "합성실명의 수령 확인 문자가 자료에 있다.",
      attribution: "user_material",
      certainty: "observed",
      significance: "unfavorable",
      references: [ref],
      conflictingFactIds: [],
      userEdited: false,
    },
  ];
  const context = {
    casePurpose: purpose,
    subjectContext: "individual" as const,
    procedure: {
      kind: "civil" as const,
      stage: purpose === "prepare_claim" ? ("before_filing" as const) : ("first_instance" as const),
      description: null,
    },
  };
  const input: LegalAnalysisInput = {
    context,
    confirmedSummary: {
      schemaVersion: "2",
      revision: 3,
      intakeRevision: 1,
      createdAt: now,
      overview: "합성 확인 요약",
      facts: structuredClone(facts),
      parties: [
        { id: "party", label: "합성실명", role: "사용자" },
        { id: "generic", label: "상대방", role: "상대방" },
      ],
      unknowns: ["실제 수령 여부"],
      notices: ["합성 검증"],
    },
    facts: structuredClone(facts),
    includedEvidence: [{ fileId: "file", fileRevision: 2, contentHash: "a".repeat(64) }],
    materials: [
      {
        reference: structuredClone(ref),
        text: "합성실명 010-1234-5678 수령 확인 문자",
        coverage: { observationCertainty: "observed", userEdited: false },
      },
    ],
    researchRevision: 4,
    scope: { excludedFileIds: [], maskIdentifiers: false },
  };
  const currentAnalysis = v2LegalAnalysisSnapshotSchema().parse({
    contractVersion: "conversation-report-v1",
    id: "analysis",
    basis: await analysisBasis(input),
    context,
    basedOnFactIds: facts.map((f) => f.id),
    includedEvidence: input.includedEvidence,
    asOfDate: "2026-11-01",
    checkedAt: now,
    status: "unavailable",
    issues: [],
    precedents: [],
    sourceClaims: [],
    citations: [],
    retrievalHash: "b".repeat(64),
    perspective: {
      casePurpose: purpose,
      weaknesses: [],
      claimGaps: [],
      responsePoints: [],
      additionalMaterials: [],
    },
    evidenceRequirements: [],
    limitations: ["공식 조회 실패를 보존한 합성 snapshot"],
    availability: [{ kind: "statute", status: "unavailable", reason: "configuration_missing" }],
  });
  return {
    input,
    context,
    workspaceRevision: 8,
    currentAnalysis,
    report: {
      id: "report",
      caseId: "case",
      revision: 2,
      title: "합성 리포트",
      content: "이 본문의 임의 주장은 확정 사실 입력으로 사용하지 않는다.",
      updatedAt: now,
      stale: false,
      excludedFileIds: [],
      maskIdentifiers: false,
      basis: { workspaceRevision: 7, summaryRevision: 3, generatedAt: now },
      analysisReview: {
        analysisId: "analysis",
        status: "unavailable",
        userEdited: false,
        checkedAt: now,
      },
    },
    procedureSources: {
      citations: [],
      sourceClaims: [],
      procedureChecks: [],
      documentSupport: [],
      limitations: [],
    },
    fileNames: { file: "합성실명-선택 자료.txt" },
  };
}
async function refresh(args: ResolutionSourceInput) {
  if (!args.currentAnalysis) throw Error("fixture");
  args.currentAnalysis.basis = await analysisBasis(args.input);
  args.currentAnalysis.context = structuredClone(args.input.context);
}
/** Synthetic immutable analysis shape only; no official-source authority is
 * granted by this pure projection fixture. The native integration keeps binding/SQL fences. */
async function statusFixture(
  purpose: "prepare_claim" | "respond_to_claim",
  status: V2LegalAnalysisSnapshot["status"],
  unknown: "none" | "purpose" | "kind" | "stage" = "none",
) {
  const a = await fixture(purpose);
  if (unknown === "purpose") a.context.casePurpose = "unconfirmed";
  if (unknown === "kind") a.context.procedure.kind = "unconfirmed";
  if (unknown === "stage") a.context.procedure.stage = "unconfirmed";
  a.input.context = structuredClone(a.context);
  const snapshot = required(a.currentAnalysis);
  snapshot.status = status;
  snapshot.perspective.casePurpose = a.context.casePurpose;
  snapshot.limitations = ["합성 검증 · 미확인 사건 절차와 실제 원문 확인은 별개입니다."];
  if (status === "ready") {
    snapshot.citations = [
      {
        id: "law",
        sourceId: "law-source",
        kind: "statute",
        officialId: "1706",
        title: "합성 법 조항",
        article: "제1조",
        effectiveDate: "2026-10-01",
        url: "https://law.go.kr/LSW/lsInfoP.do?lsiSeq=284415",
        verifiedAt: now,
        contentHash: "a".repeat(64),
      },
      {
        id: "precedent",
        sourceId: "precedent-source",
        kind: "precedent",
        officialId: "100001",
        title: "합성 판례",
        court: "합성 법원",
        caseNumber: "합성 사건",
        decisionDate: "2026-10-01",
        url: "https://www.law.go.kr/LSW/precInfoP.do?precSeq=100001",
        verifiedAt: now,
        contentHash: "b".repeat(64),
      },
    ];
    snapshot.sourceClaims = [
      {
        id: "law-claim",
        citationId: "law",
        kind: "quotation",
        text: "합성 원문",
        startUtf16: 0,
        endUtf16: 5,
      },
      {
        id: "precedent-claim",
        citationId: "precedent",
        kind: "quotation",
        text: "합성 판례",
        startUtf16: 0,
        endUtf16: 5,
      },
    ];
    snapshot.issues = [
      {
        id: "issue",
        title: "합성 쟁점",
        requirements: [
          {
            id: "requirement",
            label: "합성 요건",
            assessment: "insufficient",
            sourceClaimIds: ["law-claim"],
            factIds: ["statement"],
            conflictingFactIds: [],
            evidence: [],
            gaps: ["현재 절차 확인"],
          },
        ],
      },
    ];
    snapshot.precedents = [
      {
        citationId: "precedent",
        commonalities: [
          { text: "합성 공통점", factIds: ["statement"], sourceClaimIds: ["precedent-claim"] },
        ],
        differences: [
          { text: "합성 차이점", factIds: ["material"], sourceClaimIds: ["precedent-claim"] },
        ],
        preparationMeaning: "자료의 원문을 확인합니다.",
      },
    ];
    snapshot.availability = [
      { kind: "statute", status: "verified", reason: null },
      { kind: "precedent", status: "verified", reason: null },
    ];
  }
  await refresh(a);
  a.currentAnalysis = v2LegalAnalysisSnapshotSchema().parse(snapshot);
  return a;
}

for (const purpose of ["prepare_claim", "respond_to_claim"] as const)
  for (const unknown of ["none", "purpose", "kind", "stage"] as const)
    test(`${purpose}: ready analysis with ${unknown} unconfirmed context requires the exact report display status`, async () => {
      const a = await statusFixture(purpose, "ready", unknown);
      const review = required(required(a.report).analysisReview);
      review.status = unknown === "none" ? "ready" : "partial";
      const source = await buildResolutionSource(a);
      expect(source.basis?.analysisId).toBe("analysis");
      expect(source.analysis?.status).toBe("ready");
      expect(source.analysis?.limitations).toEqual(a.currentAnalysis?.limitations);
      expect(source.documentSupport).toEqual([]);
      expect(source.context).toEqual(a.input.context);
      const h = resolutionHarness({ ...source, stored: null });
      let state = await h.service.get("owner", "case");
      expect(state.status).toBe("active");
      expect(state.allowedDocumentKinds).toEqual(["fact_statement"]);
      state = await h.service.update("owner", "case", {
        ...resolutionMutation(state),
        action: "select",
        choice: "self",
        selectedFileIds: state.selectedFileIds,
        maskIdentifiers: state.maskIdentifiers,
      });
      state = await h.service.prepareDraft("owner", "case", {
        ...resolutionMutation(state),
        documentKind: "fact_statement",
        selectedFileIds: state.selectedFileIds,
        maskIdentifiers: state.maskIdentifiers,
        factsConfirmed: true,
      });
      expect(state.draft?.content).toContain("[미입력: 관할]");
      expect(state.draft?.content).toContain("[미입력: 제출 기한]");
      for (const mismatched of [
        "ready",
        "partial",
        "empty",
        "unavailable",
        "review_required",
      ] as const) {
        if (mismatched === (unknown === "none" ? "ready" : "partial")) continue;
        review.status = mismatched;
        expect((await buildResolutionSource(a)).basis).toBeNull();
      }
    });

for (const status of ["partial", "empty", "unavailable"] as const)
  test(`a genuinely ${status} analysis keeps its own status with confirmed or unconfirmed procedure`, async () => {
    for (const unknown of ["none", "kind"] as const) {
      const a = await statusFixture("respond_to_claim", status, unknown);
      const review = required(required(a.report).analysisReview);
      for (const display of [
        "ready",
        "partial",
        "empty",
        "unavailable",
        "review_required",
      ] as const) {
        review.status = display;
        const source = await buildResolutionSource(a);
        expect(source.basis !== null).toBe(display === status);
        if (display === status) {
          expect(source.analysis?.status).toBe(status);
          expect(source.analysis?.limitations).toEqual(a.currentAnalysis?.limitations);
        }
      }
    }
  });

test("the allowed ready-to-partial display never bypasses identity, current basis, scope, review or confirmed facts", async () => {
  const mutations: ((a: ResolutionSourceInput) => void)[] = [
    (a) => {
      required(required(a.report).analysisReview).analysisId = "other-analysis";
    },
    (a) => {
      required(required(a.report).analysisReview).checkedAt = "2026-10-31T12:00:00.000Z";
    },
    (a) => {
      required(required(a.report).analysisReview).userEdited = true;
    },
    (a) => {
      required(a.report).stale = true;
    },
    (a) => {
      required(required(a.report).basis).summaryRevision++;
    },
    (a) => {
      a.input.researchRevision++;
    },
    (a) => {
      a.input.scope.excludedFileIds.push("file");
    },
    (a) => {
      required(a.input.facts[0]).text = "아직 확인하지 않은 새로운 설명";
    },
    (a) => {
      required(a.report).maskIdentifiers = true;
    },
  ];
  for (const mutate of mutations) {
    const a = await statusFixture("prepare_claim", "ready", "kind");
    required(required(a.report).analysisReview).status = "partial";
    mutate(a);
    const source = await buildResolutionSource(a);
    expect(source.basis).toBeNull();
    expect(source.analysis).toBeNull();
    expect(source.documentSupport).toEqual([]);
  }
});

for (const purpose of ["prepare_claim", "respond_to_claim"] as const)
  test(`${purpose}: valid unavailable snapshot still permits an honest fact draft with exact basis`, async () => {
    const args = await fixture(purpose);
    const original = JSON.stringify(args);
    const source = await buildResolutionSource(args);
    expect(source.basis).toMatchObject({
      workspaceRevision: 8,
      researchRevision: 4,
      summaryRevision: 3,
      analysisId: "analysis",
      reportId: "report",
      reportRevision: 2,
    });
    expect(source.files[0]).toMatchObject({ id: "file", revision: 2, contentHash: "a".repeat(64) });
    expect(source.facts.find((f) => f.id === "material")?.text).toContain("원문 대조 필요");
    expect(source.facts.map((f) => f.text).join(" ")).not.toContain("임의 주장");
    expect(JSON.stringify(args)).toBe(original);
    const h = resolutionHarness({ ...source, stored: null });
    let state = await h.service.get("owner", "case");
    state = await h.service.update("owner", "case", {
      ...resolutionMutation(state),
      action: "select",
      choice: "self",
      selectedFileIds: state.selectedFileIds,
      maskIdentifiers: false,
    });
    state = await h.service.prepareDraft("owner", "case", {
      ...resolutionMutation(state),
      documentKind: "fact_statement",
      selectedFileIds: state.selectedFileIds,
      maskIdentifiers: false,
      factsConfirmed: true,
    });
    expect(state.draft?.content).toContain("[미입력: 관할]");
    expect(source.analysis?.limitations).toEqual(args.currentAnalysis?.limitations);
    expect(state.allowedDocumentKinds).toEqual(["fact_statement"]);
  });
test("missing/stale/legacy/edited/wrong-identity report or analysis cannot establish a current basis", async () => {
  const mutations: ((a: ResolutionSourceInput) => void)[] = [
    (a) => {
      a.currentAnalysis = null;
    },
    (a) => {
      a.report = null;
    },
    (a) => {
      a.report = { ...required(a.report), stale: true };
    },
    (a) => {
      a.report = { ...required(a.report), analysisReview: undefined };
    },
    (a) => {
      a.report = { ...required(a.report), basis: undefined };
    },
    (a) => {
      a.report = {
        ...required(a.report),
        basis: { ...required(required(a.report).basis), workspaceRevision: 99 },
      };
    },
    (a) => {
      a.report = {
        ...required(a.report),
        analysisReview: { ...required(required(a.report).analysisReview), analysisId: "other" },
      };
    },
    (a) => {
      a.report = {
        ...required(a.report),
        analysisReview: {
          ...required(required(a.report).analysisReview),
          userEdited: true,
          status: "review_required",
        },
      };
    },
    (a) => {
      a.report = {
        ...required(a.report),
        analysisReview: {
          ...required(required(a.report).analysisReview),
          checkedAt: "2026-10-31T12:00:00.000Z",
        },
      };
    },
    (a) => {
      a.input.researchRevision++;
    },
    (a) => {
      a.input.confirmedSummary.revision++;
    },
    (a) => {
      a.context = { ...a.context, casePurpose: "respond_to_claim" };
    },
    (a) => {
      a.report = { ...required(a.report), maskIdentifiers: true };
    },
    (a) => {
      a.report = { ...required(a.report), excludedFileIds: ["file"] };
    },
  ];
  for (const mutate of mutations) {
    const a = await fixture();
    mutate(a);
    const result = await buildResolutionSource(a);
    expect(result.basis).toBeNull();
    expect(result.analysis).toBeNull();
    expect(result.documentSupport).toEqual([]);
  }
});
test("same file bytes cannot conceal observation certainty, correction, reference, hash or scope changes", async () => {
  for (const change of ["coverage", "corrected", "hash", "reference", "scope"] as const) {
    const a = await fixture();
    if (change === "coverage")
      required(a.input.materials[0]).coverage = {
        observationCertainty: "uncertain",
        userEdited: false,
      };
    if (change === "corrected")
      required(a.input.materials[0]).coverage = {
        observationCertainty: "uncertain",
        userEdited: true,
      };
    if (change === "hash") required(a.input.includedEvidence[0]).contentHash = "c".repeat(64);
    if (change === "reference") required(a.input.materials[0]).reference.fileRevision++;
    if (change === "scope") a.input.scope.excludedFileIds.push("file");
    expect((await buildResolutionSource(a)).basis).toBeNull();
  }
});
test("uncertain/edited/unknown observations remain qualified and retain adverse facts and exact locations", async () => {
  for (const coverage of [
    undefined,
    { observationCertainty: "uncertain" as const, userEdited: false },
    { observationCertainty: "uncertain" as const, userEdited: true },
  ]) {
    const a = await fixture();
    if (coverage) required(a.input.materials[0]).coverage = coverage;
    else delete required(a.input.materials[0]).coverage;
    await refresh(a);
    const result = await buildResolutionSource(a);
    expect(result.basis).not.toBeNull();
    expect(result.files[0]?.text).toContain("문서 1쪽 2문단");
    expect(result.files[0]?.text).toContain("원문 대조 필요");
    expect(result.facts.find((f) => f.id === "material")?.text).toContain("수령 확인 문자");
    expect(result.facts.find((f) => f.id === "statement")?.text).toContain("독립 사실 확정 아님");
  }
});
test("only matching confirmed summary assertions are confirmed; exclusions retain no dependent conflict assertions", async () => {
  const a = await fixture();
  a.input.facts[0] = {
    ...required(a.input.facts[0]),
    text: "확정 요약과 다른 아직 확인하지 않은 설명",
  };
  await refresh(a);
  const mismatch = await buildResolutionSource(a);
  expect(mismatch.basis).toBeNull();
  expect(mismatch.facts.find((f) => f.id === "statement")?.confirmed).toBe(false);
  const b = await fixture();
  for (const f of b.input.confirmedSummary.facts) {
    f.certainty = "conflicting";
    f.conflictingFactIds = [f.id === "statement" ? "material" : "statement"];
  }
  const included = await buildResolutionSource(b);
  expect(included.facts.every((f) => f.fileIds.includes("file"))).toBe(true);
  b.report = { ...required(b.report), excludedFileIds: ["file"] };
  const excluded = await buildResolutionSource(b);
  expect(excluded.files).toEqual([]);
  expect(excluded.facts).toEqual([]);
});
test("trusted names and identifiers are masked; generic and placeholder labels never become masking tokens", async () => {
  const a = await fixture();
  a.maskingTokens = ["원래실명", "김가림", "사용자", "상대방", "당사자 2", "[당사자 가림]"];
  a.input.scope.maskIdentifiers = true;
  a.report = { ...required(a.report), maskIdentifiers: true };
  await refresh(a);
  const result = await buildResolutionSource(a);
  expect(result.basis).not.toBeNull();
  expect(result.maskingTokens).toEqual(["원래실명", "김가림", "합성실명"]);
  expect(JSON.stringify(result.files)).not.toContain("합성실명");
  expect(JSON.stringify(result.files)).not.toContain("010-1234-5678");
  expect(JSON.stringify(result.facts)).not.toContain("합성실명");
  delete a.fileNames;
  a.input.confirmedSummary.parties = [{ id: "generic", label: "사용자", role: "사용자" }];
  a.maskingTokens = [];
  await refresh(a);
  const fallback = await buildResolutionSource(a);
  expect(fallback.files[0]?.name).toBe("선택 자료 file");
  expect(fallback.procedureChecks.map((c) => c.id)).toContain("resolution-masking");
  expect(fallback.procedureChecks.map((c) => c.id)).toContain("resolution-file-names");
});
test("metadata workspace revisions do not invalidate the exact semantic basis", async () => {
  const a = await fixture();
  a.workspaceRevision = 12;
  expect((await buildResolutionSource(a)).basis?.workspaceRevision).toBe(12);
});
test("masked procedure description must match the authoritative context without guessing missing names", async () => {
  const a = await fixture();
  a.context = {
    ...a.context,
    procedure: { ...a.context.procedure, description: "합성실명 관련 절차" },
  };
  a.input.context = {
    ...a.input.context,
    procedure: { ...a.input.context.procedure, description: "[당사자 가림] 관련 절차" },
  };
  a.input.scope.maskIdentifiers = true;
  a.input.confirmedSummary.parties = [{ id: "masked", label: "[당사자 가림]", role: "사용자" }];
  a.maskingTokens = ["합성실명"];
  a.report = { ...required(a.report), maskIdentifiers: true };
  await refresh(a);
  const result = await buildResolutionSource(a);
  expect(result.basis?.procedure.description).toBe("[당사자 가림] 관련 절차");
  expect(result.context.procedure.description).not.toContain("합성실명");
  a.maskingTokens = [];
  expect((await buildResolutionSource(a)).basis).toBeNull();
});
test("fresh procedure identities are preserved; limitations, missing basis or conflicting proof remove formal support", async () => {
  const a = await fixture();
  // This stands for root's independently validated result, not a live source success.
  a.procedureSources = {
    citations: [
      {
        id: "guide",
        sourceId: "guide-source",
        kind: "official_guide",
        title: "합성 안내",
        contentHash: "d".repeat(64),
        verifiedAt: now,
        url: "https://www.easylaw.go.kr/CSP/CnpClsMain.laf?csmSeq=568&ccfNo=4&cciNo=1&cnpClsNo=1",
        institutionId: "moleg_easylaw",
        endpointId: "easylaw_text_section",
        section: "합성",
        publishedDate: "2026-10-15",
      },
    ],
    sourceClaims: [
      {
        id: "guide-claim",
        citationId: "guide",
        kind: "quotation",
        text: "합성 안내",
        startUtf16: 3,
        endUtf16: 8,
      },
    ],
    procedureChecks: [
      {
        id: "guide-check",
        label: "합성 안내",
        detail: "합성 안내",
        status: "verified",
        sourceClaimIds: ["guide-claim"],
      },
    ],
    documentSupport: [{ documentKind: "civil_claim", sourceClaimIds: ["guide-claim"] }],
    limitations: [],
  };
  const result = await buildResolutionSource(a);
  expect(result.citations).toEqual(a.procedureSources.citations);
  expect(result.sourceClaims).toEqual(a.procedureSources.sourceClaims);
  expect(result.procedureChecks).toEqual(a.procedureSources.procedureChecks);
  expect(result.documentSupport).toEqual(a.procedureSources.documentSupport);
  a.procedureSources.documentSupport = [
    { documentKind: "appeal", sourceClaimIds: ["guide-claim"] },
  ];
  expect((await buildResolutionSource(a)).documentSupport).toEqual([]);
  a.procedureSources.documentSupport = [
    { documentKind: "civil_claim", sourceClaimIds: ["guide-claim"] },
  ];
  a.procedureSources.limitations = [
    { id: "pending", reason: "update_pending", action: "개정 확인", url: null, checkedAt: now },
  ];
  expect((await buildResolutionSource(a)).documentSupport).toEqual([]);
  a.procedureSources.limitations = [];
  a.report = null;
  expect((await buildResolutionSource(a)).documentSupport).toEqual([]);
  required(a.procedureSources.sourceClaims[0]).citationId = "missing";
  const invalid = await buildResolutionSource(a);
  expect(invalid.documentSupport).toEqual([]);
  expect(invalid.sourceClaims).toEqual([]);
});
