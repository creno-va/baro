import {
  legalFailureMessages,
  type V2LegalAnalysisSnapshot,
  type V2ReportBody,
  v2LegalAnalysisSnapshotSchema,
  v2ReportBodySchema,
} from "../../../contracts/v2";
import type { Actor, V2Core } from "../../db/v2-core";
import { BOUND_SOURCE_BATCH_SIZE, readBoundSourceBatch } from "../legal-retrieval/v2/bound-sources";
import { GUIDE_HOSTS } from "../legal-retrieval/v2/registry";
import type { ReportAnalysisReview } from "./analysis-review";
import { ReportError, sourcePositionText } from "./source";

export { type ReportAnalysisSummary, reportAnalysisSummary } from "./analysis-review";

export function reportAnalysisIdentity(snapshot: V2LegalAnalysisSnapshot | null) {
  return snapshot ? JSON.stringify([snapshot.id, snapshot.basis, snapshot.retrievalHash]) : null;
}
export const missingReportAnalysis = (): ReportAnalysisReview => ({
  snapshot: null,
  status: "review_required",
  userEdited: false,
  excerpts: [],
});

/** The injected loader only reads an already audited, authorized immutable result.
 * Recheck exact bound originals locally; never discover sources or call a model. */
export async function bindPreparedReportAnalysis(
  core: V2Core,
  actor: Actor,
  caseId: string,
  body: V2ReportBody,
  summaryRevision: number,
  input: V2LegalAnalysisSnapshot | null,
  maskIdentifiers = false,
  guideHosts: readonly string[] = GUIDE_HOSTS,
) {
  if (!input || maskIdentifiers) return { body, analysis: missingReportAnalysis() };
  const snapshot = v2LegalAnalysisSnapshotSchema(guideHosts).parse(input);
  if (
    snapshot.basis.summaryRevision !== summaryRevision ||
    snapshot.basedOnFactIds.some((id) => !body.facts.some((fact) => fact.id === id)) ||
    snapshot.includedEvidence.some(
      (item) =>
        !body.selectedFiles.some(
          (file) =>
            file.id === item.fileId &&
            file.revision === item.fileRevision &&
            file.contentHash === item.contentHash,
        ),
    )
  )
    return { body, analysis: missingReportAnalysis() };
  const excerpts: ReportAnalysisReview["excerpts"] = [];
  for (let offset = 0; offset < snapshot.citations.length; offset += BOUND_SOURCE_BATCH_SIZE) {
    const citations = snapshot.citations.slice(offset, offset + BOUND_SOURCE_BATCH_SIZE);
    const sources = await readBoundSourceBatch(
      core,
      caseId,
      citations.map((citation) => citation.id),
      actor.now,
      guideHosts,
    );
    for (const [index, citation] of citations.entries()) {
      const source = sources[index];
      if (!source || JSON.stringify(source.citation) !== JSON.stringify(citation))
        throw new ReportError("LEGAL_SOURCE_UNAVAILABLE");
      for (const claim of snapshot.sourceClaims.filter(
        (claim) => claim.citationId === citation.id,
      )) {
        const scalarBoundary = (position: number) =>
          !(
            position > 0 &&
            position < source.source.body.length &&
            /[\uD800-\uDBFF]/u.test(source.source.body[position - 1] ?? "") &&
            /[\uDC00-\uDFFF]/u.test(source.source.body[position] ?? "")
          );
        if (
          claim.endUtf16 > source.source.body.length ||
          !scalarBoundary(claim.startUtf16) ||
          !scalarBoundary(claim.endUtf16)
        )
          throw new ReportError("LEGAL_SOURCE_UNAVAILABLE");
        const original = source.source.body.slice(claim.startUtf16, claim.endUtf16);
        if (claim.kind === "quotation" && original !== claim.text)
          throw new ReportError("LEGAL_SOURCE_UNAVAILABLE");
        let end = Math.min(
          claim.endUtf16,
          claim.startUtf16 + (claim.kind === "quotation" ? 10000 : 2000),
        );
        if (!scalarBoundary(end)) end--;
        excerpts.push({ claimId: claim.id, text: source.source.body.slice(claim.startUtf16, end) });
      }
    }
  }
  const merged = new Map(body.citations.map((citation) => [citation.id, citation]));
  for (const citation of snapshot.citations) {
    const existing = merged.get(citation.id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(citation))
      throw new ReportError("LEGAL_SOURCE_UNAVAILABLE");
    merged.set(citation.id, citation);
  }
  if (merged.size > 50) throw new ReportError("EXPORT_LIMIT_EXCEEDED");
  return {
    body: v2ReportBodySchema(guideHosts).parse({
      ...body,
      citations: [...merged.values()],
      legalSourceStatus: merged.size ? "verified" : body.legalSourceStatus,
    }),
    analysis: {
      snapshot,
      status:
        snapshot.status === "ready" &&
        (snapshot.context.casePurpose === "unconfirmed" ||
          snapshot.context.procedure.kind === "unconfirmed" ||
          snapshot.context.procedure.stage === "unconfirmed")
          ? ("partial" as const)
          : snapshot.status,
      userEdited: false,
      excerpts,
    } satisfies ReportAnalysisReview,
  };
}

