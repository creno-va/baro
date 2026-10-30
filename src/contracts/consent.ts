import { z } from "zod";

export const CURRENT_POLICY_VERSIONS = {
  termsVersion: "2026-10-31",
  privacyVersion: "2026-10-31",
  aiNoticeVersion: "2026-10-31",
} as const;

/** The 2026-10-31 notice documents the same file processing purposes. Preserve
 * prior per-file authorization without rewriting its version/time; account-wide
 * processing still requires fresh acceptance of CURRENT_POLICY_VERSIONS. */
export const PREVIOUS_AI_NOTICE_VERSION = "2026-10-04";
export const COMPATIBLE_FILE_AI_NOTICE_VERSION = PREVIOUS_AI_NOTICE_VERSION;

export const consentInputSchema = z
  .object({
    termsVersion: z.literal(CURRENT_POLICY_VERSIONS.termsVersion),
    privacyVersion: z.literal(CURRENT_POLICY_VERSIONS.privacyVersion),
    aiNoticeVersion: z.literal(CURRENT_POLICY_VERSIONS.aiNoticeVersion),
    over14Confirmed: z.literal(true),
  })
  .strict();

export type ConsentInput = z.infer<typeof consentInputSchema>;
