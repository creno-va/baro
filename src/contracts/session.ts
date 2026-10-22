import { z } from "zod";

/** Revocation hint only; it never supplies authentication or permissions. */
export const EXPECTED_OWNER_HEADER = "x-baro-expected-owner";

export const clientAccountTypeSchema = z.enum(["customer", "lawyer"]);
export const sessionViewSchema = z.object({
  user: z
    .object({ id: z.string().min(1), name: z.string(), accountType: clientAccountTypeSchema })
    .nullable(),
  needsConsent: z.boolean(),
});
export const consentStatusSchema = z.object({
  required: z.object({
    termsVersion: z.string(),
    privacyVersion: z.string(),
    aiNoticeVersion: z.string(),
  }),
  consent: z.unknown(),
  needsConsent: z.boolean(),
});
export type ClientSession = z.infer<typeof sessionViewSchema>;
export type ConsentStatus = z.infer<typeof consentStatusSchema>;
