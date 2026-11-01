import { expect, test } from "bun:test";
import { v2LegalAnalysisSnapshotSchema } from "../src/contracts/v2/legal-analysis";
import { resolutionAnalysisIncluded } from "../src/server/modules/resolution/draft";
import { createResolutionService } from "../src/server/modules/resolution/service";
import { resolutionDraftIsCurrent, resolutionKindFits } from "../src/utils/resolution";
import scenarios from "./fixtures/resolution/scenarios.json";
import {
  resolutionHarness,
  resolutionMutation,
  resolutionNow,
  resolutionSource,
} from "./helpers/resolution-fixture";

async function self(h = resolutionHarness()) {
  const state = await h.service.get("owner", "case");
  return {
    h,
    state: await h.service.update("owner", "case", {
      ...resolutionMutation(state),
      action: "select",
      choice: "self",
      selectedFileIds: state.selectedFileIds,
      maskIdentifiers: state.maskIdentifiers,
    }),
  };
}
async function draft(h = resolutionHarness()) {
  const selected = await self(h);
  return {
    h,
    state: await h.service.prepareDraft("owner", "case", {
      ...resolutionMutation(selected.state),
      documentKind: "fact_statement",
      selectedFileIds: selected.state.selectedFileIds,
      maskIdentifiers: true,
      factsConfirmed: true,
    }),
  };
}
for (const purpose of scenarios.purposes)
  for (const choice of scenarios.paths)
    test(`${purpose} supports explicit ${choice} without a model or automatic external action`, async () => {
      const source = resolutionSource();
      source.context.casePurpose = purpose as typeof source.context.casePurpose;
      if (source.basis) source.basis.casePurpose = purpose as typeof source.basis.casePurpose;
      const h = resolutionHarness(source);
      const before = await h.service.get("owner", "case");
      const next = await h.service.update("owner", "case", {
        ...resolutionMutation(before),
        action: "select",
        choice,
        selectedFileIds: before.selectedFileIds,
        maskIdentifiers: true,
      });
      expect(String(next.selection)).toBe(choice);
      expect(next.draft).toBeNull();
      expect(h.writes).toHaveLength(1);
      if (purpose === "respond_to_claim")
        expect(next.procedureChecks.find((c) => c.id === "public-defender")?.detail).toContain(
          "보장하지 않습니다",
        );
    });
