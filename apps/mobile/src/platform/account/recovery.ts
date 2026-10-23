import { z } from "zod";

/** Opaque facts only. No cookie, OAuth proof/provider token or profile/case data. */
export const nativeAccountDeletionRecordSchema = z.strictObject({
  version: z.literal(1),
  ownerTag: z.string().regex(/^[a-f0-9]{64}$/),
  key: z.uuid(),
  authenticatedAt: z.iso.datetime(),
  state: z.enum(["attempted", "accepted"]),
});
export type NativeAccountDeletionRecord = z.infer<typeof nativeAccountDeletionRecordSchema>;
