import { maskReportText } from "../../../components/reports/download";
import type { V2ResolutionDraftRequest } from "../../../contracts/v2/resolution";
import { resolutionDocumentLabels } from "../../../utils/resolution";
import type { ResolutionSource } from "./types";

export function maskResolutionText(text: string, tokens: readonly string[] = []) {
  let result = text;
  for (const token of [...new Set(tokens)]
    .filter((v) => v.trim().length > 0)
    .sort((a, b) => b.length - a.length))
    result = result.split(token).join("[식별정보 가림]");
  return maskReportText(result).replace(
    /(계좌\s*(?:번호)?\s*[:：]?\s*)[\d -]{8,30}/g,
    "$1[계좌번호 가림]",
  );
}
export function selectedResolutionFacts(source: ResolutionSource, ids: readonly string[]) {
  return source.facts.filter(
    (fact) => fact.confirmed && fact.fileIds.every((id) => ids.includes(id)),
  );
}
export function resolutionAnalysisIncluded(source: ResolutionSource, ids: readonly string[]) {
  const analysis = source.analysis;
  if (!analysis || !source.basis || analysis.id !== source.basis.analysisId) return false;
  if (
    analysis.basis.researchRevision !== source.basis.researchRevision ||
    analysis.basis.summaryRevision !== source.basis.summaryRevision ||
    analysis.basis.evidenceHash !== source.basis.evidenceHash ||
    analysis.basis.casePurpose !== source.basis.casePurpose
  )
    return false;
  const factIds = new Set(selectedResolutionFacts(source, ids).map((f) => f.id));
  return (
    analysis.basedOnFactIds.every((id) => factIds.has(id)) &&
    analysis.includedEvidence.every(
      (file) =>
        ids.includes(file.fileId) &&
        source.files.some(
          (f) =>
            f.id === file.fileId &&
            f.revision === file.fileRevision &&
            f.contentHash === file.contentHash,
        ),
    )
  );
}
export function resolutionWeaknessChecks(source: ResolutionSource, ids: readonly string[]) {
  if (!resolutionAnalysisIncluded(source, ids) || !source.analysis) return [];
  return [
    ...source.analysis.perspective.responsePoints.map(
      (p) =>
        `확인할 주장: ${p.opponentPosition}\n우리 측 설명: ${p.ourExplanation}\n필요한 자료·사실 확인: ${p.additionalMaterials.length ? p.additionalMaterials.join(" / ") : "해당 주장의 원문과 우리 측 설명의 근거를 확인해 주세요."}`,
    ),
    ...source.analysis.issues.flatMap((i) =>
      i.requirements
        .filter((r) => r.assessment !== "supported")
        .map(
          (r) =>
            `${i.title} · ${r.label}\n확인할 자료·사실: ${r.gaps.length ? r.gaps.join(" / ") : "관련 사실의 출처와 선택한 자료의 해당 부분을 확인해 주세요."}`,
        ),
    ),
    ...source.analysis.perspective.weaknesses.map(
      (weakness) =>
        `약점: ${weakness}\n확인할 행동: 이 내용과 관련된 사실의 원문·자료 위치를 확인하고, 아직 연결하지 못한 자료가 있으면 이 약점과의 관계를 설명해 주세요.`,
    ),
  ]
    .slice(0, 100)
    .map((text) => text.slice(0, 2000));
}
export function buildResolutionDraftText(
  source: ResolutionSource,
  request: V2ResolutionDraftRequest,
) {
  const facts = selectedResolutionFacts(source, request.selectedFileIds);
  const files = source.files.filter((f) => request.selectedFileIds.includes(f.id));
  const missingFields = [
    "작성인 인적사항",
    "상대방 인적사항",
    "사건번호",
    "사건 날짜",
    "요청·대응 취지",
    "관할",
    "제출처·담당기관/부서",
    "제출 방법",
    "제출 기한",
    "적용 서식",
  ];
  const analysisIncluded = resolutionAnalysisIncluded(source, request.selectedFileIds);
  const sections = [
    `# ${resolutionDocumentLabels[request.documentKind]}\n\n사용자가 검토·수정하는 초안입니다. 제출·발송은 수행하지 않습니다.`,
    `## 입력·확인할 항목\n${missingFields.map((field) => `- ${field}: [미입력: ${field}]`).join("\n")}`,
    `## 사용자 확인 사실\n${facts.length ? facts.map((f, index) => `${index + 1}. ${f.text}`).join("\n") : "[미입력: 사용자가 확인한 사건 사실]"}`,
    `## 선택한 증거 자료\n${files.length ? files.map((f, index) => `${index + 1}. ${f.name}\n${f.text}`).join("\n\n") : "[미입력: 사용할 증거 자료]"}`,
    `## 검증된 법적 쟁점\n${analysisIncluded && source.analysis?.issues.length ? source.analysis.issues.map((issue) => `${issue.title}\n${issue.requirements.map((r) => `- ${r.label}: ${r.assessment === "supported" ? "근거와 사실의 관계 확인됨 · 적용 판단은 검토 필요" : "사실·자료 확인 필요"}`).join("\n")}`).join("\n\n") : "선택한 사실·자료 범위에서 검증된 쟁점이 없습니다. 법적 주장을 임의로 채우지 않았습니다."}`,
    `## 약점과 필요한 확인\n${resolutionWeaknessChecks(source, request.selectedFileIds).join("\n\n") || "[확인 필요: 쟁점별 사실·자료의 부족한 부분]"}`,
    "## 제출 전 검토\n사실·자료의 원문과 다른 부분을 고치고 미입력 항목을 확인해 주세요. 불리한 사실도 보존하며 자료를 조작하거나 숨기지 않습니다. 관할·기한·서식은 공식 안내와 담당기관에서 사건에 맞는지 확인해 주세요.",
  ];
  const raw = sections.join("\n\n");
  return {
    title: resolutionDocumentLabels[request.documentKind],
    missingFields,
    content: request.maskIdentifiers ? maskResolutionText(raw, source.maskingTokens) : raw,
  };
}
