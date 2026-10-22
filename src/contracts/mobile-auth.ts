import { z } from "zod";

const proof = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const mobileAuthAttemptIdSchema = z.uuid();
export const mobileAuthChallengeSchema = proof;
export const mobileAuthVerifierSchema = proof;
export const mobileAuthCodeSchema = proof;
export const mobileAuthStartSchema = z.strictObject({
  attemptId: mobileAuthAttemptIdSchema,
  challenge: mobileAuthChallengeSchema,
});
export const mobileAuthReturnSchema = z.strictObject({
  attemptId: mobileAuthAttemptIdSchema,
  code: mobileAuthCodeSchema,
});
export const mobileAuthExchangeSchema = z.strictObject({
  attemptId: mobileAuthAttemptIdSchema,
  code: mobileAuthCodeSchema,
  verifier: mobileAuthVerifierSchema,
});
export const mobileAuthExchangeResponseSchema = z.strictObject({ status: z.literal("accepted") });
export type MobileAuthStart = z.infer<typeof mobileAuthStartSchema>;
export type MobileAuthExchange = z.infer<typeof mobileAuthExchangeSchema>;
