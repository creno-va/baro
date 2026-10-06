import { z } from "zod";
import "./common";

export const CURRENT_POLICY_VERSIONS = {
  termsVersion: "2026-10-04",
  privacyVersion: "2026-10-04",
  aiNoticeVersion: "2026-10-04",
} as const;

export const consentInputSchema = z
  .object({
    termsVersion: z.literal(CURRENT_POLICY_VERSIONS.termsVersion),
    privacyVersion: z.literal(CURRENT_POLICY_VERSIONS.privacyVersion),
    aiNoticeVersion: z.literal(CURRENT_POLICY_VERSIONS.aiNoticeVersion),
    over14Confirmed: z.literal(true),
  })
  .strict();

export type ConsentInput = z.infer<typeof consentInputSchema>;
