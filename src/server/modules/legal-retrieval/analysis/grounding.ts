import type { V2LegalAnalysisDraft } from "../../../../contracts/v2/legal-analysis";
import type { LegalAnalysisPlan } from "../../llm-gateway/analysis-schema";
import type { SourceChunk } from "../v2/contracts";
import {
  analysisCaseFacts,
  analysisFactHasIndependentSupport,
  canonicalAnalysisJson,
  type LegalAnalysisInput,
} from "./context";

/** Structural checks complement the independent semantic audit; neither replaces it. */
export function analysisDraftGrounded(
  draft: V2LegalAnalysisDraft,
  input: LegalAnalysisInput,
  plan: LegalAnalysisPlan,
  chunks: readonly SourceChunk[],
) {
  const facts = new Map(analysisCaseFacts(input).map((f) => [f.id, f]));
  const claims = new Map(draft.sourceClaims.map((c) => [c.id, c]));
  const sources = new Map(chunks.map((c) => [c.citation.id, c]));
  const issueIds = new Map(plan.issues.map((i) => [i.id, i]));
  const usedClaims = new Set<string>();
  const factsKnown = (ids: string[]) => ids.every((id) => facts.has(id));
  const claimKind = (ids: string[], kind: "statute" | "precedent", citationId?: string) =>
    ids.every((id) => {
      const claim = claims.get(id);
      if (
        !claim ||
        sources.get(claim.citationId)?.citation.kind !== kind ||
        (citationId !== undefined && claim.citationId !== citationId)
      )
        return false;
      usedClaims.add(id);
      return true;
    });
  const materialRefs = new Set([
    ...input.materials.map((m) => canonicalAnalysisJson(m.reference)),
    ...analysisCaseFacts(input).flatMap((f) =>
      f.references.filter((r) => r.kind === "user_material").map(canonicalAnalysisJson),
    ),
  ]);
  if (draft.perspective.casePurpose !== input.context.casePurpose) return false;
  if (
    input.context.casePurpose === "prepare_claim" &&
    (draft.perspective.responsePoints.length > 0 || !draft.perspective.claimGaps.length)
  )
    return false;
  if (
    input.context.casePurpose === "respond_to_claim" &&
    (draft.perspective.claimGaps.length > 0 || !draft.perspective.responsePoints.length)
  )
    return false;
  if (
    input.context.casePurpose === "unconfirmed" &&
    (draft.perspective.claimGaps.length || draft.perspective.responsePoints.length)
  )
    return false;
  if (!draft.perspective.weaknesses.length || !draft.perspective.additionalMaterials.length)
    return false;
  for (const issue of draft.issues) {
    const planned = issueIds.get(issue.id);
    if (!planned || issue.title !== planned.title) return false;
    for (const requirement of issue.requirements) {
      if (
        !factsKnown([...requirement.factIds, ...requirement.conflictingFactIds]) ||
        !claimKind(requirement.sourceClaimIds, "statute") ||
        requirement.evidence.some((r) => !materialRefs.has(canonicalAnalysisJson(r)))
      )
        return false;
      if (
        requirement.assessment === "supported" &&
        (!requirement.factIds.length ||
          requirement.factIds.some((id) => {
            const fact = facts.get(id);
            return !fact || !analysisFactHasIndependentSupport(fact, input);
          }))
      )
        return false;
      if (requirement.assessment === "conflicting" && !requirement.conflictingFactIds.length)
        return false;
      if (requirement.assessment === "insufficient" && !requirement.gaps.length) return false;
    }
  }
  for (const precedent of draft.precedents) {
    for (const comparison of [...precedent.commonalities, ...precedent.differences]) {
      if (
        !comparison.factIds.length ||
        !factsKnown(comparison.factIds) ||
        !claimKind(comparison.sourceClaimIds, "precedent", precedent.citationId)
      )
        return false;
    }
  }
  for (const point of draft.perspective.responsePoints) {
    if (!factsKnown(point.conflictingFactIds)) return false;
    for (const id of point.sourceClaimIds) {
      if (!claims.has(id)) return false;
      usedClaims.add(id);
    }
  }
  return draft.sourceClaims.every((c) => usedClaims.has(c.id) && sources.has(c.citationId));
}
