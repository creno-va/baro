import { sha256 } from "@noble/hashes/sha2.js";
import { z } from "zod";
import { v2FileProbeSchema } from "../../../contracts/v2";
import { digest, hex } from "../files/binary";
import {
  decodeArtifact,
  ProcessingError,
  type ProcessorArtifact,
  type ProcessorManifest,
  processorLines,
  processorRecordSchema,
} from "./protocol";
import { type SanitizedManifest, sanitizedRecordSchema } from "./sanitized-protocol";

export type ProcessingAccess = { authorize: () => Promise<boolean>; signal: AbortSignal };
export type ProcessingCostPermit = { attemptId: string; dispatchToken: string | null };
export interface ProcessingCosts {
  /** Actual paid reservation/proof and final dispatch CAS, never a browser budget boolean. */
  before(
    input: {
      service: "container" | "asr" | "model" | "storage" | "requests";
      identity: string;
      byteLength: number;
      durationSeconds: number | null;
      action?: "container_probe" | "container_process" | "r2_get" | "r2_put" | "asr" | "vision";
      model?: string;
      wire?: Readonly<Record<string, unknown>>;
    },
    access: ProcessingAccess,
  ): Promise<ProcessingCostPermit | null>;
  after(
    permit: ProcessingCostPermit,
    receipt: { transport: "response" | "unknown" | "not_sent"; rawUsage?: unknown },
  ): Promise<void>;
}
export const authorize = async (access: ProcessingAccess) => {
  try {
    return !access.signal.aborted && (await access.authorize()) && !access.signal.aborted;
  } catch {
    return false;
  }
};
export function createProcessorTransport(options: {
  fetch: (request: Request) => Promise<Response>;
  stop: () => Promise<void>;
  costs: ProcessingCosts;
}) {
  const start = async (
    kind: "probe" | "process_unit" | "sanitize",
    input: {
      byteLength: number;
      contentHash: string;
      open: () => ReadableStream<Uint8Array>;
      unit?: number;
      frameOffset?: number;
    },
    access: ProcessingAccess,
  ) => {
    if (!(await authorize(access))) throw new ProcessingError("STALE_REVISION");
    const permit = await options.costs.before(
      {
        service: "container",
        action: kind === "probe" ? "container_probe" : "container_process",
        identity: `${kind}:${input.contentHash}:${input.unit ?? 0}:${input.frameOffset ?? 0}`,
        byteLength: input.byteLength,
        durationSeconds: null,
      },
      access,
    );
    if (!permit) throw new ProcessingError("BUDGET_UNAVAILABLE");
    if (!(await authorize(access))) {
      await options.costs.after(permit, { transport: "not_sent" });
      throw new ProcessingError("STALE_REVISION");
    }
    let sent = false;
    try {
      const path = kind === "probe" ? "/probe" : kind === "sanitize" ? "/sanitize" : "/process";
      const request = new Request(`http://processor.internal${path}`, {
        method: "POST",
        headers: {
          "x-baro-capability": hex(crypto.getRandomValues(new Uint8Array(32))),
          "x-baro-bytes": String(input.byteLength),
          "x-baro-hash": input.contentHash,
          "x-baro-unit": String(input.unit ?? 0),
          "x-baro-frame-offset": String(input.frameOffset ?? 0),
        },
        body: input.open(),
        signal: access.signal,
      });
      // No async gap between the final authorization and transport dispatch.
      if (access.signal.aborted) throw new ProcessingError("JOB_TIMEOUT");
      sent = true;
      const response = await options.fetch(request);
      await options.costs.after(permit, { transport: "response" }); // Native CPU time is not a provider billing receipt; retain unknown exposure.
      if (!(await authorize(access))) {
        await response.body?.cancel();
        throw new ProcessingError("STALE_REVISION");
      }
      if (response.status !== 200 || !response.body || response.redirected) {
        await response.body?.cancel();
        throw new ProcessingError(
          response.status === 422 ? "FILE_REJECTED" : "FILE_PROCESSING_FAILED",
        );
      }
      return response;
    } catch (error) {
      if (!(error instanceof ProcessingError))
        await options.costs.after(permit, { transport: sent ? "unknown" : "not_sent" });
      if (error instanceof ProcessingError) throw error;
      throw new ProcessingError("FILE_PROCESSING_FAILED");
    }
  };
  return {
    async *sanitize(
      input: { byteLength: number; contentHash: string; open: () => ReadableStream<Uint8Array> },
      access: ProcessingAccess,
    ): AsyncGenerator<
      | { type: "manifest"; manifest: SanitizedManifest }
      | { type: "chunk"; pass: 0 | 1; index: number; bytes: Uint8Array<ArrayBuffer> }
    > {
      let manifest: SanitizedManifest | null = null;
      let index = 0,
        pass = 0,
        complete = false;
      let hasher = sha256.create();
      const firstHashes: string[] = [];
      try {
        if (
          !Number.isSafeInteger(input.byteLength) ||
          input.byteLength < 1 ||
          input.byteLength > 100_000_000 ||
          !/^[a-f0-9]{64}$/.test(input.contentHash)
        )
          throw new ProcessingError("FILE_REJECTED");
        const response = await start("sanitize", input, access);
        if (!response.body) throw new ProcessingError("FILE_REJECTED");
        for await (const raw of processorLines(response.body, access.signal)) {
          if (!(await authorize(access))) throw new ProcessingError("STALE_REVISION");
          if (complete) throw new ProcessingError("FILE_REJECTED");
          const record = sanitizedRecordSchema.parse(raw);
          if (record.type === "sanitized_manifest") {
            if (manifest || pass || index || record.value.probe.byteLength !== input.byteLength)
              throw new ProcessingError("FILE_REJECTED");
            manifest = record.value;
            yield { type: "manifest", manifest };
          } else if (record.type === "sanitized_chunk") {
            if (!manifest || pass > 1 || record.pass !== pass || record.index !== index)
              throw new ProcessingError("FILE_REJECTED");
            const size = Math.min(1_048_576, manifest.byteLength - index * 1_048_576);
            const bytes = decodeArtifact(record.data, size);
            try {
              const hash = await digest(bytes);
              if (pass === 0) firstHashes.push(hash);
              // Reject changed plaintext BEFORE handing it to saved-IV encryption.
              else if (firstHashes[index] !== hash) throw new ProcessingError("FILE_REJECTED");
              hasher.update(bytes);
              if (
                index === manifest.chunkCount - 1 &&
                hex(hasher.digest()) !== manifest.contentHash
              )
                throw new ProcessingError("FILE_REJECTED");
              yield { type: "chunk", pass: pass as 0 | 1, index, bytes };
            } finally {
              bytes.fill(0);
            }
            index++;
            if (index === manifest.chunkCount) {
              index = 0;
              pass++;
              hasher = sha256.create();
            }
          } else {
            if (!manifest || pass !== 2 || index !== 0) throw new ProcessingError("FILE_REJECTED");
            complete = true;
          }
        }
        if (!complete || !(await authorize(access))) throw new ProcessingError("FILE_REJECTED");
      } catch (error) {
        if (error instanceof ProcessingError) throw error;
        throw new ProcessingError("FILE_REJECTED");
      } finally {
        hasher.destroy();
        await options.stop();
      }
    },
    async probe(
      input: { byteLength: number; contentHash: string; open: () => ReadableStream<Uint8Array> },
      access: ProcessingAccess,
    ) {
      try {
        const response = await start("probe", input, access);
        if (!response.body) throw new ProcessingError("FILE_REJECTED");
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let count = 0;
        try {
          for (;;) {
            const item = await reader.read();
            if (item.done) break;
            count += item.value.byteLength;
            if (count > 65536 || !(await authorize(access)))
              throw new ProcessingError("FILE_REJECTED");
            chunks.push(item.value);
          }
        } finally {
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
        const bytes = new Uint8Array(count);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        const output = z
          .strictObject({ version: z.literal(1), probe: v2FileProbeSchema })
          .parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
        if (output.probe.byteLength !== input.byteLength || !(await authorize(access)))
          throw new ProcessingError("FILE_REJECTED");
        return output.probe;
      } finally {
        await options.stop();
      }
    },
    async processUnit(
      input: {
        byteLength: number;
        contentHash: string;
        open: () => ReadableStream<Uint8Array>;
        unit?: number;
        frameOffset?: number;
      },
      access: ProcessingAccess,
      sinks: {
        manifest: (manifest: ProcessorManifest) => Promise<void>;
        artifact: (artifact: ProcessorArtifact, bytes: Uint8Array<ArrayBuffer>) => Promise<void>;
      },
    ) {
      let manifest: ProcessorManifest | null = null,
        index = 0,
        complete = false;
      try {
        const response = await start("process_unit", input, access);
        if (!response.body) throw new ProcessingError("FILE_REJECTED");
        for await (const raw of processorLines(response.body, access.signal)) {
          if (!(await authorize(access)) || complete) throw new ProcessingError("STALE_REVISION");
          const record = processorRecordSchema.parse(raw);
          if (record.type === "manifest") {
            if (manifest || index) throw new ProcessingError("FILE_REJECTED");
            manifest = record.value;
            if (
              manifest.probe.byteLength !== input.byteLength ||
              manifest.unit !== (input.unit ?? 0) ||
              manifest.frameOffset !== (input.frameOffset ?? 0)
            )
              throw new ProcessingError("FILE_REJECTED");
            await sinks.manifest(manifest);
          } else if (record.type === "artifact") {
            const artifact = manifest?.artifacts[index];
            if (!artifact || record.index !== index) throw new ProcessingError("FILE_REJECTED");
            const bytes = decodeArtifact(record.data, artifact.byteLength);
            try {
              if ((await digest(bytes)) !== artifact.contentHash || !(await authorize(access)))
                throw new ProcessingError("FILE_REJECTED");
              await sinks.artifact(artifact, bytes);
            } finally {
              bytes.fill(0);
            }
            index++;
          } else {
            if (!manifest || index !== manifest.artifacts.length)
              throw new ProcessingError("FILE_REJECTED");
            complete = true;
          }
        }
        if (!complete || !manifest || !(await authorize(access)))
          throw new ProcessingError("FILE_REJECTED");
        return manifest;
      } catch (error) {
        if (error instanceof ProcessingError) throw error;
        throw new ProcessingError("FILE_REJECTED");
      } finally {
        await options.stop();
      }
    },
  };
}
export type ProcessorTransport = ReturnType<typeof createProcessorTransport>;
