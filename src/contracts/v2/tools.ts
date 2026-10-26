import { z } from "zod";
import { displayText, opaqueIdSchema, timestampSchema } from "../common";

export const v2LookupToolIdSchema = z.enum([
  "hometax_status",
  "thecheat",
  "registry",
  "datahub_property",
  "datahub_building",
]);

export const LOOKUP_CONSENT_VERSION = "2026-10-27" as const;
const consent = <T extends string>(recipient: T) =>
  z.strictObject({
    version: z.literal(LOOKUP_CONSENT_VERSION),
    recipient: z.literal(recipient),
    transmit: z.literal(true),
  });
const digits = (maximum: number) => z.string().regex(/^\d+$/).max(maximum);
/** Explicit user input, kept in the encrypted request. Never a model argument. */
export const v2LookupRequestSchema = z.discriminatedUnion("tool", [
  z.strictObject({
    tool: z.literal("hometax_status"),
    target: z.strictObject({ businessNumber: z.string().regex(/^\d{10}$/) }),
    consent: consent("nts"),
  }),
  z.strictObject({
    tool: z.literal("thecheat"),
    target: z.strictObject({
      kind: z.enum(["phone", "account"]),
      keyword: digits(20).min(8),
      bankCode: z
        .string()
        .regex(/^\d{3}$/)
        .optional(),
    }),
    consent: consent("thecheat"),
  }),
  z.strictObject({
    tool: z.literal("datahub_property"),
    target: z.strictObject({ address: z.string().trim().min(5).max(200) }),
    consent: consent("datahub"),
  }),
  z.strictObject({
    tool: z.literal("datahub_building"),
    target: z.strictObject({
      INNB: digits(19).min(1),
      RNMGTSN: digits(12).min(1),
      BULDMNNM: digits(5).min(1),
      BULDSLNO: digits(5).min(1),
    }),
    consent: consent("datahub"),
  }),
]);
export const v2LookupRequestsSchema = z
  .array(v2LookupRequestSchema)
  .min(1)
  .max(2)
  .refine(
    (requests) => new Set(requests.map((request) => request.tool)).size === requests.length,
    "Duplicate lookup tools",
  );
export type V2LookupRequest = z.infer<typeof v2LookupRequestSchema>;
export const v2ToolResultSchema = z
  .strictObject({
    id: opaqueIdSchema,
    tool: v2LookupToolIdSchema,
    status: z.enum([
      "not_configured",
      "input_required",
      "retrieved",
      "no_record",
      "test_data",
      "unavailable",
      "access_denied",
    ]),
    title: displayText(100),
    sourceUrl: z.enum([
      "https://www.data.go.kr/data/15081808/openapi.do",
      "https://apicenter.thecheat.co.kr/",
      "https://data.iros.go.kr/",
      "https://dataapi.co.kr/",
    ]),
    observedAt: timestampSchema.nullable(),
    rows: z.array(z.strictObject({ label: displayText(100), value: displayText(1000) })).max(20),
    notices: z.array(displayText(500)).max(5),
  })
  .refine(
    (result) =>
      (["retrieved", "no_record", "test_data"].includes(result.status)
        ? result.observedAt !== null
        : result.observedAt === null) &&
      (result.status === "retrieved" ? result.rows.length > 0 : result.rows.length === 0) &&
      result.sourceUrl ===
        (
          {
            hometax_status: "https://www.data.go.kr/data/15081808/openapi.do",
            thecheat: "https://apicenter.thecheat.co.kr/",
            registry: "https://data.iros.go.kr/",
            datahub_property: "https://dataapi.co.kr/",
            datahub_building: "https://dataapi.co.kr/",
          } as const
        )[result.tool],
    "Unsuccessful lookup cannot contain factual result rows",
  );
export type V2LookupToolId = z.infer<typeof v2LookupToolIdSchema>;
export type V2ToolResult = z.infer<typeof v2ToolResultSchema>;
export const v2ToolResultsSchema = z.array(v2ToolResultSchema).max(2);
