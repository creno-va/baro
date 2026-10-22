import { CURRENT_POLICY_VERSIONS } from "@baro/contracts/consent";
import { consentStatusSchema } from "@baro/contracts/session";

/** Synthetic equivalent of /api/me/consent's complete wire shape, never a live consent receipt. */
export function syntheticConsentStatus(needsConsent: boolean) {
  return consentStatusSchema.parse({
    required: CURRENT_POLICY_VERSIONS,
    consent: needsConsent
      ? null
      : {
          userId: "synthetic-owner",
          ...CURRENT_POLICY_VERSIONS,
          over14Confirmed: true,
          consentedAt: "2026-10-22T00:00:00.000Z",
        },
    needsConsent,
  });
}
