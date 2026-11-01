import { z } from "zod";
import { dateSchema, displayText, hasUniqueIds, opaqueIdSchema, timestampSchema } from "../common";
import { v2HashSchema, v2IdListSchema } from "./common";
import { legalFailureReasonSchema } from "./legal-availability";
import {
  v2AnalysisBasisSchema,
  v2AnalysisEvidenceSchema,
  v2CaseContextSchema,
  v2CasePurposeSchema,
  v2EvidenceRequirementSchema,
  v2ReworkVersionSchema,
} from "./rework";
import { v2MaterialReferenceSchema, v2OfficialCitationSchema } from "./sources";

/** Same wire shape as the existing citation validator; shape alone is not verification. */
export const v2SourceClaimSchema = z
  .strictObject({
    id: opaqueIdSchema,
    text: displayText(10000),
    kind: z.enum(["quotation", "legal_explanation"]),
    citationId: opaqueIdSchema,
    startUtf16: z.number().int().nonnegative(),
    endUtf16: z.number().int().positive(),
  })
  .refine((c) => c.endUtf16 > c.startUtf16);
const supportedText = z.strictObject({
  text: displayText(2000),
  factIds: v2IdListSchema.min(1),
  sourceClaimIds: v2IdListSchema.min(1),
});
export const v2LegalAnalysisDraftSchema = z.strictObject({
  issues: z
    .array(
      z.strictObject({
        id: opaqueIdSchema,
        title: displayText(500),
        requirements: z
          .array(
            z.strictObject({
              id: opaqueIdSchema,
              label: displayText(1000),
              assessment: z.enum(["supported", "insufficient", "conflicting"]),
              sourceClaimIds: v2IdListSchema.min(1),
              factIds: v2IdListSchema,
              conflictingFactIds: v2IdListSchema,
              evidence: z.array(v2MaterialReferenceSchema).max(100),
              gaps: z.array(displayText(1000)).max(30),
            }),
          )
          .min(1)
          .max(20)
          .refine(hasUniqueIds),
      }),
    )
    .max(10)
    .refine(hasUniqueIds),
  precedents: z
    .array(
      z
        .strictObject({
          citationId: opaqueIdSchema,
          commonalities: z.array(supportedText).max(10),
          differences: z.array(supportedText).max(10),
          preparationMeaning: displayText(2000),
        })
        .refine(
          (p) => p.commonalities.length + p.differences.length > 0,
          "A precedent needs a concrete fact comparison",
        ),
    )
    .max(10)
    .refine((ps) => new Set(ps.map((p) => p.citationId)).size === ps.length),
  perspective: z.strictObject({
    casePurpose: v2CasePurposeSchema,
    weaknesses: z.array(displayText(2000)).max(30),
    claimGaps: z.array(displayText(2000)).max(30),
    responsePoints: z
      .array(
        z.strictObject({
          opponentPosition: displayText(2000),
          ourExplanation: displayText(2000),
          conflictingFactIds: v2IdListSchema,
          sourceClaimIds: v2IdListSchema,
          additionalMaterials: z.array(displayText(1000)).max(30),
        }),
      )
      .max(20),
    additionalMaterials: z.array(displayText(1000)).max(30),
  }),
  evidenceRequirements: z.array(v2EvidenceRequirementSchema).max(30).refine(hasUniqueIds),
  sourceClaims: z.array(v2SourceClaimSchema).max(100).refine(hasUniqueIds),
  limitations: z.array(displayText(1000)).max(100),
});
export function v2LegalAnalysisSnapshotSchema(guideHosts: readonly string[] = []) {
  return v2LegalAnalysisDraftSchema
    .extend({
      contractVersion: v2ReworkVersionSchema,
      id: opaqueIdSchema,
      basis: v2AnalysisBasisSchema,
      context: v2CaseContextSchema,
      basedOnFactIds: z
        .array(opaqueIdSchema)
        .max(300)
        .refine((ids) => new Set(ids).size === ids.length),
      includedEvidence: z
        .array(v2AnalysisEvidenceSchema)
        .max(100)
        .refine((fs) => new Set(fs.map((f) => f.fileId)).size === fs.length),
      asOfDate: dateSchema,
      checkedAt: timestampSchema,
      status: z.enum(["ready", "partial", "empty", "unavailable"]),
      citations: z.array(v2OfficialCitationSchema(guideHosts)).max(50).refine(hasUniqueIds),
      retrievalHash: v2HashSchema,
      availability: z
        .array(
          z.strictObject({
            kind: z.enum(["statute", "precedent", "official_guide"]),
            status: z.enum(["verified", "limited", "unavailable", "empty"]),
            reason: legalFailureReasonSchema.nullable(),
          }),
        )
        .max(20),
    })
    .refine((s) => {
      const claims = new Map(s.sourceClaims.map((c) => [c.id, c]));
      const citations = new Map(s.citations.map((c) => [c.id, c]));
      const factIds = new Set(s.basedOnFactIds);
      const supports = (ids: string[]) => ids.every((id) => claims.has(id));
      const facts = (ids: string[]) => ids.every((id) => factIds.has(id));
      if (
        s.basis.casePurpose !== s.perspective.casePurpose ||
        s.basis.casePurpose !== s.context.casePurpose
      )
        return false;
      const verified = (kind: "statute" | "precedent") =>
        s.availability.some((a) => a.kind === kind && a.status === "verified" && a.reason === null);
      if (
        s.status === "ready" &&
        (!s.issues.length ||
          !s.sourceClaims.length ||
          !verified("statute") ||
          !verified("precedent") ||
          !s.precedents.length ||
          s.precedents.some((p) => !p.commonalities.length || !p.differences.length) ||
          s.availability.some((a) => a.status !== "verified"))
      )
        return false;
      if (
        (s.status === "empty" || s.status === "unavailable") &&
        (s.issues.length || s.precedents.length || s.sourceClaims.length || s.citations.length)
      )
        return false;
      return (
        s.sourceClaims.every((c) => citations.has(c.citationId)) &&
        s.issues.every((i) =>
          i.requirements.every(
            (r) =>
              supports(r.sourceClaimIds) &&
              r.sourceClaimIds.every(
                (id) => citations.get(claims.get(id)?.citationId ?? "")?.kind === "statute",
              ) &&
              facts(r.factIds) &&
              facts(r.conflictingFactIds) &&
              r.evidence.every((e) =>
                s.includedEvidence.some(
                  (f) => f.fileId === e.fileId && f.fileRevision === e.fileRevision,
                ),
              ),
          ),
        ) &&
        s.precedents.every(
          (p) =>
            citations.get(p.citationId)?.kind === "precedent" &&
            [...p.commonalities, ...p.differences].every(
              (t) =>
                facts(t.factIds) &&
                supports(t.sourceClaimIds) &&
                t.sourceClaimIds.every((id) => claims.get(id)?.citationId === p.citationId),
            ),
        ) &&
        s.perspective.responsePoints.every(
          (p) => facts(p.conflictingFactIds) && supports(p.sourceClaimIds),
        ) &&
        s.evidenceRequirements.every((r) =>
          r.fileIds.every((id) => s.includedEvidence.some((f) => f.fileId === id)),
        )
      );
    }, "Analysis must bind its exact purpose, facts, evidence and official claims");
}
export type V2SourceClaim = z.infer<typeof v2SourceClaimSchema>;
export type V2LegalAnalysisDraft = z.infer<typeof v2LegalAnalysisDraftSchema>;
export type V2LegalAnalysisSnapshot = z.infer<ReturnType<typeof v2LegalAnalysisSnapshotSchema>>;

/** Presentation only. This grants no owner, source, audit or currentness authority.
 * A prepared result still needs a limited report while its procedure is unknown. */
export function v2ReportAnalysisStatus(
  snapshot: Pick<V2LegalAnalysisSnapshot, "status" | "context">,
): V2LegalAnalysisSnapshot["status"] {
  return snapshot.status === "ready" &&
    (snapshot.context.casePurpose === "unconfirmed" ||
      snapshot.context.procedure.kind === "unconfirmed" ||
      snapshot.context.procedure.stage === "unconfirmed")
    ? "partial"
    : snapshot.status;
}
