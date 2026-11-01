import { expect, test } from "bun:test";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { v2FactSchema } from "../src/contracts/v2";
import type { V2LegalAnalysisDraft } from "../src/contracts/v2/legal-analysis";
import type { V2CasePurpose } from "../src/contracts/v2/rework";
import {
  analysisBasis,
  analysisMaterialIsObserved,
  isAnalysisCurrent,
  type LegalAnalysisInput,
  legalAnalysisInputSchema,
} from "../src/server/modules/legal-retrieval/analysis/context";
import { analysisPrecedentDiscovery } from "../src/server/modules/legal-retrieval/analysis/discovery";
import {
  createAutomaticLegalAnalysis,
  type LegalAnalysisModelInput,
} from "../src/server/modules/legal-retrieval/analysis/service";
import type { Transport } from "../src/server/modules/legal-retrieval/v2/transport";
import {
  legalAnalysisOutputSchema,
  legalAnalysisPlanSchema,
} from "../src/server/modules/llm-gateway/analysis-schema";
import sample from "./fixtures/legal/analysis/scenarios.json";
import { legalAnalysisFixture } from "./helpers/legal-analysis-fixture";

const now = "2026-10-06T00:00:00.000Z";
const material = {
  kind: "user_material" as const,
  fileId: "included_transfer",
  fileRevision: 2,
  position: { kind: "document" as const, page: 1, paragraph: 1, table: null },
};
const plan = () => ({
  issues: [
    {
      id: "loan_issue",
      title: "대여 약정과 교부·변제 자료 확인",
      factIds: ["loan_promise", "transfer"],
      requests: [
        { kind: "statute", lawTitle: "민법", articles: [{ number: "598", branch: "0" }] },
        { kind: "precedent", concept: "대여금" },
      ],
    },
  ],
});
const approved = {
  pass: true,
  findings: [],
  unsupportedFactIds: [],
  legalClaimsSupported: true,
  strategyDetected: false,
};

