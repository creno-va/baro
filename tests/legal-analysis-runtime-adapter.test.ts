import { expect, test } from "bun:test";
import type { V2Fact, V2OfficialCitation } from "../src/contracts/v2";
import type { LegalAnalysisInput } from "../src/server/modules/legal-retrieval/analysis/context";
import {
  createLegalAnalysisRuntimeAdapter,
  type LegalAnalysisGatewayPhase,
  type LegalAnalysisRuntimeDependencies,
} from "../src/server/modules/legal-retrieval/analysis/runtime-adapter";
import { readBoundSourceBatch } from "../src/server/modules/legal-retrieval/v2/bound-sources";
import type { RetrievalPlan } from "../src/server/modules/legal-retrieval/v2/contracts";
import { GUIDE_HOSTS } from "../src/server/modules/legal-retrieval/v2/registry";
import { workspaceGuidePlans } from "../src/server/modules/legal-retrieval/v2/workspace-plans";
import type {
  GatewayAttemptRequest,
  GatewayTransportReceipt,
} from "../src/server/modules/llm-gateway/attempts";
import { MODEL_ID } from "../src/server/modules/llm-gateway/prompts";
import { createLlmGateway, ModelError } from "../src/server/modules/llm-gateway/service";
import { workspaceModelInput } from "../src/server/modules/workspace/pipeline";
import sample from "./fixtures/legal/analysis/scenarios.json";
import { legalAnalysisFixture } from "./helpers/legal-analysis-fixture";
import { syntheticGeneralGuide } from "./helpers/synthetic-legal-guide";

