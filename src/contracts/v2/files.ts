import { z } from "zod";
import {
  boundedText,
  displayText,
  hasUniqueIds,
  opaqueIdSchema,
  revisionSchema,
  timestampSchema,
} from "../common";
import {
  V2_LIMITS,
  v2CountSchema,
  v2FailureCodeSchema,
  v2HashSchema,
  v2JsonRequestSchema,
  v2VersionSchema,
} from "./common";
import { v2SourcePositionSchema } from "./sources";

export const v2FileCategorySchema = z.enum(["document", "image", "audio", "video"]);
export const v2FileProbeSchema = z.discriminatedUnion("category", [
  z
    .strictObject({
      category: z.literal("document"),
      format: z.enum(["pdf", "txt", "docx", "hwp", "hwpx", "xlsx", "pptx", "doc", "xls", "ppt"]),
      byteLength: z.number().int().positive().max(V2_LIMITS.documentImageBytes),
      pageCount: z.number().int().min(1).max(100_000),
    })
    .refine(
      (probe) => probe.format !== "pdf" || probe.pageCount <= V2_LIMITS.pdfPages,
      "PDF page limit",
    ),
  z.strictObject({
    category: z.literal("image"),
    format: z.enum(["jpeg", "png", "webp", "gif", "bmp", "tiff", "heic"]),
    byteLength: z.number().int().positive().max(V2_LIMITS.documentImageBytes),
    width: z.number().int().positive().max(100_000),
    height: z.number().int().positive().max(100_000),
  }),
  z.strictObject({
    category: z.literal("audio"),
    format: z.enum(["mp3", "wav", "m4a", "ogg", "flac", "aac"]),
    byteLength: z.number().int().positive().max(V2_LIMITS.mediaBytes),
    durationSeconds: z.number().positive().max(V2_LIMITS.mediaSeconds),
  }),
  z.strictObject({
    category: z.literal("video"),
    format: z.enum(["mp4", "mov", "webm", "avi", "mkv"]),
    byteLength: z.number().int().positive().max(V2_LIMITS.mediaBytes),
    durationSeconds: z.number().positive().max(V2_LIMITS.mediaSeconds),
    hasAudio: z.boolean(),
  }),
]);
// A client declaration is provisional; only the server probe above admits the real format/duration.
export const v2UploadReservationRequestSchema = z.strictObject({
  name: boundedText(1, 255).refine(
    (name) =>
      ![...name].some((character) => {
        const code = character.codePointAt(0) ?? 0;
        return code < 32 || code === 127 || character === "/" || character === "\\";
      }),
    "Unsafe filename",
  ),
  byteLength: z.number().int().positive().max(V2_LIMITS.mediaBytes),
  mediaType: boundedText(1, 200).refine(
    (mime) => /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(mime),
    "Invalid MIME declaration",
  ),
  autoProcessConsentVersion: boundedText(1, 100),
  contentHash: v2HashSchema.optional(),
});
export const v2UploadSessionSchema = z.strictObject({
  schemaVersion: v2VersionSchema,
  fileId: opaqueIdSchema,
  uploadSession: opaqueIdSchema,
  chunkBytes: z.literal(V2_LIMITS.chunkBytes),
  reservedBytes: z.number().int().positive().max(V2_LIMITS.mediaBytes),
  expiresAt: timestampSchema,
});
export const v2UploadPartSchema = z.strictObject({
  index: z.number().int().min(0).max(119),
  byteLength: z.number().int().positive().max(V2_LIMITS.chunkBytes),
  contentHash: v2HashSchema,
});
export const v2OriginalManifestSchema = z
  .strictObject({
    byteLength: z.number().int().positive().max(V2_LIMITS.mediaBytes),
    contentHash: v2HashSchema,
    parts: z.array(v2UploadPartSchema).min(1).max(120),
  })
  .refine(
    (manifest) =>
      manifest.parts.reduce((sum, part) => sum + part.byteLength, 0) === manifest.byteLength &&
      manifest.parts.every(
        (part, index) =>
          part.index === index &&
          (index === manifest.parts.length - 1 || part.byteLength === V2_LIMITS.chunkBytes),
      ),
    "Parts must be ordered, complete and match the original byte length",
  );