function draftFor(input: LegalAnalysisModelInput): V2LegalAnalysisDraft {
  const law = input.citations.find((c) => c.kind === "statute");
  const precedent = input.citations.find((c) => c.kind === "precedent");
  const sourceClaims: V2LegalAnalysisDraft["sourceClaims"] = [];
  if (law)
    sourceClaims.push({
      id: "law_claim",
      kind: "legal_explanation",
      citationId: law.id,
      text: "합성 검증 조문은 대여 약정과 교부 사실을 구분해 확인하도록 제시합니다.",
      startUtf16: 0,
      endUtf16: input.sourceTexts.find((s) => s.citationId === law.id)?.text.length ?? 1,
    });
  const quote = (id: string, text: string) => {
    if (!precedent) throw new Error("Missing synthetic original");
    const original = input.sourceTexts.find((s) => s.citationId === precedent.id)?.text ?? "";
    const start = original.indexOf(text);
    sourceClaims.push({
      id,
      kind: "quotation",
      citationId: precedent.id,
      text,
      startUtf16: start,
      endUtf16: start + text.length,
    });
  };
  if (precedent) {
    quote("precedent_records", "당사자들은 서면 차용증을 작성했고 송금 기록을 제출했다.");
    quote("precedent_return", "지급 이후 일부 변제가 있었다.");
  }
  const purpose = input.context.casePurpose;
  return {
    issues: law
      ? [
          {
            id: "loan_issue",
            title: plan().issues[0]?.title ?? "합성 쟁점",
            requirements: [
              {
                id: "loan_requirement",
                label:
                  "합성 조문이 구분하는 약정에는 문자의 반환 약속 진술이, 교부에는 송금 자료의 기록이 대응하지만 일부 반환 내역은 아직 확인되지 않았습니다.",
                assessment: "insufficient",
                sourceClaimIds: ["law_claim"],
                factIds: ["loan_promise", "transfer"],
                conflictingFactIds: [],
                evidence: [material],
                gaps: ["일부 반환 설명을 뒷받침하는 실제 자료가 아직 없습니다."],
              },
            ],
          },
        ]
      : [],
    precedents: precedent
      ? [
          {
            citationId: precedent.id,
            commonalities: [
              {
                text: sample.expected.commonality,
                factIds: ["loan_promise", "transfer"],
                sourceClaimIds: ["precedent_records"],
              },
            ],
            differences: [
              {
                text: sample.expected.difference,
                factIds: ["loan_promise", "return_unknown"],
                sourceClaimIds: ["precedent_return"],
              },
            ],
            preparationMeaning: "문자 약속과 실제 교부·반환 내역을 구분해 확인할 필요가 있습니다.",
          },
        ]
      : [],
    perspective: {
      casePurpose: purpose,
      weaknesses: [
        purpose === "respond_to_claim"
          ? "일부 반환 설명에 대응하는 자료가 아직 없습니다."
          : "문자 약속의 범위와 반환 내역이 불분명합니다.",
      ],
      claimGaps: purpose === "prepare_claim" ? [sample.expected.claimGap] : [],
      responsePoints:
        purpose === "respond_to_claim"
          ? [
              {
                opponentPosition: "대여 약정과 미반환을 주장할 가능성이 있어 확인이 필요합니다.",
                ourExplanation: sample.expected.defenseGap,
                conflictingFactIds: [],
                sourceClaimIds: law ? ["law_claim"] : [],
                additionalMaterials: ["일부 반환을 확인할 송금 자료"],
              },
            ]
          : [],
      additionalMaterials: ["문자 전체 대화와 실제 반환 내역을 확인할 자료"],
    },
    evidenceRequirements: [
      {
        id: "return_records",
        kind: "receipt",
        label: "일부 반환 자료",
        reason: "이미 반환한 금액과 남은 주장을 구분하기 위해 필요합니다.",
        fileIds: [],
      },
    ],
    sourceClaims,
    limitations: [
      "합성 공식 응답과 대역 모델의 검증이며 실제 법률 적용이나 모델 품질 인수가 아닙니다.",
    ],
  };
}
async function setup(
  purpose: V2CasePurpose = "prepare_claim",
  options: {
    transport?: (f: Awaited<ReturnType<typeof legalAnalysisFixture>>) => Transport;
    draft?: (draft: V2LegalAnalysisDraft, input: LegalAnalysisModelInput) => void;
    audit?: () => unknown;
    noBinding?: boolean;
    plan?: () => unknown;
  } = {},
) {
  const f = await legalAnalysisFixture();
  const facts = sample.facts.map((row) =>
    v2FactSchema.parse({
      ...row,
      attribution: row.id === "transfer" ? "user_material" : "user_statement",
      significance: row.id === "return_unknown" ? "unfavorable" : "neutral",
      references:
        row.id === "transfer" ? [material] : [{ kind: "intake_narrative", intakeRevision: 1 }],
      conflictingFactIds: [],
      userEdited: false,
    }),
  );
  const input: LegalAnalysisInput = {
    context: {
      casePurpose: purpose,
      subjectContext: "individual",
      procedure: { kind: "civil", stage: "before_filing", description: null },
    },
    confirmedSummary: {
      schemaVersion: "2",
      revision: 1,
      intakeRevision: 1,
      createdAt: now,
      overview: "합성 대여금 약정과 송금, 미확인 일부 변제 설명",
      facts,
      parties: [],
      unknowns: ["일부 반환 내역"],
      notices: ["합성 검증"],
    },
    facts,
    includedEvidence: [
      { fileId: material.fileId, fileRevision: material.fileRevision, contentHash: "c".repeat(64) },
    ],
    materials: [{ reference: material, text: facts[1]?.text ?? "합성 송금 기록" }],
    researchRevision: 1,
    scope: { excludedFileIds: [], maskIdentifiers: false },
  };
  const counts = { plan: 0, analyze: 0, audit: 0, attempts: 0 };
  let time = now;
  const retrieval = f.service(
    options.transport?.(f),
    !options.noBinding,
    analysisPrecedentDiscovery(input),
  );
  const controller = new AbortController();
  const service = createAutomaticLegalAnalysis({
    model: {
      plan: async () => {
        counts.plan++;
        return (options.plan ?? plan)();
      },
      analyze: async (context) => {
        counts.analyze++;
        const draft = draftFor(context);
        options.draft?.(draft, context);
        return draft;
      },
      audit: async () => {
        counts.audit++;
        return (options.audit ?? (() => approved))();
      },
    },
    retrieve: (request, access) => retrieval.retrieve(request, access),
    readBoundSources: async (ids, at) => {
      f.guard.now = at;
      return f.bound(ids);
    },
    authorize: f.access.authorize,
    reserveRequest: async (attempt) => {
      counts.attempts++;
      return f.access.reserveRequest(attempt);
    },
    clock: () => time,
    signal: controller.signal,
  });
  return {
    ...f,
    input,
    service,
    counts,
    controller,
    setTime: (value: string) => {
      time = value;
    },
  };
}

