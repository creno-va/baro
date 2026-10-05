import { z } from "zod";
import {
  dateSchema,
  displayText,
  hasUniqueIds,
  opaqueIdSchema,
  revisionSchema,
  timestampSchema,
} from "../common";
import { V2_LIMITS, v2HashSchema, v2IdListSchema } from "./common";

const seconds = z.number().min(0).max(V2_LIMITS.mediaSeconds);
export const v2SourcePositionSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("document"),
    page: z.number().int().min(1).max(100_000),
    paragraph: z.number().int().min(1).max(100_000).nullable(),
    table: z
      .strictObject({
        index: z.number().int().min(1).max(10_000),
        row: z.number().int().min(1).max(100_000),
        column: z.number().int().min(1).max(10_000),
      })
      .nullable(),
  }),
  z.strictObject({
    kind: z.literal("image"),
    region: z
      .strictObject({
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
        width: z.number().positive().max(1),
        height: z.number().positive().max(1),
      })
      .refine((r) => r.x + r.width <= 1 && r.y + r.height <= 1, "Region exceeds image")
      .nullable(),
  }),
  z
    .strictObject({ kind: z.literal("audio"), startSeconds: seconds, endSeconds: seconds })
    .refine((p) => p.endSeconds > p.startSeconds, "Empty time interval"),
  z.strictObject({
    kind: z.literal("video"),
    timestampSeconds: seconds,
    frameIndex: z.number().int().min(0).max(10_000_000),
    sampling: z.enum(["one_second", "scene_change"]),
  }),
]);
export const v2FactReferenceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("intake_narrative"), intakeRevision: revisionSchema }),
  z.strictObject({
    kind: z.literal("intake_answer"),
    questionId: opaqueIdSchema,
    intakeRevision: revisionSchema,
  }),
  z.strictObject({
    kind: z.literal("user_message"),
    messageId: opaqueIdSchema,
    workspaceRevision: revisionSchema,
  }),
  z.strictObject({
    kind: z.literal("user_material"),
    fileId: opaqueIdSchema,
    fileRevision: revisionSchema,
    position: v2SourcePositionSchema,
  }),
  z.strictObject({ kind: z.literal("official_source"), citationId: opaqueIdSchema }),
]);
export const v2FactSchema = z
  .strictObject({
    id: opaqueIdSchema,
    text: displayText(2000),
    attribution: z.enum(["user_statement", "user_material", "official_source", "ai_organization"]),
    certainty: z.enum(["reported", "observed", "uncertain", "conflicting"]),
    significance: z.enum(["favorable", "unfavorable", "neutral"]),
    references: z.array(v2FactReferenceSchema).max(100),
    conflictingFactIds: v2IdListSchema,
    userEdited: z.boolean(),
  })
  .refine((fact) => {
    if (fact.conflictingFactIds.includes(fact.id)) return false;
    if ((fact.certainty === "conflicting") !== fact.conflictingFactIds.length > 0) return false;
    if (fact.attribution === "ai_organization")
      return fact.certainty === "uncertain" || fact.certainty === "conflicting";
    const kinds =
      fact.attribution === "user_statement"
        ? ["intake_narrative", "intake_answer", "user_message"]
        : fact.attribution === "user_material"
          ? ["user_material"]
          : ["official_source"];
    return (
      fact.references.length > 0 &&
      fact.references.every((ref) => kinds.includes(ref.kind)) &&
      (fact.attribution !== "official_source" || !fact.userEdited) &&
      (fact.certainty !== "observed" || (fact.attribution !== "user_statement" && !fact.userEdited))
    );
  }, "Fact attribution or conflict is inconsistent");

