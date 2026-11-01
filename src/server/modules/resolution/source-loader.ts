import type { ReworkReportView } from "@baro/api-client";
import { maskReportText } from "../../../components/reports/download";
import { revisionSchema } from "../../../contracts";
import type { V2CaseContext, V2Fact, V2LegalAnalysisSnapshot } from "../../../contracts/v2";
import { v2CaseContextSchema, v2LegalAnalysisSnapshotSchema } from "../../../contracts/v2";
import { resolutionKindFits } from "../../../utils/resolution";
import {
  analysisScopeValid,
  canonicalAnalysisJson,
  isAnalysisCurrent,
  type LegalAnalysisInput,
  legalAnalysisInputSchema,
} from "../legal-retrieval/analysis/context";
import { GUIDE_HOSTS } from "../legal-retrieval/v2/registry";
import { maskResolutionText } from "./draft";
import type { ProcedureSourceResult } from "./procedure-sources";
import type { ResolutionSource } from "./types";

export interface ResolutionSourceInput {
  /** Already owner-authorized, confirmed, scoped and masked by the central reader. */
  input: LegalAnalysisInput;
  context: V2CaseContext;
  workspaceRevision: number;
  /** Only a locally revalidated immutable snapshot, including an honest unavailable result. */
  currentAnalysis: V2LegalAnalysisSnapshot | null;
  report: Readonly<ReworkReportView> | null;
  /** Freshly rebound at read/publication by root, never request JSON. */
  procedureSources: ProcedureSourceResult;
  maskingTokens?: readonly string[];
  fileNames?: Readonly<Record<string, string>>;
}
const equal = (a: unknown, b: unknown) => canonicalAnalysisJson(a) === canonicalAnalysisJson(b);
const generic =
  /^(?:사용자|상대방|당사자|본인|회사|기업|고객|법원|기관|미확인|우리\s*측|원고|피고|고소인|피고소인|신청인|피신청인)(?:\s*(?:\d+|[A-Z]))?$/u;
function tokensFor(args: ResolutionSourceInput) {
  return [
    ...new Set([
      ...(args.maskingTokens ?? []),
      ...args.input.confirmedSummary.parties.map((p) => p.label),
    ]),
  ].filter(
    (token) =>
      token.trim().length > 1 &&
      !generic.test(token.trim()) &&
      !/[[\]<>]|^(?:(?:당사자|식별정보|전화번호|이메일)\s*)?(?:가림|미입력|확인 필요)$/.test(token),
  );
}
function positionText(reference: LegalAnalysisInput["materials"][number]["reference"]) {
  const p = reference.position;
  if (p.kind === "document")
    return `문서 ${p.page}쪽${p.paragraph === null ? "" : ` ${p.paragraph}문단`}`;
  if (p.kind === "image") return p.region ? "이미지의 지정 영역" : "이미지";
  if (p.kind === "audio") return `음성 ${p.startSeconds}~${p.endSeconds}초`;
  return `영상 ${p.timestampSeconds}초`;
}
function coverageText(material: LegalAnalysisInput["materials"][number]) {
  if (material.coverage?.userEdited) return "사용자가 교정한 관찰 · 원문 대조 필요";
  if (material.coverage?.observationCertainty === "uncertain")
    return "불확실한 관찰 · 원문 대조 필요";
  if (!material.coverage) return "관찰 상태 미확인 · 원문 대조 필요";
  return "추출 관찰 · 사실 여부 별도 확인";
}
/** Pure projection. This does not read storage, fetch originals, renew receipts,
 * admit an AI job or grant owner/consent/binding authority. */