test.each(["prepare_claim", "respond_to_claim", "unconfirmed"] as const)(
  "automatic %s analysis binds statute requirements, concrete analogy and distinct perspective",
  async (purpose) => {
    const f = await setup(purpose);
    try {
      const { snapshot } = await f.service.prepare(f.input);
      expect(snapshot.status).toBe(purpose === "unconfirmed" ? "partial" : "ready");
      if (purpose === "unconfirmed")
        expect(snapshot.limitations.some((text) => text.includes("입장별 분석"))).toBe(true);
      expect(snapshot.citations.map((c) => c.kind)).toEqual(["statute", "precedent"]);
      expect(snapshot.citations[0]).toMatchObject({ title: "민법", article: "제598조" });
      expect(snapshot.citations[1]).toMatchObject({
        caseNumber: sample.precedent.caseNumber,
        court: sample.precedent.court,
        decisionDate: sample.precedent.decisionDate,
        url: `https://www.law.go.kr/LSW/precInfoP.do?precSeq=${sample.precedent.officialId}`,
      });
      expect(snapshot.issues[0]?.requirements[0]).toMatchObject({
        assessment: "insufficient",
        factIds: ["loan_promise", "transfer"],
        evidence: [material],
      });
      expect(snapshot.precedents[0]?.commonalities[0]?.text).toBe(sample.expected.commonality);
      expect(snapshot.precedents[0]?.differences[0]?.text).toBe(sample.expected.difference);
      expect(snapshot.perspective.claimGaps.length > 0).toBe(purpose === "prepare_claim");
      expect(snapshot.perspective.responsePoints.length > 0).toBe(purpose === "respond_to_claim");
      expect(f.counts).toEqual({ plan: 1, analyze: 1, audit: 1, attempts: 4 });
      expect(f.calls.every((c) => c.query !== "형법")).toBe(true);
    } finally {
      f.db.close();
    }
  },
);

test("same-job concurrent calls and replay reuse results; mutation, expiry and revocation cannot release them", async () => {
  const f = await setup();
  try {
    const [a, b] = await Promise.all([f.service.prepare(f.input), f.service.prepare(f.input)]);
    expect(a.snapshot.id).toBe(b.snapshot.id);
    a.snapshot.perspective.weaknesses[0] = "caller mutation";
    expect((await f.service.prepare(f.input)).snapshot.perspective.weaknesses[0]).not.toBe(
      "caller mutation",
    );
    expect(f.counts).toEqual({ plan: 1, analyze: 1, audit: 1, attempts: 4 });
    const changed = structuredClone(f.input);
    changed.scope.maskIdentifiers = true;
    await expect(f.service.prepare(changed)).rejects.toMatchObject({ code: "STALE_REVISION" });
    f.setTime("2026-10-07T00:00:00.001Z");
    await expect(f.service.prepare(f.input)).rejects.toMatchObject({ code: "SOURCE_UNAVAILABLE" });
    f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.owner.userId);
    await expect(f.service.prepare(f.input)).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
    expect(f.counts.plan).toBe(1);
  } finally {
    f.db.close();
  }
});

