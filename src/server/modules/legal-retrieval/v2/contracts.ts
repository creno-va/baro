import { z } from "zod";
import { dateSchema, displayText, timestampSchema } from "../../../../contracts";
import type { V2OfficialCitation } from "../../../../contracts/v2";
import type { OfficialSourceWrite } from "../../../db/v2-official-sources";

export const digits = z
  .union([z.string().regex(/^\d{1,12}$/), z.number().int().nonnegative().max(999999999999)])
  .transform((value) => BigInt(value).toString());
export const apiDate = z
  .union([z.string().regex(/^\d{8}$/), z.number().int()])
  .transform((value) => {
    const text = String(value);
    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6)}`;
  })
  .pipe(dateSchema);
export const articleSchema = z.strictObject({
  number: z
    .string()
    .regex(/^\d{1,4}$/)
    .refine((v) => Number(v) > 0),
  branch: z
    .string()
    .regex(/^\d{1,2}$/)
    .default("0"),
});
export const planSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("statute"),
    lawTitle: displayText(100),
    lawId: digits.optional(),
    articles: z
      .array(articleSchema)
      .min(1)
      .max(10)
      .refine(
        (rows) =>
          new Set(rows.map((row) => `${BigInt(row.number)}:${BigInt(row.branch)}`)).size ===
          rows.length,
        "Duplicate article identities",
      ),
  }),
  z.strictObject({
    kind: z.literal("precedent"),
    query: displayText(100),
    limit: z.number().int().min(1).max(10).default(3),
  }),
  z.strictObject({
    kind: z.literal("official_guide"),
    institutionId: z.literal("moleg_easylaw"),
    endpointId: z.literal("easylaw_text_section"),
    csmSeq: digits,
    ccfNo: digits,
    cciNo: digits,
    cnpClsNo: digits,
  }),
]);
export const requestSchema = z
  .strictObject({
    asOfDate: dateSchema,
    now: timestampSchema.transform((v) => new Date(v).toISOString()),
    plans: z
      .array(planSchema)
      .max(6)
      .refine(
        (plans) => new Set(plans.map((p) => JSON.stringify(p))).size === plans.length,
        "Duplicate plans",
      ),
  })
  .refine(
    (value) =>
      value.plans.reduce(
        (sum, plan) =>
          sum +
          (plan.kind === "statute"
            ? plan.articles.length
            : plan.kind === "precedent"
              ? plan.limit
              : 1),
        0,
      ) <= 50,
    "Too many citation candidates",
  )
  .refine(
    (value) =>
      value.asOfDate <= new Date(Date.parse(value.now) + 9 * 3600000).toISOString().slice(0, 10),
    "Future as-of date",
  );
export type RetrievalPlan = z.infer<typeof planSchema>;
export type SourceKind = RetrievalPlan["kind"];
export type Availability = "verified" | "limited" | "unavailable" | "not_requested";
export type FailureReason =
  | "configuration_missing"
  | "not_authorized"
  | "budget_exhausted"
  | "cancelled"
  | "timeout"
  | "rate_limited"
  | "upstream_unavailable"
  | "upstream_rejected"
  | "schema_mismatch"
  | "too_large"
  | "unsafe_url"
  | "identity_mismatch"
  | "date_invalid"
  | "no_results"
  | "history_incomplete"
  | "unsupported_format"
  | "rights_unverified"
  | "unknown_publication_date"
  | "update_pending"
  | "image_omitted"
  | "cache_invalid";
export class RetrievalFailure extends Error {
  constructor(readonly reason: FailureReason) {
    super(`LEGAL_RETRIEVAL_${reason.toUpperCase()}`);
  }
}
export type SourceChunk = {
  citation: V2OfficialCitation;
  source: OfficialSourceWrite;
  span: { startUtf16: number; endUtf16: number; text: string };
  applicability: "requires_review";
};
export type SourceOutcome = {
  kind: SourceKind;
  availability: Availability;
  reason: FailureReason | null;
  chunks: SourceChunk[];
};
export type RetrievalOutput = {
  schemaVersion: "2";
  asOfDate: string;
  outcomes: SourceOutcome[];
  chunks: SourceChunk[];
  retrievalHash: string;
  legalSourceStatus: "verified" | "unavailable" | "not_requested";
  factualPreparationAvailable: true;
};
export type Access = {
  authorize: () => Promise<boolean>;
  // #64 supplies its privacy-reviewed legal concept gate, never raw case text.
  authorizeQuery: (query: string) => Promise<boolean>;
  reserveRequest: (attempt: {
    invocationId: string;
    attempt: number;
    endpointId: string;
  }) => Promise<boolean>;
  signal?: AbortSignal;
};
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const MAX_SOURCE_BYTES = 1024 * 1024;
export const EXTRACTOR_VERSION = "official-text-v2-1";
export async function safePermit(action: () => Promise<boolean>) {
  try {
    return await action();
  } catch {
    return false;
  }
}
