import { z } from "zod";
import {
  positionMatchesProbe,
  v2VideoFrameSchema,
  v2FileProbeSchema,
  v2HashSchema,
  v2SourcePositionSchema,
} from "../../../contracts/v2";

export const MAX_ARTIFACT_BYTES = 1_048_576;
export const MAX_LINE_BYTES = 1_500_000;
export const artifactSchema = z
  .strictObject({
    index: z.number().int().min(0).max(19999),
    kind: z.enum(["extracted_text", "image", "audio", "frame"]),
    position: v2SourcePositionSchema,
    byteLength: z.number().int().positive().max(MAX_ARTIFACT_BYTES),
    contentHash: v2HashSchema,
    multiFrame: z.boolean().optional(),
  })
  .refine(
    (a) =>
      a.kind === "extracted_text"
        ? a.position.kind === "document"
        : a.kind === "image"
          ? a.position.kind === "image"
          : a.kind === "audio"
            ? a.position.kind === "audio"
            : a.position.kind === "video",
    "Artifact kind/position mismatch",
  );
const statusSchema = z.enum(["processed", "low_quality", "missing", "failed"]);
const intervalSchema = z
  .strictObject({
    startSeconds: z.number().min(0).max(3600),
    endSeconds: z.number().positive().max(3600),
    status: z.enum(["processed", "low_quality", "silent", "missing", "failed"]),
  })
  .refine((i) => i.endSeconds > i.startSeconds);
const unitAudioSchema = z.strictObject({
  durationSeconds: z.number().positive().max(3600),
  status: z.enum(["complete", "partial"]),
  intervals: z.array(intervalSchema).length(1),
});
/** Internal unit fragments deliberately do not masquerade as a whole-file coverage DTO. */
const unitCoverageSchema = z.discriminatedUnion("category", [
  z.strictObject({
    category: z.literal("document"),
    status: z.enum(["complete", "partial"]),
    pageCount: z.number().int().positive().max(100000),
    pages: z
      .array(
        z.strictObject({ page: z.number().int().positive().max(100000), status: statusSchema }),
      )
      .length(1),
  }),
  z.strictObject({
    category: z.literal("image"),
    status: z.enum(["complete", "partial"]),
    observation: statusSchema,
  }),
  z.strictObject({ category: z.literal("audio"), audio: unitAudioSchema }),
  z.strictObject({
    category: z.literal("video"),
    durationSeconds: z.number().positive().max(3600),
    status: z.enum(["complete", "partial"]),
    hasAudio: z.boolean(),
    audio: unitAudioSchema.nullable(),
    frames: z.array(v2VideoFrameSchema).max(20000),
    sceneDetection: z.literal("complete"),
    sceneFrameCount: z.number().int().min(0).max(20000),
  }),
]);
export const processorManifestSchema = z
  .strictObject({
    version: z.literal(1),
    probe: v2FileProbeSchema,
    coverage: unitCoverageSchema,
    unit: z.number().int().min(0).max(99999),
    totalUnits: z.number().int().positive().max(100000),
    frameOffset: z.number().int().min(0).max(10000000),
    decodedFrameCount: z.number().int().min(0).max(10000000),
    artifacts: z.array(artifactSchema).max(20000),
    outputBytes: z.number().int().min(0).max(536_870_912),
  })
  .refine((m) => {
    const probe = m.probe,
      coverage = m.coverage;
    return (
      m.unit < m.totalUnits &&
      m.totalUnits ===
        (probe.category === "document"
          ? probe.pageCount
          : probe.category === "image"
            ? 1
            : Math.ceil(probe.durationSeconds / 30)) &&
      (probe.category === "video"
        ? m.decodedFrameCount > 0 && m.frameOffset + m.decodedFrameCount <= 10000000
        : m.frameOffset === 0 && m.decodedFrameCount === 0) &&
      probe.category === coverage.category &&
      (coverage.category !== "document" ||
        (probe.category === "document" &&
          coverage.pageCount === probe.pageCount &&
          coverage.pages[0]?.page === m.unit + 1 &&
          (coverage.status === "complete") === (coverage.pages[0].status === "processed"))) &&
      (coverage.category !== "image" ||
        (coverage.status === "complete") === (coverage.observation === "processed")) &&
      ((coverage.category !== "audio" && coverage.category !== "video") ||
        ((probe.category === "audio" || probe.category === "video") &&
          (!coverage.audio ||
            (coverage.audio.durationSeconds === probe.durationSeconds &&
              coverage.audio.intervals[0]?.startSeconds === m.unit * 30 &&
              coverage.audio.intervals[0]?.endSeconds ===
                Math.min((m.unit + 1) * 30, probe.durationSeconds))))) &&
      (coverage.category !== "video" ||
        (probe.category === "video" &&
          coverage.durationSeconds === probe.durationSeconds &&
          coverage.hasAudio === probe.hasAudio &&
          (coverage.audio !== null) === probe.hasAudio &&
          coverage.sceneFrameCount ===
            coverage.frames.filter((f) => f.sampling === "scene_change").length &&
          coverage.frames.filter((f) => f.sampling === "one_second").length ===
            Math.min(30, Math.ceil(probe.durationSeconds) - m.unit * 30) &&
          coverage.frames.every(
            (f) =>
              f.timestampSeconds >= m.unit * 30 &&
              f.timestampSeconds < Math.min((m.unit + 1) * 30, probe.durationSeconds) &&
              f.frameIndex >= m.frameOffset &&
              f.frameIndex < m.frameOffset + m.decodedFrameCount,
          ))) &&
      m.artifacts.every((a, i) => {
        if (a.index !== i || !positionMatchesProbe(a.position, probe)) return false;
        const p = a.position;
        if (p.kind === "document") return p.page === m.unit + 1;
        if (p.kind === "audio")
          return (
            p.startSeconds === m.unit * 30 &&
            (probe.category === "audio" || probe.category === "video") &&
            p.endSeconds === Math.min((m.unit + 1) * 30, probe.durationSeconds)
          );
        if (p.kind === "video")
          return (
            p.timestampSeconds >= m.unit * 30 &&
            p.timestampSeconds < (m.unit + 1) * 30 &&
            p.frameIndex >= m.frameOffset &&
            p.frameIndex < m.frameOffset + m.decodedFrameCount
          );
        return probe.category === "image" && m.unit === 0;
      }) &&
      m.artifacts.reduce((n, a) => n + a.byteLength, 0) === m.outputBytes
    );
  }, "Dishonest artifact inventory");