test.each([
  { name: "missing", coverage: undefined, supported: false },
  {
    name: "uncertain",
    coverage: { observationCertainty: "uncertain", userEdited: false },
    supported: false,
  },
  {
    name: "corrected",
    coverage: { observationCertainty: "uncertain", userEdited: true },
    supported: false,
  },
  {
    name: "incorrectly observed correction",
    coverage: { observationCertainty: "observed", userEdited: true },
    supported: false,
  },
  {
    name: "observed unchanged",
    coverage: { observationCertainty: "observed", userEdited: false },
    supported: true,
  },
] as const)(
  "%s material alone cannot be promoted through an observed-labelled fact",
  async ({ coverage, supported }) => {
    const f = await setup("prepare_claim", {
      draft: (draft) => {
        const requirement = draft.issues[0]?.requirements[0];
        if (!requirement) throw new Error("Missing synthetic requirement");
        requirement.assessment = "supported";
        requirement.factIds = ["transfer"];
        requirement.gaps = [];
        requirement.label =
          "합성 조문의 교부 확인 항목에는 송금 자료에 기록된 지급 내역이 대응하며 실제 사건 발생과 원본 진정성은 별도 확인이 필요합니다.";
      },
    });
    try {
      const observation = f.input.materials[0];
      if (!observation) throw new Error("Missing synthetic observation");
      if (coverage) observation.coverage = { ...coverage };
      else delete observation.coverage;
      expect(analysisMaterialIsObserved(observation)).toBe(supported);
      if (supported)
        expect(
          (await f.service.prepare(f.input)).snapshot.issues[0]?.requirements[0]?.assessment,
        ).toBe("supported");
      else {
        await expect(f.service.prepare(f.input)).rejects.toMatchObject({ code: "POLICY_REJECTED" });
        expect(f.counts.audit).toBe(0); // A permissive fake auditor cannot bypass structural grounding.
      }
    } finally {
      f.db.close();
    }
  },
);

test("uncertain supplemental material does not erase an independent qualified user statement", async () => {
  const f = await setup("prepare_claim", {
    draft: (draft) => {
      const requirement = draft.issues[0]?.requirements[0];
      if (!requirement) throw new Error("Missing synthetic requirement");
      requirement.assessment = "supported";
      requirement.factIds = ["loan_promise"];
      requirement.gaps = [];
      requirement.label =
        "사용자는 문자로 반환 약속을 주고받았다고 진술했어요. 교정된 송금 자료는 확인 전이며 이 진술을 확정하지 않아요.";
    },
  });
  try {
    const observation = f.input.materials[0];
    if (!observation) throw new Error("Missing synthetic observation");
    observation.coverage = { observationCertainty: "uncertain", userEdited: true };
    const result = await f.service.prepare(f.input);
    expect(result.snapshot.issues[0]?.requirements[0]?.assessment).toBe("supported");
    expect(result.snapshot.limitations.some((text) => text.includes("사용자가 교정"))).toBe(true);
    expect(result.snapshot.limitations.some((text) => text.includes("불확실하게"))).toBe(true);
    expect(f.input.facts.find((fact) => fact.id === "loan_promise")?.certainty).toBe("reported");
  } finally {
    f.db.close();
  }
});

