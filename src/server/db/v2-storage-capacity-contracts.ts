import { z } from "zod";
import { opaqueIdSchema, timestampSchema } from "../../contracts";
import { hashSchema } from "./v2-core";

export const PHYSICAL_STORAGE_CAP_BYTES = 100000000000;
const count = z.number().int().min(0).max(1000000);
export const storageProjectionSchema = z.strictObject({
  id: opaqueIdSchema,
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  capacityBytes: z.number().int().positive().max(PHYSICAL_STORAGE_CAP_BYTES),
  storageClass: z.literal("standard"),
  pricingProofId: opaqueIdSchema,
  fundingProofId: opaqueIdSchema,
  allocationProofId: opaqueIdSchema,
  expectedControlRevision: z.number().int().positive(),
  inventoryHash: hashSchema,
  getLimit: count,
  headLimit: count,
  deleteLimit: count,
  workerCpuMsPerIO: z.number().int().min(1).max(300000),
  d1RowsReadPerIO: z.number().int().min(1).max(1000000),
  d1RowsWrittenPerIO: z.number().int().min(1).max(1000000),
});
export type StorageProjection = z.infer<typeof storageProjectionSchema>;
export const physicalBindingSchema = z.strictObject({
  blobId: opaqueIdSchema,
  ownerId: opaqueIdSchema,
  objectKey: z
    .string()
    .regex(/^(private|public)\/[A-Za-z0-9_-]+$/)
    .max(136),
  maximumCipherBytes: z.number().int().positive().max(PHYSICAL_STORAGE_CAP_BYTES),
});
export type PhysicalBinding = z.infer<typeof physicalBindingSchema>;
export const maintenanceIOSchema = z.strictObject({
  blobId: opaqueIdSchema,
  action: z.enum(["get", "head", "delete"]),
});
export type MaintenanceIO = z.infer<typeof maintenanceIOSchema>;
export const storageInventorySchema = z
  .strictObject({
    id: opaqueIdSchema,
    manifestHash: hashSchema,
    observedAt: timestampSchema.transform((value) => new Date(value).toISOString()),
    bindings: z
      .array(physicalBindingSchema.extend({ writerState: z.enum(["stopped", "unknown"]) }))
      .min(1)
      .max(25),
  })
  .refine(
    (value) =>
      new Set(value.bindings.map((binding) => binding.blobId)).size === value.bindings.length,
  );