/** HTTPS and endpoint allowlists are checked in addition to server retrieval verification. */
export function v2OfficialUrlSchema(allowedHosts: readonly string[]) {
  return z
    .url()
    .max(2048)
    .refine((value) => {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        !url.port &&
        allowedHosts.includes(url.hostname.toLowerCase()) &&
        ![...url.searchParams.keys()].some((key) =>
          /^(oc|token|key|secret|authorization)$/i.test(key),
        )
      );
    }, "URL is outside approved official sources");
}
const legalUrl = v2OfficialUrlSchema(["law.go.kr", "www.law.go.kr", "open.law.go.kr"]);
const citationBase = {
  id: opaqueIdSchema,
  sourceId: opaqueIdSchema,
  title: displayText(500),
  verifiedAt: timestampSchema,
  contentHash: v2HashSchema,
};
export const v2StatuteCitationSchema = z.strictObject({
  ...citationBase,
  kind: z.literal("statute"),
  officialId: opaqueIdSchema,
  article: displayText(200),
  effectiveDate: dateSchema,
  url: legalUrl,
});
export const v2PrecedentCitationSchema = z.strictObject({
  ...citationBase,
  kind: z.literal("precedent"),
  officialId: opaqueIdSchema,
  court: displayText(200),
  caseNumber: displayText(200),
  decisionDate: dateSchema,
  url: legalUrl,
});
// The configured institution registry, never a model-provided hostname, chooses these URLs.
export function v2OfficialCitationSchema(guideHosts: readonly string[]) {
  return z.discriminatedUnion("kind", [
    v2StatuteCitationSchema,
    v2PrecedentCitationSchema,
    z.strictObject({
      ...citationBase,
      kind: z.literal("official_guide"),
      institutionId: opaqueIdSchema,
      endpointId: opaqueIdSchema,
      section: displayText(300),
      publishedDate: dateSchema.nullable(),
      url: v2OfficialUrlSchema(guideHosts),
    }),
  ]);
}
// No institution is automatically trusted. Retrieval owners supply a verified registry to the factory.
export const v2CitationSchema = v2OfficialCitationSchema([]);
export type V2OfficialGuideRegistryEntry = {
  institutionId: string;
  endpointId: string;
  host: string;
  pathPrefix: string;
};
export function v2OfficialCitationsForRegistrySchema(
  registry: readonly V2OfficialGuideRegistryEntry[],
) {
  const schema = v2OfficialCitationSchema(registry.map((entry) => entry.host));
  return z
    .array(schema)
    .max(50)
    .refine(hasUniqueIds, "Duplicate citations")
    .refine(
      (citations) =>
        citations.every(
          (citation) =>
            citation.kind !== "official_guide" ||
            registry.some((entry) => {
              const url = new URL(citation.url);
              return (
                entry.institutionId === citation.institutionId &&
                entry.endpointId === citation.endpointId &&
                entry.host === url.hostname &&
                entry.pathPrefix.startsWith("/") &&
                (url.pathname === entry.pathPrefix ||
                  url.pathname.startsWith(`${entry.pathPrefix.replace(/\/$/, "")}/`))
              );
            }),
        ),
      "Guide institution and endpoint must be registered",
    );
}
/** Only independently retrieved, validated server citations belong in this allowlist. */
export function v2CitationsForRetrievedSourcesSchema(
  retrieved: readonly unknown[],
  guideHosts: readonly string[] = [],
) {
  const schema = z
    .array(v2OfficialCitationSchema(guideHosts))
    .max(50)
    .refine(hasUniqueIds, "Duplicate citations");
  const canonical = schema.parse(retrieved).map((citation) => JSON.stringify(citation));
  return schema.refine(
    (citations) => citations.every((citation) => canonical.includes(JSON.stringify(citation))),
    "Model output must not alter or invent retrieved citations",
  );
}
export const v2FactsSchema = z
  .array(v2FactSchema)
  .max(300)
  .refine(hasUniqueIds, "Duplicate fact IDs")
  .refine(
    (facts) =>
      facts.every((fact) =>
        fact.conflictingFactIds.every((id) => facts.some((other) => other.id === id)),
      ),
    "Unknown conflicting fact",
  );
export type V2ReferenceContext = {
  intakeRevision: number;
  answeredQuestionIds: readonly string[];
  messages: readonly { id: string; workspaceRevision: number }[];
  files: readonly {
    id: string;
    revision: number;
    category: "document" | "image" | "audio" | "video";
    pageCount?: number;
    durationSeconds?: number;
    hasAudio?: boolean;
  }[];
  verifiedCitationIds: readonly string[];
};
/** Pass only server-owned, currently authorized sources. Unknown/skipped answers are excluded. */
export function v2ReferenceIsAuthorized(reference: V2FactReference, context: V2ReferenceContext) {
  if (reference.kind === "intake_narrative")
    return reference.intakeRevision === context.intakeRevision;
  if (reference.kind === "official_source")
    return context.verifiedCitationIds.includes(reference.citationId);
  if (reference.kind === "intake_answer")
    return (
      reference.intakeRevision === context.intakeRevision &&
      context.answeredQuestionIds.includes(reference.questionId)
    );
  if (reference.kind === "user_message")
    return context.messages.some(
      (message) =>
        message.id === reference.messageId &&
        message.workspaceRevision === reference.workspaceRevision,
    );
  const file = context.files.find(
    (candidate) =>
      candidate.id === reference.fileId && candidate.revision === reference.fileRevision,
  );
  if (file === undefined) return false;
  const position = reference.position;
  if (position.kind === "document")
    return (
      file.category === "document" &&
      file.pageCount !== undefined &&
      position.page <= file.pageCount
    );
  if (position.kind === "image") return file.category === "image";
  if (file.durationSeconds === undefined) return false;
  if (position.kind === "audio")
    return (
      (file.category === "audio" || (file.category === "video" && file.hasAudio === true)) &&
      position.endSeconds <= file.durationSeconds
    );
  return file.category === "video" && position.timestampSeconds < file.durationSeconds;
}
export function v2FactsForSourcesSchema(context: V2ReferenceContext) {
  return v2FactsSchema.refine(
    (facts) =>
      facts.every((fact) =>
        fact.references.every((reference) => v2ReferenceIsAuthorized(reference, context)),
      ),
    "Unknown, stale, foreign or unavailable source",
  );
}
export type V2SourcePosition = z.infer<typeof v2SourcePositionSchema>;
export type V2FactReference = z.infer<typeof v2FactReferenceSchema>;
export type V2Fact = z.infer<typeof v2FactSchema>;
export type V2OfficialCitation = z.infer<ReturnType<typeof v2OfficialCitationSchema>>;
export type V2StatuteCitation = z.infer<typeof v2StatuteCitationSchema>;
export type V2PrecedentCitation = z.infer<typeof v2PrecedentCitationSchema>;