test("an existing verified current fact outside the observation window remains independently usable", async () => {
  const f = await setup("prepare_claim", {
    draft: (draft) => {
      const requirement = draft.issues[0]?.requirements[0];
      if (!requirement) throw new Error("Missing synthetic requirement");
      requirement.assessment = "supported";
      requirement.factIds = ["transfer"];
      requirement.gaps = [];
      requirement.label =
        "현재 저장된 사실에는 송금 자료의 기록이 관찰되어 있어요. 사건 발생 및 원본 진정성 판단은 별도예요.";
    },
  });
  try {
    f.input.materials = [];
    const result = await f.service.prepare(f.input);
    expect(result.snapshot.issues[0]?.requirements[0]?.assessment).toBe("supported");
    expect(f.input.facts.find((fact) => fact.id === "transfer")?.certainty).toBe("observed");
  } finally {
    f.db.close();
  }
});

test("coverage certainty/edit changes invalidate identical text/revision, and old omitted coverage stays unknown", async () => {
  const f = await setup();
  try {
    const observation = f.input.materials[0];
    if (!observation) throw new Error("Missing synthetic observation");
    expect(legalAnalysisInputSchema.parse(f.input).materials[0]).not.toHaveProperty("coverage");
    const unknown = await f.service.prepare(f.input);
    expect(
      unknown.snapshot.limitations.some((text) =>
        text.includes("관찰·교정 상태를 확인하지 못했어요"),
      ),
    ).toBe(true);
    const explicitUnknown = structuredClone(f.input);
    Object.assign(explicitUnknown.materials[0] ?? {}, { coverage: undefined });
    expect((await analysisBasis(explicitUnknown)).evidenceHash).toBe(
      unknown.snapshot.basis.evidenceHash,
    );
    expect((await f.service.prepare(explicitUnknown)).snapshot.id).toBe(unknown.snapshot.id);
    const observed = structuredClone(f.input);
    if (!observed.materials[0]) throw new Error("Missing synthetic observation");
    observed.materials[0].coverage = { observationCertainty: "observed", userEdited: false };
    expect(await isAnalysisCurrent(unknown.snapshot, observed)).toBe(false);
    const before = await analysisBasis(observed);
    observed.materials[0].coverage.observationCertainty = "uncertain";
    expect((await analysisBasis(observed)).evidenceHash).not.toBe(before.evidenceHash);
    const uncertain = await analysisBasis(observed);
    observed.materials[0].coverage.userEdited = true;
    expect((await analysisBasis(observed)).evidenceHash).not.toBe(uncertain.evidenceHash);
    const invalid = structuredClone(observed);
    Object.assign(invalid.materials[0]?.coverage ?? {}, { observationCertainty: "verified" });
    expect(legalAnalysisInputSchema.safeParse(invalid).success).toBe(false);
  } finally {
    f.db.close();
  }
});

test.each([
  "purpose",
  "summary",
  "fact",
  "evidence",
  "observation",
  "scope",
  "procedure",
  "revision",
])(
  "%s changes invalidate the snapshot basis while stable comparisons/order do not",
  async (change) => {
    const f = await setup();
    try {
      const { snapshot } = await f.service.prepare(f.input);
      const reordered = structuredClone(f.input);
      reordered.facts.reverse();
      reordered.confirmedSummary.facts.reverse();
      expect(await isAnalysisCurrent(snapshot, reordered)).toBe(true);
      const next = structuredClone(f.input);
      if (change === "purpose") next.context.casePurpose = "respond_to_claim";
      if (change === "summary") next.confirmedSummary.revision++;
      if (change === "fact" && next.facts[0]) next.facts[0].text += " 추가 사실";
      if (change === "evidence" && next.includedEvidence[0])
        next.includedEvidence[0].fileRevision++;
      if (change === "observation" && next.materials[0]) next.materials[0].text += " 교정";
      if (change === "scope") next.scope.maskIdentifiers = true;
      if (change === "procedure") next.context.procedure.stage = "appeal";
      if (change === "revision") next.researchRevision++;
      expect(await isAnalysisCurrent(snapshot, next)).toBe(false);
      expect(snapshot.basis).toEqual(await analysisBasis(f.input));
    } finally {
      f.db.close();
    }
  },
);