const NOW = "2026-10-06T00:00:00.000Z";
const phases: LegalAnalysisGatewayPhase[] = [
  "workspace_legal_plan",
  "workspace_legal_analysis",
  "workspace_legal_audit",
];
const fact: V2Fact = {
  id: "current_loan_fact",
  text: "문자로 돈을 빌려 달라는 요청과 반환 약속을 주고받았다.",
  attribution: "user_statement",
  certainty: "reported",
  significance: "neutral",
  references: [{ kind: "intake_narrative", intakeRevision: 1 }],
  conflictingFactIds: [],
  userEdited: false,
};
const plan = (many = false) => ({
  issues: [
    {
      id: "loan_issue",
      title: "대여 약정의 자료 확인",
      factIds: [fact.id],
      requests: [
        {
          kind: "statute",
          lawTitle: "민법",
          articles: many
            ? [
                { number: "598", branch: "0" },
                { number: "600", branch: "0" },
              ]
            : [{ number: "598", branch: "0" }],
        },
        ...(many
          ? [
              {
                kind: "statute",
                lawTitle: "형법",
                articles: [
                  { number: "1", branch: "0" },
                  { number: "2", branch: "0" },
                ],
              },
            ]
          : []),
        { kind: "precedent", concept: "대여금" },
      ],
    },
  ],
});
function draft(raw: unknown) {
  const input = raw as {
    citations: V2OfficialCitation[];
    sourceTexts: { citationId: string; text: string }[];
  };
  const law = input.citations.find((c) => c.kind === "statute"),
    precedent = input.citations.find((c) => c.kind === "precedent");
  if (!law || !precedent) throw new Error("Missing synthetic source");
  return {
    issues: [
      {
        id: "loan_issue",
        title: "대여 약정의 자료 확인",
        requirements: [
          {
            id: "loan_requirement",
            label:
              "합성 약정 확인 요건에 문자의 반환 약속 진술이 대응하지만 원본 자료가 없어 추가 확인이 필요합니다.",
            assessment: "insufficient",
            sourceClaimIds: ["law_claim"],
            factIds: [fact.id],
            conflictingFactIds: [],
            evidence: [],
            gaps: ["문자 전체 대화 자료"],
          },
        ],
      },
    ],
    precedents: [
      {
        citationId: precedent.id,
        commonalities: [
          {
            text: "약정의 존재를 확인하는 자료가 쟁점인 점",
            factIds: [fact.id],
            sourceClaimIds: ["precedent_claim"],
          },
        ],
        differences: [
          {
            text: "합성 판례는 서면 차용증, 이번 진술은 문자 약속을 언급하므로 원본 확인이 필요합니다.",
            factIds: [fact.id],
            sourceClaimIds: ["precedent_claim"],
          },
        ],
        preparationMeaning: "문자 약속의 구체 내용과 원본을 구분해 확인합니다.",
      },
    ],
    perspective: {
      casePurpose: "prepare_claim",
      weaknesses: ["현재 진술에 대응하는 원본 자료를 아직 포함하지 않았습니다."],
      claimGaps: ["약정 내용과 교부·변제 자료 확인"],
      responsePoints: [],
      additionalMaterials: ["문자 전체 대화 자료"],
    },
    evidenceRequirements: [],
    sourceClaims: [law, precedent].map((c, i) => ({
      id: i === 0 ? "law_claim" : "precedent_claim",
      kind: "quotation",
      citationId: c.id,
      text: input.sourceTexts.find((s) => s.citationId === c.id)?.text,
      startUtf16: 0,
      endUtf16: input.sourceTexts.find((s) => s.citationId === c.id)?.text.length,
    })),
    limitations: ["합성 공식 원문과 대역 gateway를 이용한 연결 검증입니다."],
  };
}
async function fixture(
  options: {
    many?: boolean;
    invalidId?: boolean;
    correction?: boolean;
    defaultReader?: boolean;
    readerError?: boolean;
    nativeGateway?: boolean;
    beforeReserve?: (f: Awaited<ReturnType<typeof legalAnalysisFixture>>) => void;
    beforeReturn?: (
      phase: LegalAnalysisGatewayPhase,
      f: Awaited<ReturnType<typeof legalAnalysisFixture>>,
    ) => void;
    rejectPlan?: boolean;
    stranger?: boolean;
    additionalPlans?: readonly RetrievalPlan[];
    guideLimited?: boolean;
  } = {},
) {
  const f = await legalAnalysisFixture();
  const input: LegalAnalysisInput = {
    context: {
      casePurpose: "prepare_claim",
      subjectContext: "individual",
      procedure: { kind: "civil", stage: "before_filing", description: null },
    },
    confirmedSummary: {
      schemaVersion: "2",
      revision: 1,
      intakeRevision: 1,
      createdAt: NOW,
      overview: "합성 대여금 사건",
      facts: [fact],
      parties: [],
      unknowns: ["문자 원본과 교부·변제 자료"],
      notices: ["합성 검증"],
    },
    facts: [fact],
    includedEvidence: [],
    materials: [],
    researchRevision: 1,
    scope: { excludedFileIds: [], maskIdentifiers: false },
  };
  const ids = Object.fromEntries(phases.map((p) => [p, crypto.randomUUID()])) as Record<
    LegalAnalysisGatewayPhase,
    string
  >;
  const calls: {
    phase: LegalAnalysisGatewayPhase;
    input: unknown;
    requestId: string;
    invocationId: string;
  }[] = [];
  const admissions: {
    phase: LegalAnalysisGatewayPhase;
    input: unknown;
    invocationId: string;
    correction: boolean;
  }[] = [];
  const batches: number[] = [];
  let identityReads = 0,
    providerDispatches = 0,
    attempts = 0,
    clock = NOW;
  const ledgerRequests: GatewayAttemptRequest[] = [];
  const receipts: GatewayTransportReceipt[] = [];
  const settled: Promise<void>[] = [];
  const native = createLlmGateway(
    {
      APP_ENV: "preview",
      AI_GATEWAY_ID: "synthetic-gateway",
      AI: {
        async run(model, wire, settings) {
          const phase = calls.at(-1)?.phase;
          if (!phase) throw new Error("Missing synthetic phase");
          expect(model).toBe(MODEL_ID);
          expect(settings.gateway).toEqual({
            id: "synthetic-gateway",
            collectLog: false,
            skipCache: true,
          });
          expect(wire).not.toHaveProperty("messages");
          expect(wire).toMatchObject({
            generationConfig: {
              responseMimeType: "application/json",
              thinkingConfig: {
                thinkingLevel: phase === "workspace_legal_audit" ? "MEDIUM" : "LOW",
                includeThoughts: false,
              },
            },
          });
          const value = wire as { contents: { parts: { text: string }[] }[] };
          const projected = JSON.parse(value.contents[0]?.parts[0]?.text ?? "null").data;
          const output =
            phase === "workspace_legal_plan"
              ? plan(options.many)
              : phase === "workspace_legal_analysis"
                ? draft(projected)
                : {
                    pass: true,
                    findings: [],
                    unsupportedFactIds: [],
                    legalClaimsSupported: true,
                    strategyDetected: false,
                  };
          providerDispatches++;
          return {
            candidates: [
              { content: { parts: [{ text: JSON.stringify({ output }) }] }, finishReason: "STOP" },
            ],
            usageMetadata: {
              promptTokenCount: 100,
              candidatesTokenCount: 100,
              thoughtsTokenCount: 0,
              totalTokenCount: 200,
              cachedContentTokenCount: 0,
            },
            responseId: `synthetic_response_${providerDispatches}`,
          };
        },
      },
    },
    {
      requireAttemptLedger: true,
      attemptLedger: {
        beforeDispatch: async (request) => {
          ledgerRequests.push(request);
          return { invocationId: request.invocationId, attemptId: crypto.randomUUID() };
        },
        confirmDispatch: async () => true,
        afterTransport: async (_handle, receipt) => {
          receipts.push(receipt);
        },
        waitUntil: (promise) => {
          settled.push(promise);
        },
      },
    },
  );
  const adapter = createLegalAnalysisRuntimeAdapter({
    core: f.core,
    env: { LAW_API_OC: "synthetic-only" },
    guard: options.stranger ? { ...f.guard, ownerId: "stranger_owner" } : f.guard,
    requestId: "synthetic_analysis_job",
    gateway: {
      async call(phase, value, requestId, reserve, reserveCorrection, invocationId) {
        calls.push({ phase, input: value, requestId, invocationId });
        if (options.nativeGateway)
          return native.call(phase, value, requestId, reserve, reserveCorrection, invocationId);
        if (phase === "workspace_legal_plan" && options.rejectPlan)
          throw new ModelError("MODEL_UNAVAILABLE");
        if (!(await reserve())) throw new ModelError("MODEL_UNAVAILABLE");
        if (
          options.correction &&
          phase === "workspace_legal_analysis" &&
          !(await reserveCorrection())
        )
          throw new ModelError("MODEL_UNAVAILABLE");
        providerDispatches++;
        const output =
          phase === "workspace_legal_plan"
            ? plan(options.many)
            : phase === "workspace_legal_analysis"
              ? draft(value)
              : {
                  pass: true,
                  findings: [],
                  unsupportedFactIds: [],
                  legalClaimsSupported: true,
                  strategyDetected: false,
                };
        options.beforeReturn?.(phase, f);
        return output;
      },
    },
    modelAdmission: {
      invocationId: (phase) => {
        identityReads++;
        return options.invalidId ? "not-a-durable-uuid" : ids[phase];
      },
      reserve: async (phase, value, invocationId) => {
        admissions.push({ phase, input: value, invocationId, correction: false });
        options.beforeReserve?.(f);
        return true;
      },
      reserveCorrection: async (phase, value, invocationId) => {
        admissions.push({ phase, input: value, invocationId, correction: true });
        return true;
      },
    },
    authorize: async () => true, // Real DB owner/consent checks below must still reject strangers/revocation.
    reserveRequest: async () => {
      attempts++;
      return true;
    },
    ...(options.additionalPlans ? { additionalPlans: options.additionalPlans } : {}),
    clock: () => clock,
    ...(!options.defaultReader
      ? {
          readBoundSources: async (sourceIds: readonly string[], now: string) => {
            batches.push(sourceIds.length);
            if (options.readerError) throw new Error("synthetic_private_sql_reader_error");
            return readBoundSourceBatch(f.core, f.guard.workspaceId, sourceIds, now, GUIDE_HOSTS);
          },
        }
      : {}),
    transport: async (url, init) => {
      if (new URL(url).hostname === "www.easylaw.go.kr")
        return new Response(
          options.guideLimited
            ? syntheticGeneralGuide
            : syntheticGeneralGuide.replace(
                "개정 사항을 검토하여 향후 업데이트 예정입니다.",
                "합성 안내",
              ),
          { headers: { "content-type": "text/html" } },
        );
      const response = await f.transport(url, init);
      const u = new URL(url);
      if (!options.many || u.searchParams.get("target") !== "eflaw") return response;
      const body = (await response.json()) as {
        LawSearch?: { law: Record<string, string>[] };
        법령?: { 기본정보: Record<string, string>; 조문: { 조문단위: Record<string, string> } };
      };
      const criminal =
        u.searchParams.get("query") === "형법" || u.searchParams.get("MST") === "284416";
      const basic = {
        법령ID: criminal ? "1707" : "1706",
        법령명한글: criminal ? "형법" : "민법",
        법령일련번호: criminal ? "284416" : "284415",
      };
      if (body.LawSearch?.law[0]) Object.assign(body.LawSearch.law[0], basic);
      if (body.법령) {
        Object.assign(body.법령.기본정보, { 법령ID: basic.법령ID, 법령명_한글: basic.법령명한글 });
        const number = String(Number(u.searchParams.get("JO")?.slice(0, 4)));
        Object.assign(body.법령.조문.조문단위, {
          조문번호: number,
          조문내용: `제${number}조 합성 연결 검증 본문. 실제 법률 문언이 아닙니다.`,
        });
      }
      return Response.json(body);
    },
  });
  return {
    ...f,
    input,
    adapter,
    calls,
    admissions,
    batches,
    ids,
    counts: () => ({ identityReads, providerDispatches, attempts }),
    ledgerRequests,
    receipts,
    settled,
    setTime: (value: string) => {
      clock = value;
    },
  };
}

