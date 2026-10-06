import { z } from "zod";
import { v2FileProbeSchema, v2HashSchema } from "../../../contracts/v2";
import { MAX_ARTIFACT_BYTES } from "./protocol";

export const sanitizedManifestSchema = z
  .strictObject({
    version: z.literal(1),
    passes: z.literal(2),
    probe: v2FileProbeSchema,
    format: z.enum(["jpeg", "pdf"]),
    byteLength: z.number().int().positive().max(100_000_000),
    contentHash: v2HashSchema,
    chunkCount: z.number().int().positive().max(96),
  })
  .refine((m) => m.chunkCount === Math.ceil(m.byteLength / MAX_ARTIFACT_BYTES))
  .refine((m) => m.probe.byteLength <= 100_000_000)
  .refine((m) =>
    m.format === "jpeg"
      ? m.probe.category === "image"
      : m.probe.category === "document" && m.probe.format === "pdf",
  );
export type SanitizedManifest = z.infer<typeof sanitizedManifestSchema>;
export const sanitizedRecordSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("sanitized_manifest"), value: sanitizedManifestSchema }),
  z.strictObject({
    type: z.literal("sanitized_chunk"),
    pass: z.union([z.literal(0), z.literal(1)]),
    index: z.number().int().min(0).max(95),
    data: z
      .string()
      .max(1_398_104)
      .regex(/^[A-Za-z0-9+/]*={0,2}$/),
  }),
  z.strictObject({ type: z.literal("complete") }),
]);