test.each(["all_empty", "original_failure", "partial", "provider_rejected", "unrelated"])(
  "%s is distinct, preserves available authority and never fills missing legal content",
  async (mode) => {
    const f = await setup("prepare_claim", {
      transport: (base) => async (url, init) => {
        const u = new URL(url),
          prec = u.searchParams.get("target") === "prec",
          detail = u.pathname.endsWith("lawService.do");
        if (mode === "all_empty")
          return Response.json(
            prec
              ? { PrecSearch: { totalCnt: 0, prec: [] } }
              : { LawSearch: { totalCnt: 0, law: [] } },
          );
        if (prec && mode === "partial")
          return Response.json({ PrecSearch: { totalCnt: 0, prec: [] } });
        if (mode === "provider_rejected")
          return Response.json({ result: "failure", msg: "synthetic rejection" });
        if (prec && detail && mode === "original_failure")
          return Response.json({ PrecService: {} });
        const response = await base.transport(url, init);
        if (prec && mode === "unrelated") {
          const body = (await response.json()) as {
            PrecSearch?: { prec: { 사건명: string }[] };
            PrecService?: { 사건명: string; 판례내용: string };
          };
          if (body.PrecSearch?.prec[0])
            body.PrecSearch.prec[0].사건명 = sample.unrelatedPrecedent.title;
          if (body.PrecService) {
            body.PrecService.사건명 = sample.unrelatedPrecedent.title;
            body.PrecService.판례내용 = sample.unrelatedPrecedent.body;
          }
          return Response.json(body);
        }
        return response;
      },
    });
    try {
      const { snapshot } = await f.service.prepare(f.input);
      expect(snapshot.status).toBe(
        mode === "all_empty" ? "empty" : mode === "provider_rejected" ? "unavailable" : "partial",
      );
      expect(snapshot.precedents).toEqual([]);
      expect(
        snapshot.availability.some(
          (a) =>
            a.reason ===
            (mode === "original_failure"
              ? "schema_mismatch"
              : mode === "provider_rejected"
                ? "upstream_rejected"
                : "no_results"),
        ),
      ).toBe(true);
      if (mode === "all_empty" || mode === "provider_rejected") {
        expect(snapshot.issues).toEqual([]);
        expect(snapshot.sourceClaims).toEqual([]);
        expect(f.counts.analyze).toBe(0);
        expect(f.counts.audit).toBe(0);
      } else expect(snapshot.issues[0]?.requirements[0]?.sourceClaimIds).toEqual(["law_claim"]);
    } finally {
      f.db.close();
    }
  },
);

test.each([
  "quote",
  "fact",
  "wrong_kind",
  "uncertainty",
  "position",
  "perspective",
  "audit",
  "binding",
])("%s tampering fails despite superficially valid source cards", async (mode) => {
  const f = await setup("prepare_claim", {
    noBinding: mode === "binding",
    audit: () => (mode === "audit" ? { ...approved, legalClaimsSupported: false } : approved),
    draft: (draft) => {
      if (mode === "quote" && draft.sourceClaims[1]) draft.sourceClaims[1].text += " 위조";
      const req = draft.issues[0]?.requirements[0];
      if (req && mode === "fact") req.factIds = ["not_a_current_fact"];
      if (req && mode === "wrong_kind") req.sourceClaimIds = ["precedent_records"];
      if (req && mode === "uncertainty") {
        req.factIds = ["return_unknown"];
        req.assessment = "supported";
      }
      if (req && mode === "position")
        req.evidence = [{ ...material, position: { ...material.position, page: 99 } }];
      if (mode === "perspective") draft.perspective.casePurpose = "respond_to_claim";
    },
  });
  try {
    await expect(f.service.prepare(f.input)).rejects.toMatchObject({
      code: mode === "binding" ? "SOURCE_UNAVAILABLE" : "POLICY_REJECTED",
    });
    expect(f.counts.analyze).toBe(mode === "binding" ? 0 : 1);
  } finally {
    f.db.close();
  }
});