test("native gateway callbacks, real official retrieval/binding and a stable same-job replay connect without publication", async () => {
  const f = await fixture({ correction: true, defaultReader: true });
  try {
    const [first, concurrent] = await Promise.all([
      f.adapter.prepare(f.input),
      f.adapter.prepare(f.input),
    ]);
    expect(first.snapshot.status).toBe("ready");
    expect(first.snapshot.id).toBe(concurrent.snapshot.id);
    expect(f.calls.map((c) => c.phase)).toEqual(phases);
    expect(f.counts()).toEqual({ identityReads: 3, providerDispatches: 3, attempts: 4 });
    expect(f.admissions.filter((a) => a.correction)).toHaveLength(1);
    for (const call of f.calls) {
      expect(call.requestId).toBe("synthetic_analysis_job");
      expect(call.invocationId).toBe(f.ids[call.phase]);
      expect(JSON.stringify(workspaceModelInput(call.input))).toBe(JSON.stringify(call.input));
      expect(
        f.admissions
          .filter((a) => a.phase === call.phase)
          .every(
            (a) =>
              a.invocationId === call.invocationId &&
              JSON.stringify(a.input) === JSON.stringify(call.input),
          ),
      ).toBe(true);
      expect(JSON.stringify(call.input)).not.toContain('"officialId"');
      expect(JSON.stringify(call.input)).not.toContain('"sourceRetrieval"');
    }
    expect(first.snapshot.citations[1]).toMatchObject({ caseNumber: sample.precedent.caseNumber });
    expect(f.db.sqlite.query("SELECT count(*) AS n FROM v2_citation_bindings").get()).toEqual({
      n: 2,
    });
    expect(f.db.sqlite.query("SELECT count(*) AS n FROM v2_rework_records").get()).toEqual({
      n: 0,
    });
    expect(
      f.db.sqlite.query("SELECT revision FROM v2_workspaces WHERE id=?").get(f.guard.workspaceId),
    ).toEqual({ revision: 1 });
    expect((await f.adapter.prepare(f.input)).snapshot.id).toBe(first.snapshot.id);
    expect(f.counts().providerDispatches).toBe(3);
  } finally {
    f.db.close();
  }
});