export const v2UploadCompleteRequestSchema = z.strictObject({
  expectedRevision: revisionSchema,
  uploadSession: opaqueIdSchema,
  manifest: v2OriginalManifestSchema,
});

export const v2CoverageIntervalSchema = z
  .strictObject({
    startSeconds: z.number().min(0).max(3600),
    endSeconds: z.number().positive().max(3600),
    status: z.enum(["processed", "low_quality", "silent", "missing", "failed"]),
  })
  .refine((interval) => interval.endSeconds > interval.startSeconds, "Empty coverage interval");
function coversDuration(
  intervals: readonly z.infer<typeof v2CoverageIntervalSchema>[],
  duration: number,
) {
  return (
    intervals.length > 0 &&
    intervals[0]?.startSeconds === 0 &&
    intervals[intervals.length - 1]?.endSeconds === duration &&
    intervals.every(
      (interval, index) =>
        index === 0 || interval.startSeconds === intervals[index - 1]?.endSeconds,
    )
  );
}
export const v2AudioCoverageSchema = z
  .strictObject({
    durationSeconds: z.number().positive().max(3600),
    status: z.enum(["complete", "partial"]),
    intervals: z.array(v2CoverageIntervalSchema).min(1).max(7200),
  })
  .refine(
    (coverage) =>
      coversDuration(coverage.intervals, coverage.durationSeconds) &&
      (coverage.status === "complete") ===
        coverage.intervals.every(
          (interval) => interval.status === "processed" || interval.status === "silent",
        ),
    "Dishonest or discontinuous audio coverage",
  );
export const v2VideoFrameSchema = z.strictObject({
  id: opaqueIdSchema,
  timestampSeconds: z.number().min(0).max(3600),
  frameIndex: z.number().int().min(0).max(10_000_000),
  sampling: z.enum(["one_second", "scene_change"]),
  status: z.enum(["processed", "low_quality", "missing", "failed"]),
});
export const v2CoverageSchema = z.discriminatedUnion("category", [
  z
    .strictObject({
      category: z.literal("document"),
      status: z.enum(["complete", "partial"]),
      pageCount: z.number().int().positive().max(100_000),
      pages: z
        .array(
          z.strictObject({
            page: z.number().int().positive().max(100_000),
            status: z.enum(["processed", "low_quality", "missing", "failed"]),
          }),
        )
        .min(1)
        .max(100_000),
    })
    .refine(
      (coverage) =>
        coverage.pages.length === coverage.pageCount &&
        coverage.pages.every((page, index) => page.page === index + 1) &&
        (coverage.status === "complete") ===
          coverage.pages.every((page) => page.status === "processed"),
      "Dishonest document coverage",
    ),
  z
    .strictObject({
      category: z.literal("image"),
      status: z.enum(["complete", "partial"]),
      observation: z.enum(["processed", "low_quality", "missing", "failed"]),
    })
    .refine(
      (coverage) => (coverage.status === "complete") === (coverage.observation === "processed"),
      "Dishonest image coverage",
    ),
  z.strictObject({ category: z.literal("audio"), audio: v2AudioCoverageSchema }),
  z
    .strictObject({
      category: z.literal("video"),
      durationSeconds: z.number().positive().max(3600),
      status: z.enum(["complete", "partial"]),
      hasAudio: z.boolean(),
      audio: v2AudioCoverageSchema.nullable(),
      frames: z
        .array(v2VideoFrameSchema)
        .min(1)
        .max(20_000)
        .refine(hasUniqueIds, "Duplicate frame IDs"),
      sceneDetection: z.enum(["complete", "failed"]),
      sceneFrameCount: z.number().int().min(0).max(20_000).nullable(),
    })
    .refine((coverage) => {
      if (
        coverage.hasAudio !== (coverage.audio !== null) ||
        (coverage.audio !== null && coverage.audio.durationSeconds !== coverage.durationSeconds)
      )
        return false;
      if (coverage.frames.some((frame) => frame.timestampSeconds >= coverage.durationSeconds))
        return false;
      const sampled = coverage.frames.filter((frame) => frame.sampling === "one_second");
      const scenes = coverage.frames.filter((frame) => frame.sampling === "scene_change");
      if (
        (coverage.sceneFrameCount !== null && coverage.sceneFrameCount !== scenes.length) ||
        (coverage.sceneDetection === "complete" && coverage.sceneFrameCount === null)
      )
        return false;
      if (
        sampled.length !== Math.ceil(coverage.durationSeconds) ||
        sampled.some((frame, index) => frame.timestampSeconds !== index)
      )
        return false;
      return (
        (coverage.status === "complete") ===
        (coverage.sceneDetection === "complete" &&
          coverage.frames.every((frame) => frame.status === "processed") &&
          (coverage.audio === null || coverage.audio.status === "complete"))
      );
    }, "Video must cover each one-second sample, audio and scene detection without hiding gaps"),
]);
export const v2FileObservationSchema = z
  .strictObject({
    id: opaqueIdSchema,
    text: displayText(5000),
    position: v2SourcePositionSchema,
    certainty: z.enum(["observed", "uncertain"]),
    userEdited: z.boolean(),
    included: z.boolean(),
  })
  .refine(
    (observation) => !observation.userEdited || observation.certainty === "uncertain",
    "A user correction is not a verified material observation",
  );
