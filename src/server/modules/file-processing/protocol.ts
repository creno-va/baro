import { z } from "zod";
import {
  positionMatchesProbe,
  v2CoverageSchema,
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
export const processorManifestSchema = z
  .strictObject({
    version: z.literal(1),
    probe: v2FileProbeSchema,
    coverage: v2CoverageSchema,
    unit: z.number().int().min(0).max(99999),
    totalUnits: z.number().int().positive().max(100000),
    artifacts: z.array(artifactSchema).max(20000),
    outputBytes: z.number().int().min(0).max(536_870_912),
  })
  .refine(
    (m) =>
      m.unit < m.totalUnits &&
      m.probe.category === m.coverage.category &&
      m.artifacts.every((a, i) => a.index === i && positionMatchesProbe(a.position, m.probe)) &&
      m.artifacts.reduce((n, a) => n + a.byteLength, 0) === m.outputBytes,
    "Dishonest artifact inventory",
  );
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