test("excluded evidence is rejected before any model/API call; arbitrary private searches and overlarge plans are rejected", async () => {
  const f = await setup();
  try {
    f.input.scope.excludedFileIds = [material.fileId];
    await expect(f.service.prepare(f.input)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(f.counts).toEqual({ plan: 0, analyze: 0, audit: 0, attempts: 0 });
    const arbitrary = plan();
    (arbitrary.issues[0]?.requests as unknown[])?.push({
      kind: "precedent",
      concept: "private narrative",
    });
    expect(legalAnalysisPlanSchema.safeParse(arbitrary).success).toBe(false);
  } finally {
    f.db.close();
  }
});

test("actual model failure propagates, and a late revoked audit cannot publish an analysis", async () => {
  const f = await setup("prepare_claim", {
    audit: () => {
      f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.owner.userId);
      return approved;
    },
  });
  try {
    await expect(f.service.prepare(f.input)).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
  } finally {
    f.db.close();
  }
  const g = await setup("prepare_claim", {
    plan: () => {
      throw new Error("MODEL_UNAVAILABLE");
    },
  });
  try {
    await expect(g.service.prepare(g.input)).rejects.toThrow("MODEL_UNAVAILABLE");
    expect(g.counts.attempts).toBe(0);
  } finally {
    g.db.close();
  }
});

test.each(["analysis", "audit"])(
  "%s schema errors expose a finite code, never model output keys",
  async (phase) => {
    const marker = "synthetic_private_model_key";
    const f = await setup("prepare_claim", {
      ...(phase === "analysis"
        ? {
            draft: (draft: V2LegalAnalysisDraft) => {
              Object.assign(draft, { [marker]: true });
            },
          }
        : {}),
      audit: () => (phase === "audit" ? { ...approved, [marker]: true } : approved),
    });
    try {
      await expect(f.service.prepare(f.input)).rejects.toMatchObject({
        code: "MODEL_SCHEMA_INVALID",
        message: "MODEL_SCHEMA_INVALID",
      });
    } finally {
      f.db.close();
    }
  },
);

test("technical retries share twelve actual attempts and a fifth distinct plan is rejected", async () => {
  const requests = ["민법", "형법", "근로기준법", "상법"].map((lawTitle) => ({
    kind: "statute",
    lawTitle,
    articles: [{ number: "1", branch: "0" }],
  }));
  const bounded = {
    issues: [
      { id: "bounded_issue", title: "합성 기술 한도 검증", factIds: ["loan_promise"], requests },
    ],
  };
  const f = await setup("prepare_claim", {
    plan: () => bounded,
    transport: () => async () => new Response("", { status: 503 }),
  });
  try {
    const { snapshot } = await f.service.prepare(f.input);
    expect(f.counts.attempts).toBe(12);
    expect(snapshot.status).toBe("unavailable");
    expect(f.counts.analyze).toBe(0);
    expect(snapshot.availability.every((a) => a.reason === "upstream_unavailable")).toBe(true);
    expect(
      legalAnalysisPlanSchema.safeParse({
        issues: [
          {
            ...bounded.issues[0],
            requests: [...requests, { kind: "precedent", concept: "대여금" }],
          },
        ],
      }).success,
    ).toBe(false);
  } finally {
    f.db.close();
  }
});