test("no official procedure means confirmation actions and factual draft with explicit missing fields", async () => {
  const { state } = await draft();
  const body = state.draft?.content ?? "";
  for (const field of ["인적사항", "사건 날짜", "관할", "제출 기한", "적용 서식"])
    expect(body).toContain(`[미입력: ${field === "인적사항" ? "작성인 인적사항" : field}]`);
  expect(state.allowedDocumentKinds).toEqual(["fact_statement"]);
  expect(state.procedureChecks.every((c) => c.status !== "verified")).toBe(true);
  expect(body).toContain("수령 확인 문자를 보냈다고");
  expect(body).not.toContain("확인되지 않은 날짜를 확정");
  expect(body).not.toContain("제외한 합성");
  expect(body).not.toContain("010-1234-5678");
  expect(body).not.toContain("synthetic@example.invalid");
});
test("server report scope rejects excluded files, missing confirmation and unmasking", async () => {
  const { h, state } = await self();
  const request = {
    ...resolutionMutation(state),
    documentKind: "fact_statement",
    selectedFileIds: state.selectedFileIds,
    maskIdentifiers: true,
    factsConfirmed: true,
  };
  await expect(
    h.service.prepareDraft("owner", "case", { ...request, selectedFileIds: ["excluded-file"] }),
  ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  await expect(
    h.service.prepareDraft("owner", "case", { ...request, maskIdentifiers: false }),
  ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  await expect(
    h.service.prepareDraft("owner", "case", { ...request, factsConfirmed: false }),
  ).rejects.toThrow();
  expect(h.writes).toHaveLength(1);
});
test("document eligibility distinguishes criminal/civil, purpose and actual stage, and still requires official proof", async () => {
  const source = resolutionSource();
  const basis = source.basis;
  if (!basis) throw Error("fixture");
  expect(resolutionKindFits("criminal_complaint", basis)).toBe(false);
  expect(resolutionKindFits("civil_claim", basis)).toBe(true);
  basis.casePurpose = "respond_to_claim";
  basis.procedure = { kind: "criminal", stage: "investigation", description: null };
  expect(resolutionKindFits("statement", basis)).toBe(true);
  expect(resolutionKindFits("appeal", basis)).toBe(false);
  basis.procedure.stage = "first_instance";
  expect(resolutionKindFits("opinion", basis)).toBe(true);
  expect(resolutionKindFits("appeal", basis)).toBe(false);
  basis.procedure.stage = "appeal";
  expect(resolutionKindFits("appeal", basis)).toBe(true);
  expect(resolutionKindFits("final_appeal", basis)).toBe(false);
  basis.procedure.stage = "final_appeal";
  expect(resolutionKindFits("final_appeal", basis)).toBe(true);
  const { h, state } = await self();
  await expect(
    h.service.prepareDraft("owner", "case", {
      ...resolutionMutation(state),
      documentKind: "civil_claim",
      selectedFileIds: [],
      maskIdentifiers: true,
      factsConfirmed: true,
    }),
  ).rejects.toMatchObject({ code: "POLICY_REJECTED" });
});
test("verified guide support permits the matching document but never a defense-implied appeal", async () => {
  const source = resolutionSource();
  source.citations = [
    {
      id: "guide",
      sourceId: "source",
      title: "합성 서식 안내",
      verifiedAt: resolutionNow,
      contentHash: "c".repeat(64),
      kind: "official_guide",
      institutionId: "moleg_easylaw",
      endpointId: "easylaw_text_section",
      section: "합성검증",
      publishedDate: null,
      url: "https://www.easylaw.go.kr/CSP/CnpClsMain.laf",
    },
  ];
  source.sourceClaims = [
    {
      id: "form-claim",
      text: "합성 서식 안내",
      kind: "quotation",
      citationId: "guide",
      startUtf16: 0,
      endUtf16: 8,
    },
  ];
  source.documentSupport = [
    { documentKind: "civil_claim", sourceClaimIds: ["form-claim"] },
    { documentKind: "appeal", sourceClaimIds: ["form-claim"] },
  ];
  source.procedureChecks = [
    {
      id: "form",
      label: "서식",
      detail: "합성 서식 안내",
      status: "verified",
      sourceClaimIds: ["form-claim"],
    },
  ];
  const { h, state } = await self(resolutionHarness(source));
  expect(state.allowedDocumentKinds).toEqual(["fact_statement", "civil_claim"]);
  const next = await h.service.prepareDraft("owner", "case", {
    ...resolutionMutation(state),
    documentKind: "civil_claim",
    selectedFileIds: state.selectedFileIds,
    maskIdentifiers: true,
    factsConfirmed: true,
  });
  expect(next.draft?.documentKind).toBe("civil_claim");
  expect(next.citations[0]?.verifiedAt).toBe(resolutionNow);
});
test("reviewed save, edits, pause, path switches and reconnect preserve the saved draft", async () => {
  const { h, state } = await draft();
  const d = state.draft;
  if (!d) throw Error("fixture");
  await expect(
    h.service.update("owner", "case", {
      ...resolutionMutation(state),
      action: "save_draft",
      draftId: d.id,
      draftRevision: 1,
      content: d.content,
      reviewed: false,
    }),
  ).rejects.toThrow();
  let current = await h.service.update("owner", "case", {
    ...resolutionMutation(state),
    action: "save_draft",
    draftId: d.id,
    draftRevision: 1,
    content: `${d.content}\n사용자 수정 010-1234-5678`,
    reviewed: true,
  });
  expect(current.draft?.status).toBe("saved");
  expect(current.draft?.userEdited).toBe(true);
  expect(current.draft?.content).not.toContain("010-1234-5678");
  current = await h.service.update("owner", "case", {
    ...resolutionMutation(current),
    action: "pause",
  });
  expect(current.status).toBe("paused");
  current = await h.service.update("owner", "case", {
    ...resolutionMutation(current),
    action: "resume",
  });
  current = await h.service.update("owner", "case", {
    ...resolutionMutation(current),
    action: "select",
    choice: "lawyer",
    selectedFileIds: current.selectedFileIds,
    maskIdentifiers: true,
  });
  const reopened = await createResolutionService(h.deps).get("owner", "case");
  expect(reopened.selection).toBe("lawyer");
  expect(reopened.draft).toEqual(current.draft);
});
test("semantic revisions invalidate old drafts while metadata-only workspace writes do not", async () => {
  const { h, state } = await draft();
  if (!h.source.basis) throw Error("fixture");
  const basis = h.source.basis;
  h.source = { ...h.source, basis: { ...basis, workspaceRevision: 10 } };
  expect(resolutionDraftIsCurrent(await h.service.get("owner", "case"))).toBe(true);
  h.source = { ...h.source, basis: { ...basis, researchRevision: 2 } };
  const stale = await h.service.get("owner", "case");
  expect(stale.status).toBe("stale");
  expect(stale.draft).toEqual(state.draft);
  expect(resolutionDraftIsCurrent(stale)).toBe(false);
  const d = stale.draft;
  if (!d) throw Error("fixture");
  await expect(
    h.service.update("owner", "case", {
      ...resolutionMutation(stale),
      action: "save_draft",
      draftId: d.id,
      draftRevision: d.revision,
      content: d.content,
      reviewed: true,
    }),
  ).rejects.toMatchObject({ code: "STALE_REVISION" });
});
test("scope change invalidates the old draft and removes excluded factual dependencies", async () => {
  const { h, state } = await draft();
  const next = await h.service.update("owner", "case", {
    ...resolutionMutation(state),
    action: "select",
    choice: "self",
    selectedFileIds: [],
    maskIdentifiers: true,
  });
  expect(resolutionDraftIsCurrent(next)).toBe(false);
  expect(next.consultationPreparation.join(" ")).not.toContain("선택한 자료:");
  const newer = await h.service.prepareDraft("owner", "case", {
    ...resolutionMutation(next),
    documentKind: "fact_statement",
    selectedFileIds: [],
    maskIdentifiers: true,
    factsConfirmed: true,
  });
  expect(newer.draft?.content).not.toContain("합성 연락처");
});
test("owner/deletion/consent fences reject writes but consent does not erase saved reads", async () => {
  const { h, state } = await draft();
  h.setConsent(false);
  expect((await h.service.get("owner", "case")).draft?.id).toBe(state.draft?.id);
  await expect(
    h.service.update("owner", "case", { ...resolutionMutation(state), action: "pause" }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(h.service.get("other-owner", "case")).rejects.toMatchObject({ code: "NOT_FOUND" });
  h.setAccess(false);
  await expect(h.service.get("owner", "case")).rejects.toMatchObject({ code: "NOT_FOUND" });
});
test("optional audited generation receives only selected/masked facts and cannot publish after revocation or CAS loss", async () => {
  const h = resolutionHarness();
  let captured = "";
  h.deps.auditedDraft = async ({ source, template }) => {
    captured = JSON.stringify(source);
    h.setAccess(false);
    return template;
  };
  const selected = await self(h);
  await expect(
    h.service.prepareDraft("owner", "case", {
      ...resolutionMutation(selected.state),
      documentKind: "fact_statement",
      selectedFileIds: selected.state.selectedFileIds,
      maskIdentifiers: true,
      factsConfirmed: true,
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(captured).not.toContain("excluded-file");
  expect(captured).not.toContain("010-1234-5678");
  expect(captured).not.toContain("확인되지 않은 날짜를 확정");
  expect(h.writes).toHaveLength(1);
});
test("missing or mismatched analysis evidence cannot be reused in a narrowed draft", () => {
  expect(resolutionAnalysisIncluded(resolutionSource(), [])).toBe(false);
});
test("each supported weakness connects its required facts/materials, and excluded analysis disappears", async () => {
  const source = resolutionSource();
  const basis = source.basis;
  if (!basis) throw Error("fixture");
  source.analysis = v2LegalAnalysisSnapshotSchema().parse({
    contractVersion: "conversation-report-v1",
    id: "analysis",
    basis: {
      researchRevision: 1,
      summaryRevision: 1,
      evidenceHash: basis.evidenceHash,
      casePurpose: basis.casePurpose,
    },
    context: source.context,
    basedOnFactIds: ["confirmed-event"],
    includedEvidence: [{ fileId: "selected-file", fileRevision: 2, contentHash: "b".repeat(64) }],
    asOfDate: "2026-11-01",
    checkedAt: resolutionNow,
    status: "partial",
    issues: [
      {
        id: "issue",
        title: "합성 쟁점",
        requirements: [
          {
            id: "requirement",
            label: "합성 요건",
            assessment: "insufficient",
            sourceClaimIds: ["claim"],
            factIds: ["confirmed-event"],
            conflictingFactIds: [],
            evidence: [],
            gaps: ["수령 확인 메시지의 원문·작성 시점 확인"],
          },
        ],
      },
    ],
    precedents: [],
    sourceClaims: [
      {
        id: "claim",
        text: "합성 원문",
        kind: "quotation",
        citationId: "law",
        startUtf16: 0,
        endUtf16: 5,
      },
    ],
    citations: [
      {
        id: "law",
        sourceId: "public-source",
        title: "합성 법령",
        verifiedAt: resolutionNow,
        contentHash: "c".repeat(64),
        kind: "statute",
        officialId: "synthetic-law",
        article: "합성 조항",
        effectiveDate: "2026-01-01",
        url: "https://www.law.go.kr/법령/합성",
      },
    ],
    retrievalHash: "d".repeat(64),
    perspective: {
      casePurpose: basis.casePurpose,
      weaknesses: ["수령 확인 진술과 미수령 진술이 다름"],
      claimGaps: [],
      responsePoints: [
        {
          opponentPosition: "수령 확인 메시지",
          ourExplanation: "실제 수령 여부 확인 필요",
          conflictingFactIds: [],
          sourceClaimIds: ["claim"],
          additionalMaterials: ["메시지 전후 대화와 실제 배송 기록"],
        },
      ],
      additionalMaterials: [],
    },
    evidenceRequirements: [],
    limitations: ["합성 자료이며 실제 법적 적용을 확인하지 않습니다."],
    availability: [
      { kind: "statute", status: "verified", reason: null },
      { kind: "official_guide", status: "unavailable", reason: "configuration_missing" },
    ],
  });
  source.citations = source.analysis.citations;
  source.sourceClaims = source.analysis.sourceClaims;
  const { h, state } = await self(resolutionHarness(source));
  expect(state.weaknessChecks.join(" ")).toContain("메시지 전후 대화와 실제 배송 기록");
  expect(state.weaknessChecks.join(" ")).toContain("수령 확인 메시지의 원문·작성 시점 확인");
  const narrowed = await h.service.update("owner", "case", {
    ...resolutionMutation(state),
    action: "select",
    choice: "self",
    selectedFileIds: [],
    maskIdentifiers: true,
  });
  expect(narrowed.weaknessChecks).toEqual([]);
  expect(narrowed.sourceClaims).toEqual([]);
});
test("a failed final atomic claim cannot publish or replace the previous draft", async () => {
  const h = resolutionHarness();
  const selected = await self(h);
  h.deps.saveCAS = async () => false;
  await expect(
    h.service.prepareDraft("owner", "case", {
      ...resolutionMutation(selected.state),
      documentKind: "fact_statement",
      selectedFileIds: [],
      maskIdentifiers: true,
      factsConfirmed: true,
    }),
  ).rejects.toMatchObject({ code: "STALE_REVISION" });
  expect(h.source.stored?.draft).toBeNull();
});
test("losing current analysis preserves the previous draft as unavailable for current generation", async () => {
  const { h, state } = await draft();
  h.source = { ...h.source, basis: null, analysis: null };
  const next = await h.service.get("owner", "case");
  expect(next.status).toBe("not_ready");
  expect(next.draft).toEqual(state.draft);
  expect(resolutionDraftIsCurrent(next)).toBe(false);
});
