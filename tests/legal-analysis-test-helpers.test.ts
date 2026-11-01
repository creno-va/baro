import { expect, test } from "bun:test";
import type { V2CasePurpose } from "../src/contracts/v2/rework";
import type { LegalAnalysisInput } from "../src/server/modules/legal-retrieval/analysis/context";
import { createAutomaticLegalAnalysis } from "../src/server/modules/legal-retrieval/analysis/service";
import type { RetrievalPlan } from "../src/server/modules/legal-retrieval/v2/contracts";
import { parseGuide } from "../src/server/modules/legal-retrieval/v2/guides";
import { guideUrl } from "../src/server/modules/legal-retrieval/v2/registry";
import { workspaceGuidePlans } from "../src/server/modules/legal-retrieval/v2/workspace-plans";
import { workspaceModelInput } from "../src/server/modules/workspace/pipeline";
import sample from "./fixtures/legal/analysis/scenarios.json";
import {
  createSyntheticLegalTransport,
  legalAnalysisFixture,
  type SyntheticLegalRequest,
} from "./helpers/legal-analysis-fixture";
import { syntheticLegalDraft, syntheticLegalPlan } from "./helpers/legal-analysis-model-fixture";

const NOW = "2026-10-06T00:00:00.000Z";
function currentInput(purpose: V2CasePurpose): LegalAnalysisInput {
  const reference = {
    kind: "user_material" as const,
    fileId: `current_file_${purpose}`,
    fileRevision: 7,
    position: { kind: "document" as const, page: 2, paragraph: 3, table: null },
  };
  const facts: LegalAnalysisInput["facts"] = [
    {
      id: `current_statement_${purpose}`,
      text: "😀 문자의 반환 약속과 실제 지급·변제 자료는 구분해 확인해야 한다.",
      attribution: "user_statement",
      certainty: "reported",
      significance: "neutral",
      references: [{ kind: "intake_narrative", intakeRevision: 1 }],
      conflictingFactIds: [],
      userEdited: false,
    },
    {
      id: `current_observation_${purpose}`,
      text: "사용자가 교정한 송금 관찰은 원본을 확인해야 한다.",
      attribution: "user_material",
      certainty: "uncertain",
      significance: "unfavorable",
      references: [reference],
      conflictingFactIds: [],
      userEdited: true,
    },
  ];
  return {
    context: {
      casePurpose: purpose,
      subjectContext: "individual",
      procedure: { kind: "civil", stage: "before_filing", description: null },
    },
    confirmedSummary: {
      schemaVersion: "2",
      revision: 1,
      intakeRevision: 1,
      createdAt: NOW,
      overview: "합성 대여금 자료 확인",
      facts,
      parties: [],
      unknowns: ["원본"],
      notices: ["합성 입력 검증"],
    },
    facts,
    includedEvidence: [
      {
        fileId: reference.fileId,
        fileRevision: reference.fileRevision,
        contentHash: "b".repeat(64),
      },
    ],
    materials: [
      {
        reference,
        text: facts[1]?.text ?? "합성 관찰",
        coverage: { observationCertainty: "uncertain", userEdited: true },
      },
    ],
    researchRevision: 1,
    scope: { excludedFileIds: [], maskIdentifiers: false },
  };
}

for (const mode of ["ready", "empty", "failure"] as const) {
  test(`pure ${mode} transport is instantiated without DB/network and emits only synthetic external responses`, async () => {
    const receipts: SyntheticLegalRequest[] = [];
    const transport = createSyntheticLegalTransport({
      mode,
      onRequest: (request) => receipts.push(request),
    });
    expect(receipts).toEqual([]);
    const response = await transport(
      "https://www.law.go.kr/DRF/lawSearch.do?OC=synthetic-private-key&target=prec&type=JSON&query=대여금",
      {},
    );
    expect(receipts).toEqual([{ target: "prec", detail: false, query: "대여금" }]);
    expect(JSON.stringify(receipts)).not.toContain("synthetic-private-key");
    expect(response.status).toBe(mode === "failure" ? 503 : 200);
    if (mode !== "failure") {
      const body = (await response.json()) as { PrecSearch: { totalCnt: string; prec: unknown[] } };
      expect(body.PrecSearch.totalCnt).toBe(mode === "empty" ? "0" : "1");
      expect(body.PrecSearch.prec).toHaveLength(mode === "empty" ? 0 : 1);
      expect(body).not.toHaveProperty("snapshot");
    }
  });
}

test("synthetic procedure HTML follows the requested identity and real parser; an empty original never becomes verified", async () => {
  const plan: Extract<RetrievalPlan, { kind: "official_guide" }> = {
    ...workspaceGuidePlans.legal_consultation,
    ccfNo: "4",
  };
  const response = await createSyntheticLegalTransport()(guideUrl(plan).href, {});
  expect(response.headers.get("content-type")).toBe("text/html");
  const parsed = await parseGuide(await response.text(), plan, "2026-10-06", NOW);
  expect(parsed.reason).toBeNull();
  expect(parsed.chunk.citation.url).toBe(guideUrl(plan).href);
  expect(parsed.chunk.source.body).toContain("합성 공식 절차 안내");
  const empty = await createSyntheticLegalTransport({ mode: "empty" })(guideUrl(plan).href, {});
  await expect(parseGuide(await empty.text(), plan, "2026-10-06", NOW)).rejects.toMatchObject({
    reason: "unsupported_format",
  });
});

