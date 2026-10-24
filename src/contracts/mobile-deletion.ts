import { z } from "zod";
import {
  mobileAuthAttemptIdSchema,
  mobileAuthChallengeSchema,
  mobileAuthCodeSchema,
  mobileAuthV2ProviderSchema,
  mobileAuthVerifierSchema,
} from "./mobile-auth";

export const mobileDeletionPrepareSchema = z.strictObject({
  attemptId: mobileAuthAttemptIdSchema,
  challenge: mobileAuthChallengeSchema,
  provider: mobileAuthV2ProviderSchema,
  confirmation: z.literal("DELETE"),
});
export const mobileDeletionStartSchema = z.strictObject({
  attemptId: mobileAuthAttemptIdSchema,
  challenge: mobileAuthChallengeSchema,
  purpose: z.literal("delete-account"),
});
export const mobileDeletionProofSchema = z.strictObject({
  attemptId: mobileAuthAttemptIdSchema,
  verifier: mobileAuthVerifierSchema,
});
export const mobileDeletionExchangeSchema = mobileDeletionProofSchema.extend({
  code: mobileAuthCodeSchema,
});
export const mobileDeletionOutcomeSchema = z.strictObject({
  contractVersion: z.literal(2),
  status: z.literal("accepted"),
  ownerTag: z.string().regex(/^[a-f0-9]{64}$/),
  appleRevocation: z.enum(["not_linked", "confirmed", "unconfirmed"]),
});
export const mobileDeletionCancelResponseSchema = z.union([
  z.strictObject({ status: z.literal("cancelled") }),
  mobileDeletionOutcomeSchema,
]);
export type MobileDeletionOutcome = z.infer<typeof mobileDeletionOutcomeSchema>;
