import { expect, test } from "bun:test";
import type { V2CaseContext } from "../src/contracts/v2";
import {
  EXTRACTOR_VERSION,
  type RetrievalPlan,
  type SourceChunk,
  type SourceOutcome,
} from "../src/server/modules/legal-retrieval/v2/contracts";
import { guideUrl, OFFICIAL_CATALOG } from "../src/server/modules/legal-retrieval/v2/registry";
import { makeChunk } from "../src/server/modules/legal-retrieval/v2/source";
import {
  buildProcedureSources,
  selectReviewedProcedurePlans,
} from "../src/server/modules/resolution/procedure-sources";
import { createResolutionService } from "../src/server/modules/resolution/service";
import observations from "./fixtures/resolution/procedure-source-observations.json";
import { resolutionHarness, resolutionSource } from "./helpers/resolution-fixture";

const now = "2026-11-01T12:00:00.000Z";
const asOfDate = "2026-11-01";
type Guide = Extract<RetrievalPlan, { kind: "official_guide" }>;
const snippets: Record<string, string> = {
  "568_4_1_1":
    "소장에 기재해야 하는 필수 기재사항은 다음과 같습니다(「민사소송법」 제249조 및 제274조제1항).",
  "568_5_1_1": "소송은 법원에 소장을 제출함으로써 제기합니다(「민사소송법」 제248조제1항).",
  "568_5_2_1":
    "답변서에는 다음의 사항을 적어야 합니다(「민사소송법」 제256조제4항, 제274조 및 「민사소송규칙」 제65조제1항).",
  "568_7_2_1":
    "항소는 항소장에 다음의 사항을 적어 제1심 법원에 제출하면 제기됩니다(「민사소송법」 제397조).",
  "568_7_3_1":
    "상고는 상고장에 다음의 사항을 적어 원심(항소심) 법원에 제출하면 제기됩니다(「민사소송법」 제397조 및 제425조).",
  "734_2_1_1": "고소는 서면 또는 구술로써 사법경찰관에게 해야 합니다(「형사소송법」 제237조제1항).",
};
function context(
  kind = "civil",
  stage = "before_filing",
  casePurpose = "prepare_claim",
): V2CaseContext {
  return {
    casePurpose,
    subjectContext: "individual",
    procedure: { kind, stage, description: null },
  } as V2CaseContext;
}
function key(plan: Guide) {
  return [plan.csmSeq, plan.ccfNo, plan.cciNo, plan.cnpClsNo].join("_");
}
// Deliberately synthetic text/receipt. It is never presented as a live upstream success.
async function synthetic(
  plan: Guide,
  body = `합성 검증 전용\n${snippets[key(plan)]}\n합성 끝`,
): Promise<SourceChunk> {
  return makeChunk(
    {
      sourceType: "official_guide",
      officialId: `guide_${key(plan)}`,
      version: "2026-10-15",
      section: "합성 절차 안내",
      canonicalUrl: guideUrl(plan).href,
      title: "합성 절차 안내",
      body,
      sourceDate: "2026-10-15",
      fetchedAt: now,
      verifiedAt: now,
      rightsProvenance: OFFICIAL_CATALOG[2].rights,
      institutionId: "moleg_easylaw",
      endpointId: "easylaw_text_section",
      court: null,
      caseNumber: null,
    },
    asOfDate,
  );
}
function outcome(chunk: SourceChunk): SourceOutcome {
  return { kind: "official_guide", availability: "verified", reason: null, chunks: [chunk] };
}
async function fixture(c = context()) {
  const plans = selectReviewedProcedurePlans(c);
  const chunks = await Promise.all(plans.map((p) => synthetic(p)));
  const input = { context: c, asOfDate, now, outcomes: chunks.map(outcome) };
  return { plans, chunks, input };
}

