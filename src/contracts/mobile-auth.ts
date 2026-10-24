import { z } from "zod";

const proof = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
// Existing apps retain their strict three-provider wire contract.
export const legacyMobileAuthProviderSchema = z.enum(["google", "naver", "kakao"]);
export const mobileAuthV2ProviderSchema = z.enum(["google", "naver", "kakao", "apple"]);
export const MOBILE_AUTH_CONTRACT_HEADER = "x-baro-auth-contract";
export const mobileAuthCapabilitiesSchema = z.strictObject({
  contractVersion: z.literal(2),
  providers: z
    .array(mobileAuthV2ProviderSchema)
    .max(4)
    .refine((providers) => new Set(providers).size === providers.length),
});
export const mobileAuthAttemptIdSchema = z.uuid();
export const mobileAuthChallengeSchema = proof;
export const mobileAuthVerifierSchema = proof;
export const mobileAuthCodeSchema = proof;
export const mobileAuthStartSchema = z.strictObject({
  attemptId: mobileAuthAttemptIdSchema,
  challenge: mobileAuthChallengeSchema,
  purpose: z.literal("reauthenticate").optional(),
});
export const mobileAuthReturnSchema = z.strictObject({
  attemptId: mobileAuthAttemptIdSchema,
  code: mobileAuthCodeSchema,
});
export const mobileAuthExchangeSchema = z.strictObject({
  attemptId: mobileAuthAttemptIdSchema,
  code: mobileAuthCodeSchema,
  verifier: mobileAuthVerifierSchema,
  purpose: z.literal("reauthenticate").optional(),
});
export const mobileReauthPrepareSchema = z.strictObject({
  attemptId: mobileAuthAttemptIdSchema,
  challenge: mobileAuthChallengeSchema,
  provider: legacyMobileAuthProviderSchema,
});
export const mobileReauthPrepareV2Schema = mobileReauthPrepareSchema.extend({
  provider: mobileAuthV2ProviderSchema,
});
export const mobileReauthProofSchema = z.strictObject({
  attemptId: mobileAuthAttemptIdSchema,
  verifier: mobileAuthVerifierSchema,
});
export const mobileReauthReceiptSchema = z.strictObject({
  ownerTag: z.string().regex(/^[a-f0-9]{64}$/),
  startedAt: z.number().int().nonnegative(),
});
export type MobileReauthPrepare = z.infer<typeof mobileReauthPrepareSchema>;
export type MobileReauthReceipt = z.infer<typeof mobileReauthReceiptSchema>;
export const mobileAuthExchangeResponseSchema = z.strictObject({ status: z.literal("accepted") });
export type MobileAuthStart = z.infer<typeof mobileAuthStartSchema>;
export type MobileAuthExchange = z.infer<typeof mobileAuthExchangeSchema>;