test("five verified originals are revalidated in batches of four without weakening source authority", async () => {
  const f = await fixture({ many: true });
  try {
    const result = await f.adapter.prepare(f.input);
    expect(result.sourceRetrieval.chunks).toHaveLength(5);
    expect(f.batches.every((n) => n <= 4)).toBe(true);
    expect(f.batches).toContain(4);
    expect(f.batches).toContain(1);
    expect(f.counts().attempts).toBe(8);
    expect(f.db.sqlite.query("SELECT count(*) AS n FROM v2_citation_bindings").get()).toEqual({
      n: 5,
    });
  } finally {
    f.db.close();
  }
});

test("registered native gateway and its attempt ledger execute the adapter's three phases end to end", async () => {
  const f = await fixture({ nativeGateway: true, defaultReader: true });
  try {
    const result = await f.adapter.prepare(f.input);
    await Promise.all(f.settled);
    expect(result.snapshot.status).toBe("ready");
    expect(f.ledgerRequests.map((r) => r.phase)).toEqual(phases);
    expect(
      f.ledgerRequests.every(
        (r) =>
          r.invocationId === f.ids[r.phase as LegalAnalysisGatewayPhase] &&
          r.attemptOrdinal === 1 &&
          r.wireInputSha256.length === 64,
      ),
    ).toBe(true);
    expect(f.receipts).toHaveLength(3);
    expect(f.receipts.every((r) => r.transport === "response" && !r.definitiveNoCharge)).toBe(true);
    expect(f.counts()).toEqual({ identityReads: 3, providerDispatches: 3, attempts: 4 });
  } finally {
    f.db.close();
  }
});

