import { z } from "zod";
import type { Phase } from "./prompts";

const fields = [
  "output",
  "text",
  "references",
  "warnings",
  "facts",
  "actions",
  "parties",
  "requestedSources",
  "requestedTools",
  "requestedMaterials",
  "sourceClaims",
  "timeline",
  "pass",
  "findings",
  "unsupportedFactIds",
  "legalClaimsSupported",
  "strategyDetected",
  "questions",
  "summary",
  "overview",
  "unknown",
] as const;
const issues = [
  "invalid_type",
  "invalid_value",
  "invalid_format",
  "too_big",
  "too_small",
  "unrecognized_keys",
  "custom",
  "invalid_union",
  "unknown",
] as const;
const schema = z.object({
  phase: z.enum([
    "minimize",
    "screening",
    "structure",
    "questions",
    "generation",
    "validation",
    "workspace_questions",
    "workspace_summary",
    "workspace_precedent_compare",
    "workspace_chat",
    "workspace_audit",
  ]),
  reason: z.enum(["completion_invalid", "incomplete_output", "invalid_json", "schema_invalid"]),
  field: z.enum(fields),
  issue: z.enum(issues),
});
export type ModelSchemaFailure = z.infer<typeof schema>;
export function safeModelSchemaFailure(raw: unknown): ModelSchemaFailure | undefined {
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}
/** Preserve only a known top-level field and issue code, never paths, values or messages. */
export function modelSchemaValidationFailure(phase: Phase, error: z.ZodError): ModelSchemaFailure {
  const first = error.issues[0];
  const issue = first?.code;
  const field = first?.path[0] === "output" ? (first.path[1] ?? "output") : first?.path[0];
  return {
    phase,
    reason: "schema_invalid",
    field: fields.includes(field as (typeof fields)[number])
      ? (field as (typeof fields)[number])
      : "unknown",
    issue: issues.includes(issue as (typeof issues)[number])
      ? (issue as (typeof issues)[number])
      : "unknown",
  };
}
