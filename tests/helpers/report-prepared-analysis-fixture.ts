import { expect } from "bun:test";
import { snapshotStatements } from "../../src/server/db/v2-core";
import { createV2OfficialSourceRepository } from "../../src/server/db/v2-official-sources";
import { OFFICIAL_CATALOG } from "../../src/server/modules/legal-retrieval/v2/registry";
import { makeChunk } from "../../src/server/modules/legal-retrieval/v2/source";
import { reportFile } from "../../src/server/modules/reports/source";
import { readyFile, reportFixture } from "./report-fixture";

/** Synthetic, encrypted repository fixture. The DI callback in a test stands in
 * for the authorized analysis loader; it never invokes a model or legal API. */
export async function reportPreparedAnalysisFixture(
  purpose: "prepare_claim" | "respond_to_claim" = "prepare_claim",
) {
  const f = await reportFixture();
  const upload = await readyFile(f, "합성 자료 관찰용 비공개 표식");
  const fileId = upload.session.fileId;
  const factId = "synthetic-rework-material-fact";
  const claim = crypto.randomUUID();
  const snapshotId = crypto.randomUUID();
  const summaryId = crypto.randomUUID();
  const material = {
    kind: "user_material" as const,
    fileId,
    fileRevision: 2,
    position: { kind: "document" as const, page: 1 },
  };
  await f.core.binding.batch([
    f.core.claim({ ...f.actor, workspaceId: f.workspaceId, expectedRevision: f.rev() }, claim),
    ...(await snapshotStatements(
      f.core,
      {
        id: snapshotId,
        ownerId: f.actor.ownerId,
        workspaceId: f.workspaceId,
        targetId: f.workspaceId,
        revision: 2,
        purpose: "summary",
        now: f.actor.now,
      },
      {
        schemaVersion: "2",
        revision: 2,
        intakeRevision: 1,
        createdAt: f.actor.now,
        overview: "합성 자료 관찰용 비공개 표식이 포함된 사건 개요",
        facts: [
          {
            id: factId,
            text: "합성 자료 관찰용 비공개 표식",
            attribution: "user_material",
            certainty: "observed",
            significance: "neutral",
            references: [material],
            conflictingFactIds: [],
            userEdited: false,
          },
        ],
        parties: [],
        unknowns: ["반환 조건의 전체 맥락"],
        notices: ["합성 검증 전용"],
      },
      claim,
    )),
    f.core.finish(claim),
  ]);
  f.db.sqlite
    .query(
      "INSERT INTO v2_summaries(id,workspace_id,revision,intake_revision,snapshot_id,created_at) VALUES(?,?,2,1,?,?)",
    )
    .run(summaryId, f.workspaceId, snapshotId, f.actor.now);
  f.db.sqlite
    .query("UPDATE v2_intakes SET summary_id=?,confirmed_summary_revision=2 WHERE id=?")
    .run(summaryId, f.workspaceId);
  f.db.sqlite
    .query("UPDATE v2_workspaces SET confirmed_summary_revision=2 WHERE id=?")
    .run(f.workspaceId);
  const common = {
    title: "합성 원문 검증 전용",
    sourceDate: "2026-10-01",
    fetchedAt: f.actor.now,
    verifiedAt: f.actor.now,
    institutionId: null,
    endpointId: null,
  };
  const statute = await makeChunk(
    {
      ...common,
      sourceType: "statute",
      officialId: "1706",
      version: "284415",
      section: "제1조",
      canonicalUrl: "https://law.go.kr/LSW/lsInfoP.do?lsiSeq=284415",
      body: "합성 조항 원문: 반환 조건의 **원문 기호**와 `코드 기호`를 그대로 확인한다.",
      rightsProvenance: OFFICIAL_CATALOG.find((entry) => entry.type === "statute")?.rights ?? "",
      court: null,
      caseNumber: null,
    },
    f.actor.now.slice(0, 10),
  );
  const precedent = await makeChunk(
    {
      ...common,
      sourceType: "precedent",
      officialId: "900001",
      version: "decision_2026-10-01",
      section: "판시사항",
      canonicalUrl: "https://www.law.go.kr/LSW/precInfoP.do?precSeq=900001",
      body: "합성 판례 원문: 송금 기록과 반환 약정은 ~~서로 구별~~하여 확인한다.",
      rightsProvenance: OFFICIAL_CATALOG.find((entry) => entry.type === "precedent")?.rights ?? "",
      court: "합성 법원",
      caseNumber: "2026가합00000",
    },
    f.actor.now.slice(0, 10),
  );
  const repo = createV2OfficialSourceRepository(f.core);
  for (const chunk of [statute, precedent]) {
    expect(await repo.put(chunk.source, chunk.citation)).toBe(true);
    expect(
      await repo.bindCitation(
        { ...f.actor, workspaceId: f.workspaceId, expectedRevision: f.rev() },
        chunk.citation,
      ),
    ).toBe(true);
  }
  const sourceClaims = [statute, precedent].map((chunk, index) => ({
    id: `synthetic-rework-claim-${index}`,
    kind: "quotation" as const,
    text: chunk.source.body,
    citationId: chunk.citation.id,
    startUtf16: 0,
    endUtf16: chunk.source.body.length,
  }));
  const file = await reportFile(f.core, f.actor, fileId);
  if (!file?.manifest) throw new Error("Synthetic manifest missing");
  const snapshot = {
    contractVersion: "conversation-report-v1" as const,
    id: crypto.randomUUID(),
    basis: {
      researchRevision: f.rev(),
      summaryRevision: 2,
      evidenceHash: file.manifest.contentHash,
      casePurpose: purpose,
    },
    context: {
      casePurpose: purpose,
      subjectContext: "individual" as const,
      procedure: {
        kind: "civil" as const,
        stage: "before_filing" as const,
        description: "사용자가 확인한 합성 절차",
      },
    },
    basedOnFactIds: [factId],
    includedEvidence: [{ fileId, fileRevision: 2, contentHash: file.manifest.contentHash }],
    asOfDate: f.actor.now.slice(0, 10),
    checkedAt: f.actor.now,
    status: "ready" as const,
    citations: [statute.citation, precedent.citation],
    retrievalHash: "a".repeat(64),
    availability: [
      { kind: "statute" as const, status: "verified" as const, reason: null },
      { kind: "precedent" as const, status: "verified" as const, reason: null },
    ],
    issues: [
      {
        id: "synthetic-rework-issue",
        title: "반환 약정의 성립",
        requirements: [
          {
            id: "synthetic-rework-requirement",
            label: "반환 약정과 이행 조건",
            assessment: "insufficient" as const,
            sourceClaimIds: [sourceClaims[0]?.id ?? ""],
            factIds: [factId],
            conflictingFactIds: [],
            evidence: [material],
            gaps: ["합성 자료 관찰용 비공개 표식의 원본 대화 확인 필요"],
          },
        ],
      },
    ],
    precedents: [
      {
        citationId: precedent.citation.id,
        commonalities: [
          {
            text: "합성 자료 관찰용 비공개 표식의 송금 경위가 공통입니다.",
            factIds: [factId],
            sourceClaimIds: [sourceClaims[1]?.id ?? ""],
          },
        ],
        differences: [
          {
            text: "판례에는 서명 원본이 있으나 사건에는 원본을 확인하지 못했습니다.",
            factIds: [factId],
            sourceClaimIds: [sourceClaims[1]?.id ?? ""],
          },
        ],
        preparationMeaning: "서명과 대화 원본을 추가로 확인해야 합니다.",
      },
    ],
    perspective: {
      casePurpose: purpose,
      weaknesses: ["합성 자료 관찰용 비공개 표식만으로 반환 약정 전체를 확인하기 어렵습니다."],
      claimGaps: purpose === "prepare_claim" ? ["청구할 반환 조건과 이행기를 확인합니다."] : [],
      responsePoints:
        purpose === "respond_to_claim"
          ? [
              {
                opponentPosition: "상대방은 반환 약정을 주장합니다.",
                ourExplanation: "증여 또는 정산이었다는 우리 설명의 근거를 확인합니다.",
                conflictingFactIds: [],
                sourceClaimIds: [sourceClaims[0]?.id ?? ""],
                additionalMaterials: ["거래 목적을 확인할 원본 대화"],
              },
            ]
          : [],
      additionalMaterials: ["반환 약정의 전체 대화 원본"],
    },
    evidenceRequirements: [
      {
        id: "synthetic-rework-evidence-request",
        kind: "conversation" as const,
        label: "반환 조건 원본 대화",
        reason:
          purpose === "prepare_claim"
            ? "청구할 약정 내용을 확인하기 위해 필요합니다."
            : "인정하는 사실과 다투는 사실을 나누기 위해 필요합니다.",
        fileIds: [fileId],
      },
    ],
    sourceClaims,
    limitations: ["합성 검증 전용이며 실제 공급자 인수가 아닙니다."],
  };
  return {
    ...f,
    fileId,
    factId,
    material,
    statute,
    precedent,
    sourceClaims,
    purpose,
    originalHash: file.manifest.contentHash,
    snapshot,
  };
}