test("native planning/generation/audit all retain actual observation uncertainty and correction flags", async () => {
  const f = await fixture({ nativeGateway: true, defaultReader: true });
  try {
    const coverage = { observationCertainty: "uncertain" as const, userEdited: true };
    f.input.includedEvidence = [
      { fileId: "corrected_material", fileRevision: 2, contentHash: "d".repeat(64) },
    ];
    f.input.materials = [
      {
        reference: {
          kind: "user_material",
          fileId: "corrected_material",
          fileRevision: 2,
          position: { kind: "image", region: null },
        },
        text: "사용자가 교정한 합성 관찰이며 원본 확인이 필요합니다.",
        coverage,
      },
    ];
    const result = await f.adapter.prepare(f.input);
    for (const call of f.calls) {
      const input =
        call.phase === "workspace_legal_audit"
          ? (call.input as { context: unknown }).context
          : call.input;
      expect(input).toMatchObject({ materials: [{ coverage }] });
    }
    expect(result.snapshot.limitations.some((text) => text.includes("사용자가 교정"))).toBe(true);
    expect(f.counts().providerDispatches).toBe(3);
  } finally {
    f.db.close();
  }
});

test("bound-reader failure exposes a finite error and never reaches analysis generation", async () => {
  const f = await fixture({ readerError: true });
  try {
    await expect(f.adapter.prepare(f.input)).rejects.toMatchObject({
      code: "SOURCE_UNAVAILABLE",
      message: "SOURCE_UNAVAILABLE",
    });
    expect(f.calls.map((c) => c.phase)).toEqual(["workspace_legal_plan"]);
    expect(f.counts().attempts).toBe(4);
  } finally {
    f.db.close();
  }
});

