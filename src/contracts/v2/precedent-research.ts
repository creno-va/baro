import { z } from "zod";
import {
  displayText,
  hasUniqueIds,
  opaqueIdSchema,
  revisionSchema,
  timestampSchema,
} from "../common";
import { legalFailureReasonSchema } from "./legal-availability";
import { v2PrecedentCitationSchema } from "./sources";

// Public topic IDs only. Neither a case narrative nor arbitrary search text is
// part of the wire request. The retrieval owner maps these to reviewed concepts.
export const v2PrecedentTopicSchema = z.enum([
  "contract",
  "loan",
  "lease",
  "damages",
  "wages",
  "dismissal",
  "industrial_accident",
  "divorce",
  "inheritance",
  "custody",
  "fraud",
  "defamation",
  "assault",
  "privacy",
  "copyright",
  "consumer",
  "tax",
  "administrative",
  "property",
  "corporate",
  "insolvency",
  "traffic",
  "medical",
  "construction",
]);
export type V2PrecedentTopic = z.infer<typeof v2PrecedentTopicSchema>;
// Opaque, short-lived owner/workspace/revision proof; not an upstream credential.
const readToken = z
  .string()
  .min(16)
  .max(4096)
  .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
const researchCitation = v2PrecedentCitationSchema.refine(
  (value) =>
    /^\d{1,12}$/.test(value.officialId) &&
    value.url === `https://www.law.go.kr/LSW/precInfoP.do?precSeq=${value.officialId}`,
  "Research must link the exact verified official judgment",
);
const topics = z
  .array(v2PrecedentTopicSchema)
  .min(1)
  .max(2)
  .refine((values) => new Set(values).size === values.length, "Duplicate research topics");
const pageToken = z
  .string()
  .min(16)
  .max(16384)
  .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

export const v2PrecedentSearchRequestSchema = z.strictObject({
  expectedRevision: revisionSchema,
  summaryRevision: revisionSchema,
  topics,
  cursor: pageToken.optional(),
  pageSize: z.literal(5).optional(),
});
export type V2PrecedentSearchRequest = z.infer<typeof v2PrecedentSearchRequestSchema>;

export const v2PrecedentResearchContextSchema = z.strictObject({
  schemaVersion: z.literal("2"),
  workspaceRevision: revisionSchema,
  summaryRevision: revisionSchema,
  caseTitle: displayText(200),
  recommendedTopics: z
    .array(v2PrecedentTopicSchema)
    .max(4)
    .refine((values) => new Set(values).size === values.length, "Duplicate recommended topics"),
});
export type V2PrecedentResearchContext = z.infer<typeof v2PrecedentResearchContextSchema>;

export const v2PrecedentExcerptSchema = z
  .strictObject({
    text: displayText(4000),
    startUtf16: z.number().int().nonnegative(),
    endUtf16: z.number().int().positive(),
    fullLengthUtf16: z.number().int().positive(),
    truncated: z.boolean(),
  })
  .refine(
    (value) =>
      value.endUtf16 - value.startUtf16 === value.text.length &&
      value.endUtf16 <= value.fullLengthUtf16 &&
      value.truncated === (value.startUtf16 > 0 || value.endUtf16 < value.fullLengthUtf16),
    "Excerpt must describe its exact original span",
  );

export const v2PrecedentResearchItemSchema = z
  .strictObject({
    id: opaqueIdSchema,
    citation: researchCitation,
    matchedTopics: topics,
    excerpt: v2PrecedentExcerptSchema,
    readToken,
  })
  .refine(
    (value) => value.id === value.citation.id,
    "Research item must retain its verified citation",
  );

export const v2PrecedentSearchResponseSchema = z
  .strictObject({
    schemaVersion: z.literal("2"),
    workspaceRevision: revisionSchema,
    summaryRevision: revisionSchema,
    checkedAt: timestampSchema,
    topics,
    status: z.enum(["complete", "partial", "empty", "unavailable"]),
    searchTruncated: z.boolean(),
    nextCursor: pageToken.nullable().optional(),
    availabilityIssues: z
      .array(
        z.strictObject({
          topic: v2PrecedentTopicSchema,
          reason: legalFailureReasonSchema,
        }),
      )
      .max(42)
      .optional(),
    // Availability concerns the returned original, never a match/merits score.
    // Accept historical two-topic responses; current paged searches return at most five total.
    items: z.array(v2PrecedentResearchItemSchema).max(6).refine(hasUniqueIds),
    unavailableTopics: z
      .array(v2PrecedentTopicSchema)
      .max(2)
      .refine((values) => new Set(values).size === values.length),
  })
  .refine((value) => {
    const checked = Date.parse(value.checkedAt);
    if (!Number.isFinite(checked)) return false;
    const checkedDate = new Date(checked + 9 * 3600000).toISOString().slice(0, 10);
    if (value.items.some((item) => item.citation.decisionDate > checkedDate)) return false;
    const selected = new Set(value.topics);
    if (
      value.availabilityIssues?.some(
        (issue) => !selected.has(issue.topic) || !value.unavailableTopics.includes(issue.topic),
      )
    )
      return false;
    if (
      new Set(value.availabilityIssues?.map((issue) => `${issue.topic}:${issue.reason}`)).size !==
      (value.availabilityIssues?.length ?? 0)
    )
      return false;
    if (value.items.some((item) => item.matchedTopics.some((topic) => !selected.has(topic))))
      return false;
    if (value.unavailableTopics.some((topic) => !selected.has(topic))) return false;
    if (new Set(value.items.map((item) => item.citation.sourceId)).size !== value.items.length)
      return false;
    if (
      value.items.some((item) => Date.parse(item.citation.verifiedAt) > Date.parse(value.checkedAt))
    )
      return false;
    if (value.status === "complete")
      return value.items.length > 0 && value.unavailableTopics.length === 0;
    if (value.status === "partial")
      return value.items.length > 0 && value.unavailableTopics.length > 0;
    if (value.status === "empty")
      return value.items.length === 0 && value.unavailableTopics.length === 0;
    return value.items.length === 0 && value.unavailableTopics.length > 0;
  }, "Research status, topic scope and verified originals must agree");
export type V2PrecedentSearchResponse = z.infer<typeof v2PrecedentSearchResponseSchema>;

export const v2PrecedentReadRequestSchema = z.strictObject({
  expectedRevision: revisionSchema,
  readToken,
  includeFullText: z.literal(true).optional(),
});
export type V2PrecedentReadRequest = z.infer<typeof v2PrecedentReadRequestSchema>;

export const v2PrecedentReadResponseSchema = z
  .strictObject({
    schemaVersion: z.literal("2"),
    workspaceRevision: revisionSchema,
    citation: researchCitation,
    // Keep bounded comparison excerpts; full text is for reading only, never a larger model input.
    excerpt: v2PrecedentExcerptSchema,
    fullText: z
      .string()
      .min(1)
      .max(1048576)
      .refine((value) => value.trim().length > 0 && !/<\/?[a-z!][^>]*>/i.test(value))
      .optional(),
  })
  .refine(
    (value) =>
      value.fullText === undefined ||
      (value.fullText.length === value.excerpt.fullLengthUtf16 &&
        value.fullText.slice(value.excerpt.startUtf16, value.excerpt.endUtf16) ===
          value.excerpt.text),
    "Full text and verified comparison excerpt must agree",
  );
export type V2PrecedentReadResponse = z.infer<typeof v2PrecedentReadResponseSchema>;
