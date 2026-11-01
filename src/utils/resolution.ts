import type {
  V2ResolutionBasis,
  V2ResolutionDocumentKind,
  V2ResolutionDraft,
  V2ResolutionState,
} from "../contracts/v2/resolution";

/** Public reading links only. These do not attest availability or legal applicability. */
export const resolutionReadingLinks = {
  legalAid: "https://www.easylaw.go.kr/CSP/CnpClsMain.laf?csmSeq=568&ccfNo=2&cciNo=2&cnpClsNo=1",
  publicDefender:
    "https://www.easylaw.go.kr/CSP/CnpClsMain.laf?csmSeq=538&ccfNo=5&cciNo=3&cnpClsNo=5",
} as const;

/** A limited guide can be opened without turning it into a verified citation.
 * Never link arbitrary model/user supplied hosts, redirects or query arguments. */
export function resolutionGuideTextParts(
  text: string,
): { text: string; url: string | null; start: number }[] {
  const parts: { text: string; url: string | null; start: number }[] = [];
  let offset = 0;
  for (const match of text.matchAll(/https:\/\/[^\s<>"'()[\]{}]+/gu)) {
    const value = match[0];
    let allowed = false;
    try {
      const url = new URL(value);
      const keys = ["csmSeq", "ccfNo", "cciNo", "cnpClsNo"];
      allowed =
        value.length <= 2048 &&
        ["www.easylaw.go.kr", "easylaw.go.kr"].includes(url.hostname) &&
        !url.username &&
        !url.password &&
        !url.port &&
        !url.hash &&
        url.pathname === "/CSP/CnpClsMain.laf" &&
        [...url.searchParams].length === 4 &&
        keys.every(
          (key) =>
            url.searchParams.getAll(key).length === 1 &&
            /^\d{1,12}$/.test(url.searchParams.get(key) ?? ""),
        );
    } catch {
      /* Leave unrecognized content as plain text. */
    }
    if (!allowed) continue;
    parts.push(
      { text: text.slice(offset, match.index), url: null, start: offset },
      { text: value, url: value, start: match.index },
    );
    offset = match.index + value.length;
  }
  parts.push({ text: text.slice(offset), url: null, start: offset });
  return parts;
}

export const resolutionDocumentLabels: Record<V2ResolutionDocumentKind, string> = {
  fact_statement: "사실 정리 초안",
  criminal_complaint: "고소장 초안",
  civil_claim: "청구 관련 서류 초안",
  statement: "진술서 초안",
  answer: "답변서 초안",
  opinion: "의견서 초안",
  appeal: "항소 관련 초안",
  final_appeal: "상고 관련 초안",
};
export function resolutionContextLabel(basis: V2ResolutionBasis) {
  const purpose = {
    prepare_claim: "고소·청구 준비",
    respond_to_claim: "상대방 주장에 대응",
    unconfirmed: "입장 확인 필요",
  };
  const kind = {
    civil: "민사",
    criminal: "형사",
    family: "가사",
    administrative: "행정",
    labor: "노동",
    other: "기타 분야",
    unconfirmed: "분야 확인 필요",
  };
  const stage = {
    before_filing: "제출 전",
    investigation: "수사 단계",
    first_instance: "1심",
    appeal: "항소 단계",
    final_appeal: "상고 단계",
    enforcement: "집행 단계",
    other: "기타 절차",
    unconfirmed: "절차 단계 확인 필요",
  };
  return `${purpose[basis.casePurpose]} · ${kind[basis.procedure.kind]} · ${stage[basis.procedure.stage]}`;
}
/** Metadata-only workspace saves do not change the factual/research basis. */
export function sameResolutionBasis(a: V2ResolutionBasis | null, b: V2ResolutionBasis | null) {
  if (!a || !b) return a === b;
  return (
    a.researchRevision === b.researchRevision &&
    a.summaryRevision === b.summaryRevision &&
    a.evidenceHash === b.evidenceHash &&
    a.casePurpose === b.casePurpose &&
    a.analysisId === b.analysisId &&
    a.reportId === b.reportId &&
    a.reportRevision === b.reportRevision &&
    a.procedure.kind === b.procedure.kind &&
    a.procedure.stage === b.procedure.stage &&
    a.procedure.description === b.procedure.description
  );
}
export function sameResolutionFiles(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((id) => b.includes(id));
}
export function resolutionDraftIsCurrent(
  state: V2ResolutionState,
  draft: V2ResolutionDraft | null = state.draft,
) {
  return (
    !!draft &&
    state.basis !== null &&
    state.status !== "stale" &&
    state.status !== "not_ready" &&
    state.allowedDocumentKinds.includes(draft.documentKind) &&
    sameResolutionBasis(draft.basis, state.basis) &&
    sameResolutionFiles(draft.selectedFileIds, state.selectedFileIds) &&
    draft.maskIdentifiers === state.maskIdentifiers
  );
}
/** Eligibility is necessary but never establishes official procedural/form support. */
export function resolutionKindFits(kind: V2ResolutionDocumentKind, basis: V2ResolutionBasis) {
  const {
    casePurpose: purpose,
    procedure: { kind: track, stage },
  } = basis;
  if (kind === "fact_statement") return true;
  if (purpose === "unconfirmed" || track === "unconfirmed" || stage === "unconfirmed") return false;
  if (kind === "appeal") return stage === "appeal";
  if (kind === "final_appeal") return stage === "final_appeal";
  if (["appeal", "final_appeal", "enforcement", "other"].includes(stage)) return false;
  if (kind === "criminal_complaint")
    return purpose === "prepare_claim" && track === "criminal" && stage === "before_filing";
  if (kind === "civil_claim")
    return purpose === "prepare_claim" && track === "civil" && stage === "before_filing";
  if (kind === "answer")
    return purpose === "respond_to_claim" && track === "civil" && stage === "first_instance";
  if (kind === "statement")
    return purpose === "respond_to_claim" && track === "criminal" && stage === "investigation";
  return (
    kind === "opinion" &&
    purpose === "respond_to_claim" &&
    track === "criminal" &&
    stage === "first_instance"
  );
}
