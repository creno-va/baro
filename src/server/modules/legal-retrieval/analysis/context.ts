import { z } from "zod";
import { displayText, hasUniqueIds, opaqueIdSchema, revisionSchema } from "../../../../contracts";
import { v2FactSchema, v2MaterialReferenceSchema, v2SummarySchema } from "../../../../contracts/v2";
import { v2FileObservationSchema } from "../../../../contracts/v2/files";
import type { V2LegalAnalysisSnapshot } from "../../../../contracts/v2/legal-analysis";
import {
  type V2AnalysisBasis,
  v2AnalysisEvidenceSchema,
  v2CaseContextSchema,
} from "../../../../contracts/v2/rework";
import { textHash } from "../service";

export const legalAnalysisInputSchema = z.strictObject({
  context: v2CaseContextSchema,
  confirmedSummary: v2SummarySchema,
  facts: z.array(v2FactSchema).max(300).refine(hasUniqueIds),
  includedEvidence: z
    .array(v2AnalysisEvidenceSchema)
    .max(100)
    .refine((rows) => new Set(rows.map((r) => r.fileId)).size === rows.length),
  materials: z
    .array(
      z.strictObject({
        reference: v2MaterialReferenceSchema,
        text: displayText(20000),
        // Internal projection of the actual readMaterialWindow coverage. Omission
        // stays unknown; never fill it with an asserted observed/default state.
        coverage: z
          .object({
            observationCertainty: v2FileObservationSchema.shape.certainty,
            userEdited: v2FileObservationSchema.shape.userEdited,
          })
          .optional(),
      }),
    )
    .max(100),
  researchRevision: revisionSchema,
  scope: z.strictObject({
    excludedFileIds: z
      .array(opaqueIdSchema)
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length),
    maskIdentifiers: z.boolean(),
  }),
});
export type LegalAnalysisInput = z.infer<typeof legalAnalysisInputSchema>;
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Stable object keys; source strings and positions retain their exact bytes. */
export function canonicalAnalysisJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalAnalysisJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value)
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalAnalysisJson((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  return JSON.stringify(value);
}

export function analysisCaseFacts(input: LegalAnalysisInput) {
  return input.facts.filter(
    (f) => f.attribution === "user_statement" || f.attribution === "user_material",
  );
}

export function analysisMaterialIsObserved(material: LegalAnalysisInput["materials"][number]) {
  return (
    material.coverage?.observationCertainty === "observed" && material.coverage.userEdited === false
  );
}

/** A stored verified fact outside the supplied window is not newly downgraded.
 * But a supplied uncertain/edited/unknown observation at that EXACT current
 * reference cannot be promoted by labelling its derived fact 'observed'. */
export function analysisFactHasIndependentSupport(
  fact: LegalAnalysisInput["facts"][number],
  input: LegalAnalysisInput,
) {
  if (fact.certainty === "uncertain" || fact.certainty === "conflicting") return false;
  if (fact.attribution === "user_statement") return true; // Still a qualified statement, never independent proof.
  if (fact.attribution !== "user_material" || fact.certainty !== "observed" || fact.userEdited)
    return false;
  return fact.references.every((reference) => {
    if (reference.kind !== "user_material") return false;
    const matching = input.materials.filter(
      (material) => canonicalAnalysisJson(material.reference) === canonicalAnalysisJson(reference),
    );
    return matching.every(analysisMaterialIsObserved);
  });
}

/** Inputs are current server-authorized observations, already filtered/masked by scope.
 * File hashes alone cannot detect observation edits, uncertainty or inclusion changes. */
export async function analysisBasis(raw: LegalAnalysisInput): Promise<V2AnalysisBasis> {
  const input = legalAnalysisInputSchema.parse(raw);
  const byId = <T extends { id: string }>(rows: T[]) =>
    [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    researchRevision: input.researchRevision,
    summaryRevision: input.confirmedSummary.revision,
    casePurpose: input.context.casePurpose,
    evidenceHash: await textHash(
      canonicalAnalysisJson({
        context: input.context,
        summary: { ...input.confirmedSummary, facts: byId(input.confirmedSummary.facts) },
        facts: byId(input.facts),
        includedEvidence: [...input.includedEvidence].sort((a, b) =>
          a.fileId < b.fileId ? -1 : a.fileId > b.fileId ? 1 : 0,
        ),
        materials: [...input.materials].sort((a, b) =>
          compare(canonicalAnalysisJson(a), canonicalAnalysisJson(b)),
        ),
        scope: { ...input.scope, excludedFileIds: [...input.scope.excludedFileIds].sort() },
      }),
    ),
  };
}

/** Case currentness only. Source TTL/binding authority must also be checked on reads. */
export async function isAnalysisCurrent(
  snapshot: V2LegalAnalysisSnapshot,
  input: LegalAnalysisInput,
) {
  return (
    canonicalAnalysisJson(snapshot.basis) === canonicalAnalysisJson(await analysisBasis(input)) &&
    canonicalAnalysisJson(snapshot.context) === canonicalAnalysisJson(input.context) &&
    canonicalAnalysisJson([...snapshot.basedOnFactIds].sort()) ===
      canonicalAnalysisJson(
        analysisCaseFacts(input)
          .map((f) => f.id)
          .sort(),
      ) &&
    canonicalAnalysisJson(
      [...snapshot.includedEvidence].sort((a, b) => compare(a.fileId, b.fileId)),
    ) ===
      canonicalAnalysisJson([...input.includedEvidence].sort((a, b) => compare(a.fileId, b.fileId)))
  );
}

export function analysisScopeValid(input: LegalAnalysisInput) {
  const excluded = new Set(input.scope.excludedFileIds);
  const included = (id: string, revision: number) =>
    !excluded.has(id) &&
    input.includedEvidence.some((f) => f.fileId === id && f.fileRevision === revision);
  return (
    input.includedEvidence.every((f) => !excluded.has(f.fileId)) &&
    input.materials.every((m) => included(m.reference.fileId, m.reference.fileRevision)) &&
    [...input.facts, ...input.confirmedSummary.facts].every((f) =>
      f.references.every((r) => r.kind !== "user_material" || included(r.fileId, r.fileRevision)),
    )
  );
}