const bullet = (text: string) => `- ${text.replace(/\r?\n/gu, "\n  ")}`;
const heading = (text: string) => `### ${text.replace(/[\r\n]/gu, " ")}`;
const purposeLabels = {
  prepare_claim: "고소·청구를 준비하는 쪽",
  respond_to_claim: "상대방 주장에 대응하는 쪽",
  unconfirmed: "사건 입장 미확인",
};
const kindLabels = {
  civil: "민사",
  criminal: "형사",
  family: "가사",
  administrative: "행정",
  labor: "노동",
  other: "기타",
  unconfirmed: "사건 분야 미확인",
};
const stageLabels = {
  before_filing: "신고·제소 전",
  investigation: "수사 중",
  first_instance: "1심",
  appeal: "항소",
  final_appeal: "상고",
  enforcement: "집행",
  other: "기타 단계",
  unconfirmed: "절차 단계 미확인",
};
export const reportAnalysisStatusLabels = {
  ready: "완성 · 법 조항과 판례 비교를 확인한 리포트",
  partial: "보완 필요 · 확인된 분석과 미확인 항목을 함께 표시합니다.",
  empty: "보완 필요 · 조사한 범위에서 관련 법률·판례 결과를 찾지 못했습니다.",
  unavailable: "실패 · 공식 자료를 확인하지 못해 법률·판례 분석을 완성하지 못했습니다.",
  review_required: "보완 필요 · 현재 사건과 선택 자료에 맞는 검증 분석이 필요합니다.",
};

/** One canonical editable body for web, HTML and PDF. Citations alone never
 * become issue analysis or a precedent comparison. Every assertion is projected
 * from the stored result, with exact original excerpts kept literal. */
