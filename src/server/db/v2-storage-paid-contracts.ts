import { z } from "zod";
import { opaqueIdSchema, revisionSchema } from "../../contracts";
import { hashSchema } from "./v2-core";
import { executionPlanSchema, paidHoldRequestSchema } from "./v2-paid-contracts";

const original = z.strictObject({
  kind: z.literal("case_original"),
  uploadId: opaqueIdSchema,
  uploadRevision: revisionSchema,
  ordinal: z.number().int().min(0).max(119),
});
const lawyer = z.strictObject({ kind: z.literal("lawyer_original") });
const publicCopy = z.strictObject({
  kind: z.literal("approved_public_copy"),
  approvedRevisionId: opaqueIdSchema,
  sourceBlobId: opaqueIdSchema,
});
// These are trusted execution descriptors, never client pricing or receipts.
export const storagePaidHoldRequestSchema = paidHoldRequestSchema
  .omit({ jobId: true, targetKind: true })
  .extend({
    service: z.enum(["storage", "requests"]),
    targetKind: z.enum(["file", "profile_asset"]),
    reservationId: opaqueIdSchema,
    blobId: opaqueIdSchema,
    pending: z.strictObject({
      logicalBytes: z.number().int().min(1).max(1000000000),
      cipherBytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
      cipherHash: hashSchema.nullable(),
      keyVersion: z.string().min(1).max(100).nullable(),
    }),
    intent: z.discriminatedUnion("kind", [original, lawyer, publicCopy]),
    plan: executionPlanSchema,
  })
  .refine((p) => (p.intent.kind === "case_original") === (p.targetKind === "file"));
export type StoragePaidHoldRequest = z.infer<typeof storagePaidHoldRequestSchema>;
