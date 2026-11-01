import { dateSchema, timestampSchema } from "../../../contracts";
import type { V2CaseContext, V2OfficialCitation, V2SourceClaim } from "../../../contracts/v2";
import { legalFailureMessages } from "../../../contracts/v2/legal-availability";
import type { V2ResolutionCheck, V2ResolutionDocumentKind } from "../../../contracts/v2/resolution";
import {
  EXTRACTOR_VERSION,
  type RetrievalPlan,
  type SourceChunk,
  type SourceOutcome,
} from "../legal-retrieval/v2/contracts";
import { guideUrl, OFFICIAL_CATALOG } from "../legal-retrieval/v2/registry";
import { citationMatchesReverifiedSource, makeChunk } from "../legal-retrieval/v2/source";

type GuidePlan = Extract<RetrievalPlan, { kind: "official_guide" }>;
type Review = {
  id: string;
  label: string;
  tuple: readonly [string, string, string, string];
  quotation: string;
  documentKind: V2ResolutionDocumentKind | null;
};
// Reviewed public text only, not a statement that the current upstream is verified.
// A plan never grants source authority or decides this user's jurisdiction/deadline.
const reviews = {
  civilClaim: {
    id: "civil-claim",
    label: "민사 소장 작성 안내",
    tuple: ["568", "4", "1", "1"],
    quotation:
      "소장에 기재해야 하는 필수 기재사항은 다음과 같습니다(「민사소송법」 제249조 및 제274조제1항).",
    documentKind: "civil_claim",
  },
  civilFiling: {
    id: "civil-filing",
    label: "민사 소 제기 안내",
    tuple: ["568", "5", "1", "1"],
    quotation: "소송은 법원에 소장을 제출함으로써 제기합니다(「민사소송법」 제248조제1항).",
    documentKind: null,
  },
  civilAnswer: {
    id: "civil-answer",
    label: "민사 답변서 작성 안내",
    tuple: ["568", "5", "2", "1"],
    quotation:
      "답변서에는 다음의 사항을 적어야 합니다(「민사소송법」 제256조제4항, 제274조 및 「민사소송규칙」 제65조제1항).",
    documentKind: "answer",
  },
  civilAppeal: {
    id: "civil-appeal",
    label: "민사 항소장 안내",
    tuple: ["568", "7", "2", "1"],
    quotation:
      "항소는 항소장에 다음의 사항을 적어 제1심 법원에 제출하면 제기됩니다(「민사소송법」 제397조).",
    documentKind: "appeal",
  },
  civilFinalAppeal: {
    id: "civil-final-appeal",
    label: "민사 상고장 안내",
    tuple: ["568", "7", "3", "1"],
    quotation:
      "상고는 상고장에 다음의 사항을 적어 원심(항소심) 법원에 제출하면 제기됩니다(「민사소송법」 제397조 및 제425조).",
    documentKind: "final_appeal",
  },
  criminalComplaint: {
    id: "criminal-complaint",
    label: "형사 고소 방법 안내",
    tuple: ["734", "2", "1", "1"],
    quotation: "고소는 서면 또는 구술로써 사법경찰관에게 해야 합니다(「형사소송법」 제237조제1항).",
    documentKind: "criminal_complaint",
  },
} as const satisfies Record<string, Review>;

function applicable(context: V2CaseContext): readonly Review[] {
  if (context.casePurpose === "unconfirmed") return [];
  const { kind, stage } = context.procedure;
  if (kind === "civil") {
    if (stage === "before_filing" && context.casePurpose === "prepare_claim")
      return [reviews.civilClaim, reviews.civilFiling];
    if (stage === "first_instance" && context.casePurpose === "respond_to_claim")
      return [reviews.civilAnswer];
    if (stage === "appeal") return [reviews.civilAppeal];
    if (stage === "final_appeal") return [reviews.civilFinalAppeal];
  }
  if (kind === "criminal" && stage === "before_filing" && context.casePurpose === "prepare_claim")
    return [reviews.criminalComplaint];
  // No general suspect statement/opinion/appeal writing original was verified.
  // A violence-specific guide is not silently generalized to every criminal case.
  return [];
}
function planFor(review: Review): GuidePlan {
  const [csmSeq, ccfNo, cciNo, cnpClsNo] = review.tuple;
  return {
    kind: "official_guide",
    institutionId: "moleg_easylaw",
    endpointId: "easylaw_text_section",
    csmSeq,
    ccfNo,
    cciNo,
    cnpClsNo,
  };
}
/** At most two plans. The caller shares its existing total attempts/time/lease budget. */
export function selectReviewedProcedurePlans(context: V2CaseContext): readonly GuidePlan[] {
  return applicable(context).map(planFor);
}
export interface ProcedureSourceResult {
  procedureChecks: V2ResolutionCheck[];
  documentSupport: { documentKind: V2ResolutionDocumentKind; sourceClaimIds: string[] }[];
  citations: V2OfficialCitation[];
  sourceClaims: V2SourceClaim[];
  limitations: {
    id: string;
    reason: string;
    action: string;
    url: string | null;
    checkedAt: string | null;
  }[];
}
async function proofMatches(chunk: SourceChunk, review: Review, asOfDate: string, now: string) {
  const source = chunk.source;
  if (
    source.sourceType !== "official_guide" ||
    source.sourceDate === null ||
    source.canonicalUrl !== guideUrl(planFor(review)).href ||
    source.extractorVersion !== EXTRACTOR_VERSION ||
    source.rightsProvenance !== OFFICIAL_CATALOG[2].rights ||
    !timestampSchema.safeParse(source.expiresAt).success ||
    Date.parse(source.fetchedAt) > Date.parse(now) ||
    Date.parse(source.verifiedAt) > Date.parse(now) ||
    Date.parse(source.expiresAt) <= Date.parse(now) ||
    chunk.span.startUtf16 !== 0 ||
    chunk.span.endUtf16 !== source.body.length ||
    chunk.span.text !== source.body
  )
    return false;
  try {
    const rebuilt = await makeChunk(source, asOfDate);
    return (
      source.sourceId === rebuilt.source.sourceId &&
      source.contentHash === rebuilt.source.contentHash &&
      source.expiresAt === rebuilt.source.expiresAt &&
      // Bound reads preserve the original citation receipt when the identical
      // original is genuinely reverified. Reuse their complete identity/time
      // comparison; the caller still proves the exact binding and live authority.
      citationMatchesReverifiedSource(chunk.citation, rebuilt.citation)
    );
  } catch {
    return false;
  }
}

