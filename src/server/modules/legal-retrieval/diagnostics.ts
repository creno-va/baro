import { z } from "zod";
import { legalFailureReasonSchema } from "../../../contracts/v2/legal-availability";

const duration = z.number().int().min(0).max(120000);
const request = z.strictObject({
  endpointId: z.enum([
    "moleg_eflaw_list",
    "moleg_eflaw_detail",
    "moleg_prec_list",
    "moleg_prec_detail",
    "easylaw_text_section",
  ]),
  attempt: z.number().int().min(1).max(3),
  durationMs: duration,
  httpStatus: z.number().int().min(100).max(599).nullable(),
  reason: legalFailureReasonSchema.nullable(),
});
const outcome = z.strictObject({
  kind: z.enum(["statute", "precedent", "official_guide"]),
  availability: z.enum(["verified", "limited", "unavailable", "not_requested"]),
  reason: legalFailureReasonSchema.nullable(),
  sourceFailures: legalFailureReasonSchema.array().max(21),
  verifiedSourceCount: z.number().int().min(0).max(50),
  durationMs: duration,
});
export type LegalOutcomeObservation = z.infer<typeof outcome>;
const rejection = z.strictObject({
  endpointId: z.enum([
    "moleg_eflaw_list",
    "moleg_eflaw_detail",
    "moleg_prec_list",
    "moleg_prec_detail",
  ]),
  category: z.enum([
    "upstream-registration-rejected",
    "upstream-credential-rejected",
    "upstream-error",
  ]),
});
export function safeLegalRejection(value: unknown) {
  try {
    const parsed = rejection.safeParse(value);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
export function safeLegalRequest(value: unknown) {
  try {
    const parsed = request.safeParse(value);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
export function safeLegalOutcome(value: unknown) {
  try {
    const parsed = outcome.safeParse(value);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
