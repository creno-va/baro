import { z } from "zod";
import {
  citationIdsSchema,
  dateSchema,
  displayText,
  hasUniqueIds,
  opaqueIdSchema,
  schemaVersionSchema,
  timestampSchema,
} from "./common";
import { CURRENT_POLICY_VERSIONS } from "./consent";

export const contentHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const officialSourceUrlSchema = z
  .string()
  .max(2048)
  .url()
  .refine((value) => {
    if (!URL.canParse(value)) return false;
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      ["law.go.kr", "open.law.go.kr"].includes(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.port &&
      ![...url.searchParams.keys()].some((key) => key.toLowerCase() === "oc")
    );
  }, "Expected an official public HTTPS source URL without credentials");
export const citationSchema = z
  .strictObject({
    id: opaqueIdSchema,
    sourceId: z
      .string()
      .max(512)
      .regex(/^statute:[A-Za-z0-9_-]+:\d{4}-\d{2}-\d{2}:[A-Za-z0-9._-]+:[a-f0-9]{64}$/),
    lawName: displayText(100),
    article: displayText(100),
    effectiveDate: dateSchema,
    verifiedAt: timestampSchema,
    url: officialSourceUrlSchema,
    contentHash: contentHashSchema,
  })
  .refine((citation) => {
    const parts = citation.sourceId.split(":");
    return parts[2] === citation.effectiveDate && parts[4] === citation.contentHash;
  }, "Source ID date/hash mismatch");
const resultBase = {
  schemaVersion: schemaVersionSchema,
  asOfDate: dateSchema,
  notices: z.array(displayText(500)).max(5),
};
export const guidanceResultSchema = z.strictObject({
  ...resultBase,
  kind: z.literal("guidance"),
  summary: z.strictObject({
    userStatements: z.array(displayText(300)).max(20),
    organizedByAi: z.array(displayText(300)).max(20),
    unknowns: z.array(displayText(300)).max(20),
  }),
  timeline: z
    .array(
      z
        .strictObject({
          date: dateSchema.nullable(),
          event: displayText(300),
          source: z.enum(["user", "ai_organization"]),
          confidence: z.enum(["stated", "inferred", "unknown"]),
        })
        .refine(
          (entry) => entry.source !== "ai_organization" || entry.confidence !== "stated",
          "AI organization is not a stated fact",
        ),
    )
    .max(20),
  issues: z
    .array(
      z.strictObject({
        id: opaqueIdSchema,
        title: displayText(100),
        explanation: displayText(2000),
        uncertainty: displayText(2000),
        citationIds: citationIdsSchema,
      }),
    )
    .max(10)
    .refine(hasUniqueIds, "Duplicate issue IDs"),
  evidenceChecklist: z
    .array(
      z.strictObject({
        id: opaqueIdSchema,
        label: displayText(100),
        why: displayText(1000),
        status: z.enum(["provided", "missing", "unknown"]),
      }),
    )
    .max(20)
    .refine(hasUniqueIds, "Duplicate evidence IDs"),
  nextSteps: z
    .array(
      z.strictObject({
        id: opaqueIdSchema,
        label: displayText(100),
        purpose: displayText(1000),
        caution: displayText(1000),
        citationIds: citationIdsSchema,
      }),
    )
    .max(10)
    .refine(hasUniqueIds, "Duplicate next-step IDs"),
  citations: z.array(citationSchema).max(20).refine(hasUniqueIds, "Duplicate citation IDs"),
  noticeVersion: z.literal(CURRENT_POLICY_VERSIONS.aiNoticeVersion),
});
// No help destinations have publication approval yet. Callers supply the server's approved
// label/URL pairs explicitly; a model-provided URL never becomes an allowlist entry.
const helpLinkSchema = z.strictObject({
  label: displayText(100),
  url: z
    .string()
    .max(2048)
    .url()
    .refine((value) => {
      if (!URL.canParse(value)) return false;
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password && !url.port;
    }),
});
const policyBase = {
  ...resultBase,
  message: displayText(2000),
  helpLinks: z.array(helpLinkSchema).max(5),
};
export const resultShapeSchema = z.discriminatedUnion("kind", [
  guidanceResultSchema,
  z.strictObject({
    ...policyBase,
    kind: z.literal("out_of_scope"),
    reasonCode: z.enum(["UNSUPPORTED_JURISDICTION", "UNSUPPORTED_CASE_TYPE"]),
  }),
  z.strictObject({
    ...policyBase,
    kind: z.literal("urgent_redirect"),
    reasonCode: z.enum(["IMMEDIATE_DANGER", "URGENT_SAFETY_CONCERN"]),
  }),
]);
function createResultSchema(options?: {
  citations?: readonly z.infer<typeof citationSchema>[];
  helpLinks?: readonly z.infer<typeof helpLinkSchema>[];
}) {
  const approvedCitations = options
    ? (options.citations ?? []).map((citation) => citationSchema.parse(citation))
    : undefined;
  const approvedLinks = options
    ? (options.helpLinks ?? []).map((link) => helpLinkSchema.parse(link))
    : undefined;
  return resultShapeSchema.superRefine((result, context) => {
    if (result.kind === "guidance") {
      const ids = new Set(result.citations.map(({ id }) => id));
      if (
        [...result.issues, ...result.nextSteps].some((item) =>
          item.citationIds.some((id) => !ids.has(id)),
        )
      )
        context.addIssue({ code: "custom", message: "Unknown citation reference" });
      if (result.citations.some((citation) => citation.effectiveDate > result.asOfDate))
        context.addIssue({ code: "custom", message: "Citation is not yet effective" });
      if (
        approvedCitations &&
        result.citations.some(
          (citation) =>
            !approvedCitations.some((approved) =>
              Object.keys(approved).every(
                (key) =>
                  approved[key as keyof typeof approved] === citation[key as keyof typeof citation],
              ),
            ),
        )
      )
        context.addIssue({ code: "custom", message: "Citation is outside verified allowlist" });
    } else if (
      approvedLinks &&
      result.helpLinks.some(
        (link) =>
          !approvedLinks.some(
            (approved) => approved.label === link.label && approved.url === link.url,
          ),
      )
    ) {
      context.addIssue({ code: "custom", message: "Help link is outside server allowlist" });
    }
  });
}
/** Stored/wire shape; generation must additionally use resultForAllowlistSchema. */
export const resultSchema = createResultSchema();
/** Generation boundary: omitted allowlists fail closed to an empty approved set. */
export const resultForAllowlistSchema = (
  options: {
    citations?: readonly z.infer<typeof citationSchema>[];
    helpLinks?: readonly z.infer<typeof helpLinkSchema>[];
  } = {},
) => createResultSchema(options);
export type Citation = z.infer<typeof citationSchema>;
export type Result = z.infer<typeof resultSchema>;