export const v2DerivativeSchema = z.strictObject({
  id: opaqueIdSchema,
  kind: z.enum(["extracted_text", "transcript", "sampled_frame", "observation"]),
  byteLength: v2CountSchema,
  contentHash: v2HashSchema,
  sourcePosition: v2SourcePositionSchema.nullable(),
});
export const v2FileSchema = z
  .strictObject({
    schemaVersion: v2VersionSchema,
    id: opaqueIdSchema,
    revision: revisionSchema,
    name: boundedText(1, 255),
    declaredMediaType: boundedText(1, 200),
    byteLength: z.number().int().positive().max(V2_LIMITS.mediaBytes),
    status: z.enum([
      "reserved",
      "uploading",
      "uploaded",
      "queued",
      "processing",
      "ready",
      "failed",
      "deleting",
    ]),
    probe: v2FileProbeSchema.nullable(),
    manifest: v2OriginalManifestSchema.nullable(),
    coverage: v2CoverageSchema.nullable(),
    observations: z
      .array(v2FileObservationSchema)
      .max(10_000)
      .refine(hasUniqueIds, "Duplicate observations"),
    derivatives: z
      .array(v2DerivativeSchema)
      .max(20_000)
      .refine(hasUniqueIds, "Duplicate derivatives"),
    currentJobId: opaqueIdSchema.nullable(),
    operationId: opaqueIdSchema.nullable(),
    failure: v2FailureCodeSchema.nullable(),
    createdAt: timestampSchema,
  })
  .refine((file) => {
    if (
      (file.probe !== null && file.probe.byteLength !== file.byteLength) ||
      (file.manifest !== null && file.manifest.byteLength !== file.byteLength)
    )
      return false;
    if (
      file.coverage !== null &&
      (file.probe === null || !coverageMatchesProbe(file.coverage, file.probe))
    )
      return false;
    if (
      !file.observations.every((observation) =>
        positionMatchesProbe(observation.position, file.probe),
      )
    )
      return false;
    if (
      !file.derivatives.every(
        (derivative) =>
          derivative.sourcePosition === null ||
          positionMatchesProbe(derivative.sourcePosition, file.probe),
      )
    )
      return false;
    const pendingUpload = file.status === "reserved" || file.status === "uploading";
    if (pendingUpload)
      return (
        file.probe === null &&
        file.manifest === null &&
        file.coverage === null &&
        file.observations.length === 0 &&
        file.derivatives.length === 0 &&
        file.currentJobId === null &&
        file.operationId === null &&
        file.failure === null
      );
    if (file.status === "deleting") return file.currentJobId === null;
    if (file.status === "failed") return file.failure !== null && file.currentJobId === null;
    if (
      file.failure !== null ||
      file.probe === null ||
      file.manifest === null ||
      file.probe.byteLength !== file.byteLength ||
      file.manifest.byteLength !== file.byteLength
    )
      return false;
    if (
      file.status === "ready" &&
      (file.coverage === null || file.currentJobId !== null || file.operationId === null)
    )
      return false;
    if (file.status === "uploaded" && file.currentJobId !== null) return false;
    if (
      (file.status === "queued" || file.status === "processing") &&
      (file.currentJobId === null || file.operationId === null)
    )
      return false;
    if (file.coverage !== null && !coverageMatchesProbe(file.coverage, file.probe)) return false;
    return true;
  }, "Inconsistent file lifecycle, probe, coverage or source position");
