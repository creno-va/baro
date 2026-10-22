import { z } from "zod";
import { v2CreateCaseRequestSchema } from "./v2/workspace";

export const MOBILE_CHALLENGE_PATH = "/api/mobile/challenge";
export const MOBILE_CHALLENGE_ACTION = "case_create";
export const MOBILE_CHALLENGE_TIMEOUT_MS = 120_000;
export const mobileChallengeAttemptSchema = z.uuid();
export const mobileChallengeSecretSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const mobileChallengeQuerySchema = z.strictObject({
  attemptId: mobileChallengeAttemptSchema,
});
export const mobileChallengeReadySchema = z.strictObject({
  type: z.literal("ready"),
  attemptId: mobileChallengeAttemptSchema,
});
export const mobileChallengeMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("token"),
    attemptId: mobileChallengeAttemptSchema,
    secret: mobileChallengeSecretSchema,
    token: v2CreateCaseRequestSchema.shape.turnstileToken,
  }),
  z.strictObject({
    type: z.literal("error"),
    attemptId: mobileChallengeAttemptSchema,
    secret: mobileChallengeSecretSchema,
    reason: z.enum(["failed", "expired", "unavailable"]),
  }),
]);
