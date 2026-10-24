import { z } from "zod";
import {
  mobileAuthAttemptIdSchema,
  mobileAuthChallengeSchema,
  mobileAuthCodeSchema,
  mobileAuthV2ProviderSchema,
  mobileAuthVerifierSchema,
  mobileReauthReceiptSchema,
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

export const mobileDeletionPrepareReceiptSchema = mobileReauthReceiptSchema.extend({
  activityProof: z.string().regex(/^[a-f0-9]{64}$/),
});
export const mobileDeletionActivityRequestSchema = mobileDeletionProofSchema.extend({
  ownerTag: mobileDeletionOutcomeSchema.shape.ownerTag,
  startedAt: mobileReauthReceiptSchema.shape.startedAt,
  activityProof: mobileDeletionPrepareReceiptSchema.shape.activityProof,
});

/** Authentication activity only. Neither inactive nor missing intent proves an account-deletion outcome. */
export const mobileDeletionActivitySchema = z.strictObject({
  contractVersion: z.literal(2),
  attemptId: mobileAuthAttemptIdSchema,
  status: z.enum(["active", "inactive"]),
  outcome: z.literal("unknown"),
  observedAt: z.iso.datetime(),
});
export type MobileDeletionActivity = z.infer<typeof mobileDeletionActivitySchema>;
