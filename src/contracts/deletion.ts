import { z } from "zod";

export const accountDeletionRequestSchema = z.strictObject({ confirmation: z.literal("DELETE") });
export const accountDeletionResponseSchema = z.strictObject({ status: z.literal("accepted") });
export const deletionAccessSchema = z.strictObject({
  ownerTag: z.string().regex(/^[a-f0-9]{64}$/),
  recentOAuth: z.boolean(),
  authenticatedAt: z.iso.datetime().nullable(),
  providers: z.array(z.enum(["google", "naver", "kakao"])).max(3),
});