for (const [c, expected] of [
  [context(), "civil_claim"],
  [context("civil", "first_instance", "respond_to_claim"), "answer"],
  [context("civil", "appeal", "respond_to_claim"), "appeal"],
  [context("civil", "final_appeal", "respond_to_claim"), "final_appeal"],
  [context("criminal"), "criminal_complaint"],
] as const)
  test(`synthetic verified writing original supports only actual ${expected} context`, async () => {
    const { input, chunks } = await fixture(c);
    const result = await buildProcedureSources(input);
    expect(result.documentSupport.map((s) => s.documentKind)).toEqual([expected]);
    expect(result.limitations).toHaveLength(0);
    expect(result.procedureChecks.every((check) => check.status === "verified")).toBe(true);
    for (const claim of result.sourceClaims) {
      const chunk = chunks.find((c) => c.citation.id === claim.citationId);
      expect(chunk?.source.body.slice(claim.startUtf16, claim.endUtf16)).toBe(claim.text);
      expect(result.procedureChecks.find((c) => c.sourceClaimIds.includes(claim.id))?.detail).toBe(
        claim.text,
      );
      expect(result.citations.find((c) => c.id === claim.citationId)?.verifiedAt).toBe(now);
    }
  });

test("unknown/other procedure, defense alone, investigation and wrong stage never imply an appeal or generic statement support", async () => {
  const civil = await fixture();
  for (const c of [
    context("civil", "unconfirmed"),
    context("unconfirmed"),
    context("family", "appeal"),
    context("civil", "before_filing", "respond_to_claim"),
    context("criminal", "investigation", "respond_to_claim"),
    context("criminal", "first_instance", "respond_to_claim"),
    context("criminal", "appeal", "respond_to_claim"),
    context("criminal", "final_appeal", "respond_to_claim"),
    context("civil", "appeal", "unconfirmed"),
  ]) {
    expect(selectReviewedProcedurePlans(c)).toHaveLength(0);
    const result = await buildProcedureSources({ ...civil.input, context: c });
    expect(result.documentSupport).toEqual([]);
    expect(result.sourceClaims).toEqual([]);
    expect(result.limitations[0]?.reason).toBe("unsupported_context");
  }
});
test("both sides in actual civil appeal share the reviewed plan, maximum two plans and fresh returned objects", () => {
  expect(selectReviewedProcedurePlans(context("civil", "appeal", "prepare_claim"))).toEqual(
    selectReviewedProcedurePlans(context("civil", "appeal", "respond_to_claim")),
  );
  expect(selectReviewedProcedurePlans(context())).toHaveLength(2);
  const first = selectReviewedProcedurePlans(context())[0];
  if (first) first.csmSeq = "999";
  expect(selectReviewedProcedurePlans(context())[0]?.csmSeq).toBe("568");
});
test("all actual public observations remain limited; their hashes/times are receipts, not verified fixtures", async () => {
  expect(observations.researchOnly).toBe(true);
  expect(observations.workspaceBinding).toBe(false);
  expect(observations.observations).toHaveLength(11);
  for (const observation of observations.observations) {
    expect(["update_pending", "image_omitted"]).toContain(observation.reason);
    expect(observation.hash).toMatch(/^[a-f0-9]{64}$/);
    const c = observation.plan.csmSeq === "734" ? context("criminal") : context();
    const { input } = await fixture(c);
    input.outcomes.forEach((o) => {
      o.availability = "limited";
      o.reason = observation.reason as "update_pending" | "image_omitted";
    });
    const result = await buildProcedureSources(input);
    expect(result.documentSupport).toEqual([]);
    expect(result.citations).toEqual([]);
    expect(result.sourceClaims).toEqual([]);
    expect(result.limitations.every((l) => l.reason === observation.reason)).toBe(true);
    expect(result.procedureChecks.every((check) => check.status === "needs_confirmation")).toBe(
      true,
    );
    expect(result.limitations[0]?.checkedAt).toBe(now); // synthetic check time, never substituted into the observation receipt
  }
});
test("unavailable/unknown-date and contradictory verified reason never open document support", async () => {
  for (const availability of ["limited", "unavailable", "not_requested", "verified"] as const) {
    const { input } = await fixture();
    input.outcomes.forEach((o) => {
      o.availability = availability;
      o.reason = "unknown_publication_date";
    });
    expect((await buildProcedureSources(input)).documentSupport).toEqual([]);
  }
  const { input } = await fixture();
  input.outcomes = [];
  expect(
    (await buildProcedureSources(input)).limitations.every((l) => l.reason === "not_requested"),
  ).toBe(true);
});

