import { z } from "zod";
import { displayText, opaqueIdSchema, timestampSchema } from "../common";

export const v2LookupToolIdSchema = z.enum([
  "hometax_status",
  "thecheat",
  "registry",
  "datahub_property",
  "datahub_building",
]);
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
