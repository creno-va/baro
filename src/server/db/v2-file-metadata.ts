import { z } from "zod";
import { v2FileProbeSchema, v2UploadReservationRequestSchema } from "../../contracts/v2";
import { hashSchema } from "./v2-core";

export const storedFileMetadataSchema = z.strictObject({
  name: v2UploadReservationRequestSchema.shape.name,
  declaredMediaType: v2UploadReservationRequestSchema.shape.mediaType,
  probe: v2FileProbeSchema.nullable(),
  contentHash: hashSchema.optional(),
  // A format-admission result is not a completed upload or a processing job failure.
  uploadRejection: z.literal("FILE_REJECTED").optional(),
});