function coverageMatchesProbe(coverage: V2Coverage, probe: V2FileProbe) {
  if (coverage.category !== probe.category) return false;
  if (coverage.category === "document" && probe.category === "document")
    return coverage.pageCount === probe.pageCount;
  if (coverage.category === "audio" && probe.category === "audio")
    return coverage.audio.durationSeconds === probe.durationSeconds;
  if (coverage.category === "video" && probe.category === "video")
    return (
      coverage.durationSeconds === probe.durationSeconds && coverage.hasAudio === probe.hasAudio
    );
  return true;
}
export function positionMatchesProbe(
  position: z.infer<typeof v2SourcePositionSchema>,
  probe: V2FileProbe | null,
) {
  if (probe === null) return false;
  if (position.kind === "document")
    return probe.category === "document" && position.page <= probe.pageCount;
  if (position.kind === "image") return probe.category === "image";
  if (position.kind === "audio")
    return (
      (probe.category === "audio" || (probe.category === "video" && probe.hasAudio)) &&
      position.endSeconds <= probe.durationSeconds
    );
  return probe.category === "video" && position.timestampSeconds < probe.durationSeconds;
}
export const v2ObservationEditRequestSchema = v2JsonRequestSchema(
  z.strictObject({
    expectedRevision: revisionSchema,
    edits: z
      .array(
        z.strictObject({
          observationId: opaqueIdSchema,
          text: displayText(5000),
          included: z.boolean(),
        }),
      )
      .min(1)
      .max(100)
      .refine(
        (edits) => new Set(edits.map((edit) => edit.observationId)).size === edits.length,
        "Duplicate observation edits",
      ),
  }),
);
export type V2FileProbe = z.infer<typeof v2FileProbeSchema>;
export type V2OriginalManifest = z.infer<typeof v2OriginalManifestSchema>;
export type V2UploadReservationRequest = z.infer<typeof v2UploadReservationRequestSchema>;
export type V2UploadSession = z.infer<typeof v2UploadSessionSchema>;
export type V2Coverage = z.infer<typeof v2CoverageSchema>;
export type V2FileObservation = z.infer<typeof v2FileObservationSchema>;
export type V2File = z.infer<typeof v2FileSchema>;
export type V2FileCategory = z.infer<typeof v2FileCategorySchema>;
export type V2UploadPart = z.infer<typeof v2UploadPartSchema>;
export type V2UploadCompleteRequest = z.infer<typeof v2UploadCompleteRequestSchema>;
export type V2CoverageInterval = z.infer<typeof v2CoverageIntervalSchema>;
export type V2AudioCoverage = z.infer<typeof v2AudioCoverageSchema>;
export type V2VideoFrame = z.infer<typeof v2VideoFrameSchema>;
export type V2Derivative = z.infer<typeof v2DerivativeSchema>;
export type V2ObservationEditRequest = z.infer<typeof v2ObservationEditRequestSchema>;
