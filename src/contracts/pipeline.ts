import { z } from "zod";
import { boundedText, dateSchema, displayText, schemaVersionSchema } from "./common";
import { citationSchema, contentHashSchema, resultSchema } from "./results";

export const factSchema = z
  .strictObject({
    value: displayText(300).nullable(),
    originalValue: boundedText(1, 300).nullable(),
    source: z.enum(["user", "official_source", "ai_organization"]),
    confidence: z.enum(["stated", "verified", "inferred", "unknown"]),
  })
  .refine((fact) => {
    if (fact.confidence === "unknown") return fact.value === null;
    if (fact.value === null) return false;
    if (fact.source === "user") return fact.confidence === "stated" && fact.originalValue !== null;
    if (fact.source === "official_source") return fact.confidence === "verified";
    return fact.confidence === "inferred";
  }, "Keep user statements, verified sources, AI organization and unknown facts separate");
export const minimizedInputSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  sentences: z.array(boundedText(1, 1000)).max(30),
  maskingHints: z.array(displayText(100)).max(20),
});
export const screeningOutputSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    inScope: z.boolean(),
    urgency: z.enum(["none", "uncertain", "urgent"]),
    reasonCode: z.enum([
      "IN_SCOPE",
      "NEEDS_CLARIFICATION",
      "UNSUPPORTED_JURISDICTION",
      "UNSUPPORTED_CASE_TYPE",
      "IMMEDIATE_DANGER",
      "URGENT_SAFETY_CONCERN",
    ]),
  })
  .refine((screening) => {
    if (screening.urgency === "urgent")
      return ["IMMEDIATE_DANGER", "URGENT_SAFETY_CONCERN"].includes(screening.reasonCode);
    if (!screening.inScope)
      return ["UNSUPPORTED_JURISDICTION", "UNSUPPORTED_CASE_TYPE"].includes(screening.reasonCode);
    return ["IN_SCOPE", "NEEDS_CLARIFICATION"].includes(screening.reasonCode);
  }, "Inconsistent screening decision");
export const structuredCaseSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  parties: z.array(factSchema).max(10),
  amounts: z.array(factSchema).max(20),
  dates: z.array(factSchema).max(20),
  agreements: z.array(factSchema).max(20),
  performance: z.array(factSchema).max(20),
  evidence: z.array(factSchema).max(20),
  unknowns: z.array(displayText(300)).max(20),
});
export const retrievalOutputSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    asOfDate: dateSchema,
    chunks: z
      .array(z.strictObject({ citation: citationSchema, text: boundedText(1, 20000) }))
      .max(20),
    retrievalHash: contentHashSchema,
  })
  .refine(
    ({ chunks, asOfDate }) =>
      new Set(chunks.map(({ citation }) => citation.id)).size === chunks.length &&
      chunks.every(({ citation }) => citation.effectiveDate <= asOfDate),
    "Invalid retrieved citation set",
  );
export const validationOutputSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    pass: z.boolean(),
    sanitizedResult: resultSchema.nullable(),
    findings: z
      .array(
        z.strictObject({
          code: z.enum([
            "UNSUPPORTED_FACT",
            "UNVERIFIED_CITATION",
            "PROHIBITED_OUTPUT",
            "SCOPE_VIOLATION",
            "PRIVACY_LEAK",
            "INVALID_SCHEMA",
          ]),
          severity: z.enum(["warning", "critical"]),
        }),
      )
      .max(20),
  })
  .refine(
    ({ pass, findings, sanitizedResult }) =>
      pass
        ? sanitizedResult !== null && !findings.some(({ severity }) => severity === "critical")
        : sanitizedResult === null,
    "Critical findings must fail closed",
  );
export type StructuredFact = z.infer<typeof factSchema>;
export type StructuredCase = z.infer<typeof structuredCaseSchema>;
export type ScreeningOutput = z.infer<typeof screeningOutputSchema>;