test("local title ranking chooses a related older original before an unrelated newer judgment", async () => {
  const detailIds: string[] = [];
  const f = await setup("prepare_claim", {
    transport: (base) => async (url, init) => {
      const u = new URL(url);
      if (u.searchParams.get("target") === "prec" && u.pathname.endsWith("lawService.do"))
        detailIds.push(u.searchParams.get("ID") ?? "");
      const response = await base.transport(url, init);
      if (u.searchParams.get("target") !== "prec" || !u.pathname.endsWith("lawSearch.do"))
        return response;
      expect(u.searchParams.get("query")).toBe("대여금");
      expect(u.searchParams.get("search")).toBe("1");
      expect(u.searchParams.get("display")).toBe("40");
      const body = (await response.json()) as {
        PrecSearch: { totalCnt: string; prec: Record<string, string>[] };
      };
      const related = body.PrecSearch.prec[0];
      body.PrecSearch.totalCnt = "2";
      body.PrecSearch.prec = [
        {
          ...related,
          판례일련번호: sample.unrelatedPrecedent.officialId,
          사건명: sample.unrelatedPrecedent.title,
          선고일자: "20260501",
        },
        ...(related ? [related] : []),
      ];
      return Response.json(body);
    },
  });
  try {
    const { snapshot } = await f.service.prepare(f.input);
    expect(detailIds).toEqual([sample.precedent.officialId]);
    expect(snapshot.precedents).toHaveLength(1);
    expect(snapshot.status).toBe("partial"); // Bounded discovery never claims the whole pool was reviewed.
    expect(snapshot.limitations.some((s) => s.includes("제한된 검색"))).toBe(true);
  } finally {
    f.db.close();
  }
});

test.each(["cancel", "delete", "revision", "body", "expiry"])(
  "a late %s after independent audit cannot release a completed result",
  async (mode) => {
    const f = await setup("prepare_claim", {
      audit: () => {
        if (mode === "cancel") f.controller.abort();
        if (mode === "delete")
          f.db.sqlite.query("DELETE FROM v2_workspaces WHERE id=?").run(f.guard.workspaceId);
        if (mode === "revision")
          f.db.sqlite
            .query("UPDATE v2_workspaces SET revision=revision+1 WHERE id=?")
            .run(f.guard.workspaceId);
        if (mode === "body")
          f.db.sqlite
            .query("UPDATE v2_official_sources SET body=?")
            .run("tampered synthetic original");
        if (mode === "expiry") f.setTime("2026-10-07T00:00:00.001Z");
        return approved;
      },
    });
    try {
      await expect(f.service.prepare(f.input)).rejects.toMatchObject({
        code:
          mode === "cancel"
            ? "CANCELLED"
            : mode === "delete" || mode === "revision"
              ? "NOT_AUTHORIZED"
              : "SOURCE_UNAVAILABLE",
      });
      expect(f.counts.audit).toBe(1);
    } finally {
      f.db.close();
    }
  },
);

test("the analysis module initializes and validates synthetic claims in actual local workerd", async () => {
  const f = await setup();
  let mf: Miniflare | undefined;
  try {
    const prepared = await f.service.prepare(f.input);
    const draft = Object.fromEntries(
      Object.keys(legalAnalysisOutputSchema.shape).map((key) => [
        key,
        prepared.snapshot[key as keyof typeof prepared.snapshot],
      ]),
    );
    const build = await Bun.build({
      entrypoints: ["tests/helpers/legal-analysis-worker.ts"],
      target: "browser",
      format: "esm",
    });
    expect(build.success).toBe(true);
    const output = build.outputs[0];
    if (!output) throw new Error("Missing synthetic worker bundle");
    mf = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: await output.text(),
        compatibilityDate: "2026-10-01",
        cf: false,
        unsafeRegisterWorker: false,
      }),
    );
    const response = await fetch(await mf.ready, {
      method: "POST",
      body: JSON.stringify({
        input: f.input,
        now,
        plan: plan(),
        draft,
        retrieval: prepared.sourceRetrieval,
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "ready",
      citations: 2,
      evidenceHash: prepared.snapshot.basis.evidenceHash,
      calls: 3,
      synthetic: true,
      runtimeWorker: true,
      authorityAdapter: "test_only",
    });
  } finally {
    await mf?.dispose();
    f.db.close();
  }
}, 30000);