test.each(["prepare_claim", "respond_to_claim", "unconfirmed"] as const)(
  "native %s builder uses current IDs/material positions and exact UTF16 excerpt offsets",
  (purpose) => {
    const input = currentInput(purpose);
    const plan = syntheticLegalPlan(input);
    expect(plan.issues[0]?.factIds).toEqual(input.facts.map((fact) => fact.id));
    const prefix = "앞😀";
    const originals = [sample.law.body, sample.precedent.body].map((body) => `${prefix}${body}😀`);
    const sourceTexts = originals.map((body, index) => ({
      citationId: index === 0 ? "current_law" : "current_precedent",
      text: body.slice(prefix.length),
      startUtf16: prefix.length,
    }));
    const native = workspaceModelInput({
      ...input,
      plan,
      citations: [
        { id: "current_law", kind: "statute", officialId: "not-a-legal-number" },
        { id: "current_precedent", kind: "precedent", officialId: "not-a-legal-number" },
      ],
      sourceTexts,
    });
    const output = syntheticLegalDraft(native);
    expect(output.issues[0]?.requirements[0]?.factIds).toEqual(input.facts.map((fact) => fact.id));
    expect(output.issues[0]?.requirements[0]?.evidence).toEqual(
      input.materials.map((material) => material.reference),
    );
    expect(output.issues[0]?.requirements[0]?.assessment).toBe("insufficient");
    expect(output.evidenceRequirements[0]?.fileIds).toEqual(
      input.includedEvidence.map((file) => file.fileId),
    );
    expect(output.precedents[0]?.commonalities[0]?.factIds).toEqual(
      input.facts.map((fact) => fact.id),
    );
    expect(output.precedents[0]?.differences[0]?.factIds).toEqual(
      input.facts.map((fact) => fact.id),
    );
    for (const [index, claim] of output.sourceClaims.entries()) {
      expect(originals[index]?.slice(claim.startUtf16, claim.endUtf16)).toBe(claim.text);
      expect(claim.endUtf16 - claim.startUtf16).toBe(claim.text.length);
      expect(claim.text.length).toBeGreaterThan(Array.from(claim.text).length);
    }
    expect(output.perspective.casePurpose).toBe(purpose);
    expect(output.perspective.claimGaps.length > 0).toBe(purpose === "prepare_claim");
    expect(output.perspective.responsePoints.length > 0).toBe(purpose === "respond_to_claim");
    if (purpose === "respond_to_claim")
      expect(output.perspective.responsePoints[0]?.ourExplanation).toContain(
        input.facts[0]?.text ?? "",
      );
    expect(() => syntheticLegalDraft({ ...(native as object), sourceTexts: [] })).toThrow(
      "MISSING_SYNTHETIC_SOURCE_TEXT",
    );
    const renamed = structuredClone(input);
    if (!renamed.facts[0]) throw new Error("Missing synthetic fact");
    renamed.facts[0].id = "different_current_fact";
    const stale = {
      ...renamed,
      plan,
      citations: [
        { id: "current_law", kind: "statute" },
        { id: "current_precedent", kind: "precedent" },
      ],
      sourceTexts,
    };
    expect(() => syntheticLegalDraft(stale)).toThrow("UNKNOWN_SYNTHETIC_FACT");
  },
);

for (const purpose of ["prepare_claim", "respond_to_claim"] as const) {
  for (const mode of ["ready", "empty", "failure"] as const) {
    test(`external ${mode} adapters preserve real ${purpose} parsing, bindings, status and expiry`, async () => {
      const f = await legalAnalysisFixture();
      try {
        const input = currentInput(purpose);
        const requests: SyntheticLegalRequest[] = [];
        const retrieval = f.service(
          createSyntheticLegalTransport({ mode, onRequest: (request) => requests.push(request) }),
        );
        let time = NOW,
          analyzed = 0;
        const service = createAutomaticLegalAnalysis({
          model: {
            plan: async (value) => syntheticLegalPlan(workspaceModelInput(value)),
            analyze: async (value) => {
              analyzed++;
              return syntheticLegalDraft(workspaceModelInput(value));
            },
            // Explicit fake EXTERNAL auditor. Actual application validation runs afterward.
            audit: async () => ({
              pass: true,
              findings: [],
              unsupportedFactIds: [],
              legalClaimsSupported: true,
              strategyDetected: false,
            }),
          },
          retrieve: (request, access) => retrieval.retrieve(request, access),
          readBoundSources: async (ids, now) => {
            f.guard.now = now;
            return f.bound(ids);
          },
          authorize: f.access.authorize,
          reserveRequest: f.access.reserveRequest,
          clock: () => time,
        });
        const result = await service.prepare(input);
        expect(result.snapshot.status).toBe(
          mode === "ready" ? "ready" : mode === "empty" ? "empty" : "unavailable",
        );
        expect(analyzed).toBe(mode === "ready" ? 1 : 0);
        const before = requests.length;
        if (mode === "ready") {
          expect(
            await f.bound(result.sourceRetrieval.chunks.map((chunk) => chunk.citation.id)),
          ).toEqual(result.sourceRetrieval.chunks);
          expect(result.snapshot.basedOnFactIds).toEqual(input.facts.map((fact) => fact.id));
          time = "2026-10-07T00:00:00.001Z";
          await expect(service.prepare(input)).rejects.toMatchObject({
            code: "SOURCE_UNAVAILABLE",
          });
        } else {
          expect(result.snapshot.citations).toEqual([]);
          expect(
            result.sourceRetrieval.outcomes.every(
              (outcome) =>
                outcome.reason === (mode === "empty" ? "no_results" : "upstream_unavailable"),
            ),
          ).toBe(true);
          await service.prepare(input);
        }
        expect(requests).toHaveLength(before);
      } finally {
        f.db.close();
      }
    });
  }
}