test("empty failed outcomes retain grouped real failure reasons without guessing individual plan identity", async () => {
  const { input } = await fixture();
  input.outcomes = [
    { kind: "official_guide", availability: "unavailable", reason: "timeout", chunks: [] },
  ];
  const result = await buildProcedureSources(input);
  expect(result.documentSupport).toEqual([]);
  expect(result.limitations).toHaveLength(2);
  expect(
    result.limitations.every((l) => l.reason === "source_unavailable" && l.checkedAt === null),
  ).toBe(true);
  expect(result.procedureChecks.every((c) => c.detail.includes("공식 기관의 응답이 늦어"))).toBe(
    true,
  );
});
test("tampered source/citation/hash/extractor/time/URL/full span fail closed even when availability says verified", async () => {
  const mutations: ((c: SourceChunk) => void)[] = [
    (c) => {
      c.source.body += "changed";
    },
    (c) => {
      c.source.contentHash = "a".repeat(64);
    },
    (c) => {
      c.source.sourceId = "source_forged";
    },
    (c) => {
      c.source.extractorVersion = `${EXTRACTOR_VERSION}-other`;
    },
    (c) => {
      c.source.canonicalUrl += "&extra=1";
    },
    (c) => {
      c.source.officialId = "guide_568_7_2_1";
    },
    (c) => {
      c.source.expiresAt = now;
    },
    (c) => {
      c.source.verifiedAt = "2026-11-02T12:00:00.000Z";
    },
    (c) => {
      // A stored older receipt can survive renewal; it cannot postdate the source verification.
      c.citation.verifiedAt = "2026-11-01T12:00:01.000Z";
    },
    (c) => {
      c.citation.contentHash = "a".repeat(64);
    },
    (c) => {
      c.source.rightsProvenance = "unreviewed";
    },
    (c) => {
      c.span.endUtf16 -= 1;
    },
  ];
  for (const mutate of mutations) {
    const { input } = await fixture(context("civil", "first_instance", "respond_to_claim"));
    const chunk = input.outcomes[0]?.chunks[0];
    if (!chunk) throw Error("fixture");
    mutate(chunk);
    const result = await buildProcedureSources(input);
    expect(result.documentSupport).toEqual([]);
    expect(result.limitations[0]?.reason).toBe("cache_invalid");
    expect(result.limitations[0]?.checkedAt).toBeNull();
  }
});
test("correctly hashed changed/duplicate anchor and duplicate originals require review, independent valid sources survive", async () => {
  const { input, plans } = await fixture();
  const plan = plans[0];
  if (!plan) throw Error("fixture");
  for (const body of ["changed official body", `${snippets[key(plan)]}\n${snippets[key(plan)]}`]) {
    input.outcomes[0] = outcome(await synthetic(plan, body));
    const result = await buildProcedureSources(input);
    expect(result.documentSupport).toEqual([]);
    expect(result.limitations[0]?.reason).toBe("quotation_changed");
    expect(result.citations).toHaveLength(1); // independent filing original is still usable
  }
  input.outcomes.push(input.outcomes[0] as SourceOutcome);
  expect((await buildProcedureSources(input)).limitations[0]?.reason).toBe("ambiguous_source");
});
test("service integration keeps individual jurisdiction/deadline unconfirmed and rejects a mismatched procedure", async () => {
  const { input } = await fixture();
  const proof = await buildProcedureSources(input);
  const source = resolutionSource();
  Object.assign(source, proof);
  const h = resolutionHarness(source);
  const service = createResolutionService(h.deps);
  const state = await service.get("owner", "case");
  expect(state.allowedDocumentKinds).toEqual(["fact_statement", "civil_claim"]);
  for (const id of ["jurisdiction", "deadline", "institution", "form"])
    expect(state.procedureChecks.find((c) => c.id === id)?.status).toBe("needs_confirmation");
  if (source.basis)
    source.basis.procedure = { kind: "criminal", stage: "investigation", description: null };
  expect((await service.get("owner", "case")).allowedDocumentKinds).toEqual(["fact_statement"]);
});
test("expired proof and future as-of never renew observation timestamps", async () => {
  const { input } = await fixture();
  const result = await buildProcedureSources({ ...input, now: "2026-11-02T12:00:00.000Z" });
  expect(result.documentSupport).toEqual([]);
  expect(result.limitations.every((l) => l.checkedAt === null)).toBe(true);
  await expect(buildProcedureSources({ ...input, asOfDate: "2026-11-03" })).rejects.toThrow(
    "PROCEDURE_SOURCE_FUTURE_DATE",
  );
});