export type ProcessorManifest = z.infer<typeof processorManifestSchema>;
export type ProcessorArtifact = z.infer<typeof artifactSchema>;
export class ProcessingError extends Error {
  constructor(
    readonly code:
      | "FILE_REJECTED"
      | "FILE_PROCESSING_FAILED"
      | "BUDGET_UNAVAILABLE"
      | "JOB_TIMEOUT"
      | "STALE_REVISION"
      | "MODEL_UNAVAILABLE"
      | "MODEL_SCHEMA_INVALID"
      | "STORAGE_UNAVAILABLE",
  ) {
    super(code);
  }
}

/** Incremental UTF-8/line framing, one artifact buffer at a time. Full responses are never buffered. */
export async function* processorLines(body: ReadableStream<Uint8Array>, signal: AbortSignal) {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let line = "",
    bytes = 0,
    total = 0;
  try {
    for (;;) {
      if (signal.aborted) throw new ProcessingError("JOB_TIMEOUT");
      const item = await reader.read();
      if (item.done) break;
      total += item.value.byteLength;
      if (total > 750_000_000) throw new ProcessingError("FILE_REJECTED");
      // A transport can coalesce many lines. Split bytes before decoding or joining.
      let start = 0;
      for (let index = 0; index < item.value.byteLength; index++) {
        if (item.value[index] !== 10) continue;
        const piece = item.value.subarray(start, index);
        bytes += piece.byteLength;
        if (bytes > MAX_LINE_BYTES) throw new ProcessingError("FILE_REJECTED");
        line += decoder.decode(piece, { stream: true });
        line += decoder.decode();
        if (!line) throw new ProcessingError("FILE_REJECTED");
        yield JSON.parse(line) as unknown;
        line = "";
        bytes = 0;
        start = index + 1;
      }
      const remaining = item.value.subarray(start);
      bytes += remaining.byteLength;
      if (bytes > MAX_LINE_BYTES) throw new ProcessingError("FILE_REJECTED");
      line += decoder.decode(remaining, { stream: true });
    }
    if (line || bytes || decoder.decode()) throw new ProcessingError("FILE_REJECTED");
  } catch (error) {
    if (error instanceof ProcessingError) throw error;
    throw new ProcessingError("FILE_REJECTED");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export const processorRecordSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("manifest"), value: processorManifestSchema }),
  z.strictObject({
    type: z.literal("artifact"),
    index: z.number().int().min(0).max(19999),
    data: z
      .string()
      .max(1_398_104)
      .regex(/^[A-Za-z0-9+/]*={0,2}$/),
  }),
  z.strictObject({ type: z.literal("complete") }),
]);
export function decodeArtifact(data: string, length: number) {
  const raw = atob(data);
  if (raw.length !== length || btoa(raw) !== data) throw new ProcessingError("FILE_REJECTED");
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
