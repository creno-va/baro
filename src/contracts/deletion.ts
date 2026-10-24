import { z } from "zod";
import { mobileAuthV2ProviderSchema } from "./mobile-auth";

export const accountDeletionRequestSchema = z.strictObject({ confirmation: z.literal("DELETE") });
export const accountDeletionResponseSchema = z.strictObject({ status: z.literal("accepted") });
export const deletionAccessSchema = z.strictObject({
  ownerTag: z.string().regex(/^[a-f0-9]{64}$/),
  recentOAuth: z.boolean(),
  authenticatedAt: z.iso.datetime().nullable(),
  providers: z.array(z.enum(["google", "naver", "kakao"])).max(3),
});
/** Only returned after explicit x-baro-auth-contract: 2 negotiation. */
export const deletionAccessV2Schema = deletionAccessSchema.extend({
  contractVersion: z.literal(2),
  providers: z
    .array(mobileAuthV2ProviderSchema)
    .max(4)
    .refine((providers) => new Set(providers).size === providers.length),
});
