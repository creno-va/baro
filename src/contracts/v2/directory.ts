import { z } from "zod";
import { opaqueIdSchema, revisionSchema, timestampSchema } from "../index";
import { v2LegalFieldSchema, v2RegionSchema } from "./lawyers";

export const directoryCursorSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]+$/)
  .min(32)
  .max(2048);
export const directorySearchSchema = z.strictObject({
  name: z.string().trim().min(1).max(100).optional(),
  region: v2RegionSchema.optional(),
  legalField: v2LegalFieldSchema.optional(),
  limit: z.number().int().min(1).max(50).default(20),
  cursor: directoryCursorSchema.optional(),
});
/** Only fields displayed by a directory card. Contact/address/portfolio and
 * all private draft, case and qualification material stay outside this DTO. */
export const directoryItemSchema = z.strictObject({
  id: opaqueIdSchema,
  revision: revisionSchema,
  name: z.string().min(1).max(100),
  officeName: z.string().min(1).max(200),
  introduction: z.string().max(5000),
  region: v2RegionSchema,
  practiceAreas: v2LegalFieldSchema.array().max(11),
  photoUrl: z.string().max(512).nullable(),
  photoAssetId: opaqueIdSchema.nullable(),
  verificationStatus: z.enum(["self_declared", "verified"]),
});
export const directoryPageSchema = z.strictObject({
  items: directoryItemSchema.array().max(50),
  nextCursor: directoryCursorSchema.nullable(),
  expiresAt: timestampSchema,
  rotation: z.strictObject({
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    algorithm: z.literal("daily_sha256_pivot_v1"),
  }),
});
export type DirectoryItem = z.infer<typeof directoryItemSchema>;
export type DirectoryPage = z.infer<typeof directoryPageSchema>;
export type DirectorySearch = z.infer<typeof directorySearchSchema>;