export async function buildResolutionSource(
  args: ResolutionSourceInput,
): Promise<Omit<ResolutionSource, "stored">> {
  const input = legalAnalysisInputSchema.parse(args.input);
  const context = v2CaseContextSchema.parse(args.context);
  const workspaceRevision = revisionSchema.parse(args.workspaceRevision);
  const maskingTokens = tokensFor(args);
  const mask = input.scope.maskIdentifiers || !!args.report?.maskIdentifiers;
  const display = (text: string) => (mask ? maskResolutionText(text, maskingTokens) : text);
  const scopedContext = structuredClone(context);
  if (input.scope.maskIdentifiers && scopedContext.procedure.description) {
    // Same scoped description transformation as the authoritative central reader.
    scopedContext.procedure.description = maskingTokens.reduce(
      (s, token) => s.split(token).join("[당사자 가림]"),
      maskReportText(scopedContext.procedure.description),
    );
  }
  const scopeValid = analysisScopeValid(input) && equal(scopedContext, input.context);
  const excluded = new Set([
    ...input.scope.excludedFileIds,
    ...(args.report?.excludedFileIds ?? []),
  ]);
  const evidence = input.includedEvidence.filter((f) => !excluded.has(f.fileId));
  const available = (fact: V2Fact) =>
    fact.references.every(
      (r) =>
        r.kind !== "user_material" ||
        evidence.some((f) => f.fileId === r.fileId && f.fileRevision === r.fileRevision),
    );
  const confirmed = new Map(input.confirmedSummary.facts.filter(available).map((f) => [f.id, f]));
  // Exclusion of one side of a conflict does not make the remaining side proved.
  let changed = true;
  while (changed) {
    changed = false;
    for (const fact of confirmed.values())
      if (fact.conflictingFactIds.some((id) => !confirmed.has(id))) {
        confirmed.delete(fact.id);
        changed = true;
      }
  }
  const factFiles = (fact: V2Fact, visited = new Set<string>()): string[] => {
    if (visited.has(fact.id)) return [];
    visited.add(fact.id);
    return [
      ...new Set([
        ...fact.references.flatMap((r) => (r.kind === "user_material" ? [r.fileId] : [])),
        ...fact.conflictingFactIds.flatMap((id) => {
          const other = confirmed.get(id);
          return other ? factFiles(other, visited) : [];
        }),
      ]),
    ];
  };
  const facts = [...confirmed.values()]
    .filter((f) => f.attribution === "user_statement" || f.attribution === "user_material")
    .map((f) => {
      const qualifier =
        f.attribution === "user_statement"
          ? "사용자가 확인한 진술 · 독립 사실 확정 아님"
          : "확정 요약의 자료 설명 · 원문 대조 필요";
      const uncertainty =
        f.certainty === "uncertain"
          ? " · 미확인"
          : f.certainty === "conflicting"
            ? " · 상충 내용 보존"
            : "";
      return {
        id: f.id,
        text: display(
          `${qualifier}${uncertainty}${f.userEdited ? " · 사용자 교정" : ""}: ${f.text}`,
        ),
        confirmed: input.facts.some((current) => current.id === f.id && equal(current, f)),
        fileIds: factFiles(f),
      };
    });
  const files = evidence.map((f) => {
    const windows = input.materials.filter(
      (m) => m.reference.fileId === f.fileId && m.reference.fileRevision === f.fileRevision,
    );
    return {
      id: f.fileId,
      revision: f.fileRevision,
      contentHash: f.contentHash,
      name: display(args.fileNames?.[f.fileId] ?? `선택 자료 ${f.fileId}`),
      text: display(
        windows.length
          ? windows
              .map((m) => `${positionText(m.reference)} · ${coverageText(m)}\n${m.text}`)
              .join("\n\n")
          : "[미입력: 선택 자료에서 확인할 원문]",
      ),
    };
  });
  const parsedAnalysis =
    args.currentAnalysis &&
    v2LegalAnalysisSnapshotSchema(GUIDE_HOSTS).safeParse(args.currentAnalysis);
  const snapshot = parsedAnalysis?.success ? parsedAnalysis.data : null;
  const report = args.report;
  const reportScopeMatches =
    !!report &&
    equal([...report.excludedFileIds].sort(), [...input.scope.excludedFileIds].sort()) &&
    report.maskIdentifiers === input.scope.maskIdentifiers;
  const current =
    !!snapshot &&
    scopeValid &&
    (await isAnalysisCurrent(snapshot, input)) &&
    !!report &&
    !report.stale &&
    reportScopeMatches &&
    report.basis?.summaryRevision === input.confirmedSummary.revision &&
    report.basis.workspaceRevision <= workspaceRevision &&
    report.analysisReview?.analysisId === snapshot.id &&
    !report.analysisReview.userEdited &&
    report.analysisReview.status === snapshot.status &&
    report.analysisReview.checkedAt === snapshot.checkedAt &&
    facts.filter((f) => f.confirmed).length ===
      input.facts.filter(
        (f) => f.attribution === "user_statement" || f.attribution === "user_material",
      ).length;
  const analysis = current ? snapshot : null;
  const procedure = structuredClone(args.procedureSources);
  const citations = [...(analysis?.citations ?? [])];
  let procedureValid = true;
  for (const citation of procedure.citations) {
    const previous = citations.find((c) => c.id === citation.id);
    if (previous && !equal(previous, citation)) procedureValid = false;
    else if (!previous) citations.push(citation);
  }
  const claims = [...(analysis?.sourceClaims ?? [])];
  for (const claim of procedure.sourceClaims) {
    const previous = claims.find((c) => c.id === claim.id);
    if (previous && !equal(previous, claim)) procedureValid = false;
    else if (!previous) claims.push(claim);
    if (
      claim.kind !== "quotation" ||
      !procedure.citations.some((c) => c.id === claim.citationId && c.kind === "official_guide")
    )
      procedureValid = false;
  }
  if (
    !procedure.procedureChecks.every(
      (c) =>
        c.sourceClaimIds.every((id) => procedure.sourceClaims.some((claim) => claim.id === id)) &&
        (c.status !== "verified" ||
          c.sourceClaimIds.some((id) =>
            procedure.sourceClaims.some((claim) => claim.id === id && claim.text === c.detail),
          )),
    )
  )
    procedureValid = false;
  if (
    !procedure.documentSupport.every(
      (s) =>
        s.sourceClaimIds.length &&
        s.sourceClaimIds.every((id) => procedure.sourceClaims.some((c) => c.id === id)),
    )
  )
    procedureValid = false;
  const checks = procedureValid ? procedure.procedureChecks : [];
  if (mask && !maskingTokens.length)
    checks.push({
      id: "resolution-masking",
      label: "인적사항 가림 확인",
      detail:
        "현재 이름 가림 정보를 확인하지 못했습니다. 알려지지 않은 인적사항은 자동으로 판별할 수 없으므로 미입력으로 남기고 저장·공유 전에 가림 범위를 확인해 주세요.",
      status: "needs_confirmation",
      sourceClaimIds: [],
    });
  if (evidence.some((f) => !args.fileNames?.[f.fileId]?.trim()))
    checks.push({
      id: "resolution-file-names",
      label: "선택 자료 확인",
      detail:
        "자료 이름을 확인할 수 없어 자료 ID로 표시했습니다. 사용할 원본과 선택 범위를 확인해 주세요.",
      status: "needs_confirmation",
      sourceClaimIds: [],
    });
  const basis =
    current && snapshot && report
      ? {
          ...snapshot.basis,
          workspaceRevision,
          analysisId: snapshot.id,
          reportId: report.id,
          reportRevision: report.revision,
          procedure: structuredClone(input.context.procedure),
        }
      : null;
  return {
    basis,
    context: {
      ...input.context,
      procedure: {
        ...input.context.procedure,
        description: input.context.procedure.description
          ? display(input.context.procedure.description)
          : null,
      },
    },
    report: report
      ? {
          id: report.id,
          revision: report.revision,
          stale: report.stale || !current,
          selectedFileIds: evidence.map((f) => f.fileId),
          maskIdentifiers: mask,
        }
      : null,
    facts,
    files,
    analysis,
    citations: procedureValid ? citations : (analysis?.citations ?? []),
    sourceClaims: procedureValid ? claims : (analysis?.sourceClaims ?? []),
    procedureChecks: checks,
    documentSupport:
      basis && procedureValid && !procedure.limitations.length
        ? procedure.documentSupport.filter((s) => resolutionKindFits(s.documentKind, basis))
        : [],
    maskingTokens,
  };
}