test.each([
  "stranger",
  "invalid_id",
  "reserve_revocation",
  "late_revocation",
  "expiry",
  "provider",
])(
  "%s cannot bypass owner/consent/durable admission or cause implicit model replay",
  async (mode) => {
    const f = await fixture({
      stranger: mode === "stranger",
      invalidId: mode === "invalid_id",
      rejectPlan: mode === "provider",
      ...(mode === "reserve_revocation"
        ? {
            beforeReserve: (base: Awaited<ReturnType<typeof legalAnalysisFixture>>) => {
              base.db.sqlite
                .query("DELETE FROM user_consents WHERE user_id=?")
                .run(base.owner.userId);
            },
          }
        : {}),
      beforeReturn: (phase, base) => {
        if (mode === "late_revocation" && phase === "workspace_legal_audit")
          base.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(base.owner.userId);
      },
    });
    try {
      if (mode === "expiry") {
        await f.adapter.prepare(f.input);
        f.setTime("2026-10-07T00:00:00.001Z");
        await expect(f.adapter.prepare(f.input)).rejects.toMatchObject({
          code: "SOURCE_UNAVAILABLE",
        });
        expect(f.counts().providerDispatches).toBe(3);
      } else {
        await expect(f.adapter.prepare(f.input)).rejects.toMatchObject({
          code:
            mode === "invalid_id"
              ? "INVALID_INPUT"
              : mode === "reserve_revocation" || mode === "provider"
                ? "MODEL_UNAVAILABLE"
                : "NOT_AUTHORIZED",
        });
        if (["stranger", "invalid_id", "reserve_revocation", "provider"].includes(mode)) {
          expect(f.counts().providerDispatches).toBe(0);
          expect(f.counts().attempts).toBe(0);
        }
        if (mode === "provider") {
          await expect(f.adapter.prepare(f.input)).rejects.toMatchObject({
            code: "MODEL_UNAVAILABLE",
          });
          expect(f.calls).toHaveLength(1);
        }
      }
      expect(f.db.sqlite.query("SELECT count(*) AS n FROM v2_rework_records").get()).toEqual({
        n: 0,
      });
    } finally {
      f.db.close();
    }
  },
);

test.each([false, true])(
  "reviewed server guide reaches the same native gateway/retrieval job and retains limited=%s",
  async (guideLimited) => {
    const f = await fixture({
      additionalPlans: [workspaceGuidePlans.legal_consultation],
      nativeGateway: true,
      defaultReader: true,
      guideLimited,
    });
    try {
      const result = await f.adapter.prepare(f.input);
      const outcome = result.sourceRetrieval.outcomes.find((o) => o.kind === "official_guide");
      expect(outcome?.availability).toBe(guideLimited ? "limited" : "verified");
      expect(outcome?.reason).toBe(guideLimited ? "update_pending" : null);
      expect(outcome?.chunks).toHaveLength(guideLimited ? 0 : 1);
      expect(result.snapshot.status).toBe(guideLimited ? "partial" : "ready");
      expect(f.counts().attempts).toBe(5);
      expect(f.counts().providerDispatches).toBe(3);
      expect(f.calls.map((c) => c.phase)).toEqual(phases);
      expect(f.calls[0]?.input).not.toHaveProperty("additionalPlans");
      const generation = f.calls[1]?.input as { citations: V2OfficialCitation[] };
      expect(generation.citations.some((c) => c.kind === "official_guide")).toBe(!guideLimited);
      const guide = outcome?.chunks[0];
      if (guide) {
        const restored = await readBoundSourceBatch(
          f.core,
          f.guard.workspaceId,
          [guide.citation.id],
          NOW,
          GUIDE_HOSTS,
        );
        expect(restored[0]?.citation).toEqual(guide.citation);
        expect(restored[0]?.source.body).toBe(guide.source.body);
      }
      await f.adapter.prepare(f.input);
      expect(f.counts().attempts).toBe(5);
      expect(f.counts().providerDispatches).toBe(3);
      await Promise.all(f.settled);
      expect(f.receipts).toHaveLength(3);
    } finally {
      f.db.close();
    }
  },
);

test.each(
  [
    [{ kind: "statute", lawTitle: "민법", articles: [{ number: "598" }] }],
    [{ ...workspaceGuidePlans.legal_consultation, csmSeq: "not-an-identity" }],
    [{ ...workspaceGuidePlans.legal_consultation, endpointId: "unreviewed_endpoint" }],
    [{ ...workspaceGuidePlans.legal_consultation, url: "https://example.com" }],
    Array.from({ length: 3 }, () => workspaceGuidePlans.legal_consultation),
    new Array(1),
    null,
  ].map((additionalPlans) => ({ additionalPlans })),
)(
  "invalid server-only guide plans fail before model/admission/retrieval: %j",
  ({ additionalPlans }) => {
    // Only this port is evaluated: no database, model or transport may be needed.
    expect(() =>
      createLegalAnalysisRuntimeAdapter({
        additionalPlans,
      } as unknown as LegalAnalysisRuntimeDependencies),
    ).toThrow("INVALID_PLAN");
  },
);