/** Server-only, network-free. Outcomes must come from the existing legal retrieval
 * service, never request JSON. Root retains owner/basis binding and the final
 * current-source authority check at publication AND read; this helper cannot grant it. */
export async function buildProcedureSources(input: {
  context: V2CaseContext;
  asOfDate: string;
  now: string;
  outcomes: readonly SourceOutcome[];
}): Promise<ProcedureSourceResult> {
  const now = timestampSchema.parse(input.now);
  const asOfDate = dateSchema.parse(input.asOfDate);
  if (asOfDate > new Date(Date.parse(now) + 9 * 3600000).toISOString().slice(0, 10))
    throw new Error("PROCEDURE_SOURCE_FUTURE_DATE");
  const result: ProcedureSourceResult = {
    procedureChecks: [],
    documentSupport: [],
    citations: [],
    sourceClaims: [],
    limitations: [],
  };
  const selected = applicable(input.context);
  if (!selected.length) {
    const action =
      "사건 입장·형사/민사 구분·실제 절차를 확인하고 해당 단계의 문서 작성 안내를 공식 기관에서 확인해 주세요. 확인한 일반 작성 안내가 없어 문서 종류를 확정하지 않았습니다.";
    result.procedureChecks.push({
      id: "procedure-context",
      label: "현재 절차의 공식 작성 안내",
      detail: action,
      status: "needs_confirmation",
      sourceClaimIds: [],
    });
    result.limitations.push({
      id: "procedure-context",
      reason: "unsupported_context",
      action,
      url: null,
      checkedAt: null,
    });
  }
  for (const review of selected) {
    const url = guideUrl(planFor(review)).href;
    const expectedId = `guide_${review.tuple.join("_")}`;
    const candidates = input.outcomes.flatMap((outcome) =>
      outcome.chunks
        .filter(
          (chunk) => chunk.source.officialId === expectedId || chunk.source.canonicalUrl === url,
        )
        .map((chunk) => ({ outcome, chunk })),
    );
    const candidate = candidates.length === 1 ? candidates[0] : undefined;
    const proof = candidate && (await proofMatches(candidate.chunk, review, asOfDate, now));
    const text = candidate?.chunk.source.body ?? "";
    const start = text.indexOf(review.quotation);
    const unique = start >= 0 && text.indexOf(review.quotation, start + 1) < 0;
    const admitted =
      candidate?.outcome.kind === "official_guide" &&
      candidate.outcome.availability === "verified" &&
      candidate.outcome.reason === null;
    if (!candidate || !proof || !admitted || !unique) {
      // Empty outcomes have no plan identity. Preserve the observed failures as
      // a group instead of inventing which individual guide failed.
      const emptyFailures = [
        ...new Set(
          input.outcomes
            .filter((o) => o.kind === "official_guide" && !o.chunks.length && o.reason !== null)
            .map((o) => o.reason),
        ),
      ];
      const reason = !candidate
        ? candidates.length
          ? "ambiguous_source"
          : emptyFailures.length
            ? "source_unavailable"
            : "not_requested"
        : !proof
          ? "cache_invalid"
          : !admitted
            ? (candidate.outcome.reason ?? "not_verified")
            : "quotation_changed";
      const message =
        reason === "source_unavailable"
          ? `공식 안내 조회에서 확인하지 못한 항목이 있습니다. ${emptyFailures.map((r) => r && legalFailureMessages[r]).join(" ")}`
          : reason in legalFailureMessages
            ? legalFailureMessages[reason as keyof typeof legalFailureMessages]
            : "현재 공식 원문과 인용 구간을 확인하지 못했습니다.";
      const checkedAt = proof && candidate ? candidate.chunk.source.verifiedAt : null;
      const action = `${review.label}를 공식 안내에서 확인해 주세요. ${message} ${url}${checkedAt ? ` (확인 시점: ${checkedAt})` : ""}`;
      result.procedureChecks.push({
        id: `procedure-${review.id}`,
        label: review.label,
        detail: action,
        status: "needs_confirmation",
        sourceClaimIds: [],
      });
      result.limitations.push({ id: review.id, reason, action, url, checkedAt });
      continue;
    }
    const citation = candidate.chunk.citation;
    const claim: V2SourceClaim = {
      id: `procedure_${review.id}_${citation.sourceId}`,
      kind: "quotation",
      text: review.quotation,
      citationId: citation.id,
      startUtf16: start,
      endUtf16: start + review.quotation.length,
    };
    result.citations.push(citation);
    result.sourceClaims.push(claim);
    result.procedureChecks.push({
      id: `procedure-${review.id}`,
      label: review.label,
      detail: claim.text,
      status: "verified",
      sourceClaimIds: [claim.id],
    });
    if (review.documentKind)
      result.documentSupport.push({
        documentKind: review.documentKind,
        sourceClaimIds: [claim.id],
      });
  }
  return result;
}