export function reportAnalysisText(body: V2ReportBody, base: string, review: ReportAnalysisReview) {
  const snapshot = review.snapshot;
  const citations = new Map(snapshot?.citations.map((citation) => [citation.id, citation]) ?? []);
  const claims = new Map(
    snapshot?.sourceClaims.map((claim, index) => [claim.id, { ...claim, number: index + 1 }]) ?? [],
  );
  const support = (ids: readonly string[]) =>
    ids
      .flatMap((id) => {
        const claim = claims.get(id);
        return claim ? [`근거 ${claim.number}`] : [];
      })
      .join(" / ");
  const facts = (ids: readonly string[]) =>
    ids.flatMap((id) => {
      const index = body.facts.findIndex((fact) => fact.id === id);
      const fact = body.facts[index];
      return fact ? [bullet(`사실 ${index + 1} · ${fact.text}`)] : [];
    });
  const evidence = (
    items: {
      fileId: string;
      fileRevision: number;
      position: Parameters<typeof sourcePositionText>[0];
    }[],
  ) =>
    items.flatMap((item) => {
      const index = body.selectedFiles.findIndex(
        (file) => file.id === item.fileId && file.revision === item.fileRevision,
      );
      return index < 0 ? [] : [bullet(`증거 ${index + 1} · ${sourcePositionText(item.position)}`)];
    });
  const lines = [
    "리포트 준비 상태",
    review.userEdited
      ? "보완 필요 · 사용자가 수정한 리포트입니다. 편집한 본문과 인용은 원문을 다시 확인해 주세요."
      : reportAnalysisStatusLabels[review.status],
    "",
    ...(snapshot
      ? [
          "사건 입장과 절차",
          `${purposeLabels[snapshot.context.casePurpose]} · ${kindLabels[snapshot.context.procedure.kind]} · ${stageLabels[snapshot.context.procedure.stage]}`,
          ...(snapshot.context.procedure.description
            ? [bullet(snapshot.context.procedure.description)]
            : []),
          "",
        ]
      : [
          "사건 입장과 절차",
          "사건 입장과 절차 단계는 검증된 분석에서 아직 확인하지 못했습니다.",
          "",
        ]),
    base,
    "",
    "법적 쟁점과 법 조항",
    ...(snapshot?.issues.length
      ? snapshot.issues.flatMap((issue) => [
          heading(issue.title),
          ...issue.requirements.flatMap((requirement) => [
            heading(
              `${requirement.label} · ${{ supported: "근거 연결됨", insufficient: "요건 확인 필요", conflicting: "상반된 사실 확인 필요" }[requirement.assessment]}`,
            ),
            bullet(`관련 법 조항 · ${support(requirement.sourceClaimIds)}`),
            ...facts(requirement.factIds),
            ...evidence(requirement.evidence),
            ...facts(requirement.conflictingFactIds).map((line) =>
              line.replace(/^- /u, "- 상반된 내용 · "),
            ),
            ...requirement.gaps.map((gap) => bullet(`미확인 요건 · ${gap}`)),
          ]),
          "",
        ])
      : [
          reportAnalysisStatusLabels[review.status === "ready" ? "review_required" : review.status],
        ]),
    "",
    "판례별 공통점과 차이점",
    ...(snapshot?.precedents.length
      ? snapshot.precedents.flatMap((precedent) => {
          const citation = citations.get(precedent.citationId);
          return [
            heading(
              citation?.kind === "precedent"
                ? `${citation.court} ${citation.caseNumber} · ${citation.title}`
                : "검증한 판례",
            ),
            ...precedent.commonalities.flatMap((item) => [
              bullet(`공통점 · ${item.text} (${support(item.sourceClaimIds)})`),
              ...facts(item.factIds),
            ]),
            ...precedent.differences.flatMap((item) => [
              bullet(`차이점 · ${item.text} (${support(item.sourceClaimIds)})`),
              ...facts(item.factIds),
            ]),
            bullet(`이 사건에서의 의미 · ${precedent.preparationMeaning}`),
            "",
          ];
        })
      : [
          snapshot?.availability.some(
            (item) => item.kind === "precedent" && item.status === "empty",
          )
            ? "조사한 범위에서 관련 판례를 찾지 못했습니다. 다른 사실과 자료를 확인한 뒤 다시 분석해 주세요."
            : "판례의 공통점과 차이점을 확인하지 못했습니다. 출처 목록만으로 비교를 완성하지 않습니다.",
        ]),
    "",
    "우리 측 약점과 보완",
    ...(snapshot
      ? [
          ...snapshot.perspective.weaknesses.map((text) => bullet(`약점 · ${text}`)),
          ...(snapshot.perspective.casePurpose === "prepare_claim"
            ? snapshot.perspective.claimGaps.map((text) => bullet(`청구 준비 · ${text}`))
            : []),
          ...(snapshot.perspective.casePurpose === "respond_to_claim"
            ? snapshot.perspective.responsePoints.flatMap((point) => [
                bullet(`상대방 주장 · ${point.opponentPosition}`),
                bullet(
                  `우리 측 설명·대응점 · ${point.ourExplanation}${point.sourceClaimIds.length ? ` (${support(point.sourceClaimIds)})` : ""}`,
                ),
                ...facts(point.conflictingFactIds),
                ...point.additionalMaterials.map((text) => bullet(`보완 자료 · ${text}`)),
              ])
            : []),
          ...snapshot.perspective.additionalMaterials.map((text) => bullet(`필요 자료 · ${text}`)),
        ]
      : ["선택 자료에 맞는 분석을 준비한 뒤 약점과 보완 방법을 다시 검토해야 합니다."]),
    "",
    "다음 행동과 필요 자료",
    ...body.actions.flatMap((action) => [
      heading(action.title),
      bullet(action.instructions),
      bullet(action.caution),
    ]),
    ...(snapshot?.evidenceRequirements.flatMap((item) => [
      heading(item.label),
      bullet(item.reason),
      ...item.fileIds.flatMap((id) => {
        const index = body.selectedFiles.findIndex((file) => file.id === id);
        return index < 0 ? [] : [bullet(`확인할 자료 위치 · 증거 ${index + 1}`)];
      }),
    ]) ?? []),
    ...(!body.actions.length && !snapshot?.evidenceRequirements.length
      ? ["현재 사건의 미확인 사항과 자료를 보완한 뒤 다음 행동을 준비해 주세요."]
      : []),
    "",
    "출처와 분석 기준",
    ...(snapshot
      ? [
          bullet(`분석 기준일 · ${snapshot.asOfDate} / 실제 확인 시각 · ${snapshot.checkedAt}`),
          bullet(
            `확인 요약 버전 ${snapshot.basis.summaryRevision} · 사건 분석 버전 ${snapshot.basis.researchRevision}`,
          ),
          ...snapshot.sourceClaims.flatMap((claim, index) => {
            const citation = citations.get(claim.citationId);
            if (!citation) return [];
            const excerpt = review.excerpts.find((item) => item.claimId === claim.id);
            return [
              heading(`근거 ${index + 1} · ${citation.title}`),
              bullet(
                citation.kind === "statute"
                  ? `${citation.article} · 시행일 ${citation.effectiveDate}`
                  : citation.kind === "precedent"
                    ? `${citation.court} ${citation.caseNumber} · 선고일 ${citation.decisionDate}`
                    : `${citation.section} · 공개일 ${citation.publishedDate ?? "미확인"}`,
              ),
              ...(claim.kind === "legal_explanation"
                ? [bullet(`검증된 설명 · ${claim.text}`)]
                : []),
              ...(excerpt ? excerpt.text.split(/\r?\n/u).map((line) => `> [원문] ${line}`) : []),
              bullet(`공식 원문 · ${citation.url}`),
              bullet(
                `검증 시각 · ${citation.verifiedAt} · 원문 범위 UTF-16 ${claim.startUtf16}–${claim.endUtf16}${excerpt && excerpt.text.length < claim.endUtf16 - claim.startUtf16 ? " 중 일부 발췌" : ""}`,
              ),
              "",
            ];
          }),
          ...snapshot.availability
            .filter((item) => item.status !== "verified")
            .map((item) =>
              bullet(
                `${{ statute: "법령", precedent: "판례", official_guide: "공식 안내" }[item.kind]} · ${item.status === "empty" ? "관련 결과 없음" : item.status === "limited" ? "일부 확인" : "확인 실패"}${item.reason ? ` · ${legalFailureMessages[item.reason]}` : ""}`,
              ),
            ),
          ...snapshot.limitations.map((text) => bullet(text)),
        ]
      : [
          "현재 선택 자료에 맞는 검증된 법률 분석이 없습니다. 저장한 과거 리포트와 편집 내용은 별도로 보존됩니다.",
        ]),
  ];
  const content = lines.join("\n");
  if (content.length > 30000) throw new ReportError("EXPORT_LIMIT_EXCEEDED");
  return content;
}

export function markReportAnalysisEdited(content: string) {
  const warning =
    "리포트 준비 상태\n보완 필요 · 사용자가 수정한 리포트입니다. 편집한 본문과 인용은 원문을 다시 확인해 주세요.";
  const next = /^리포트 준비 상태\r?\n/u.test(content)
    ? content.replace(/^리포트 준비 상태\r?\n[^\r\n]*/u, warning)
    : `${warning}\n\n${content}`;
  if (next.length > 30000) throw new ReportError("EXPORT_LIMIT_EXCEEDED");
  return next;
}
