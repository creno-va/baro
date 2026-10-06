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

export type ProcessingAccess = { authorize: () => Promise<boolean>; signal: AbortSignal };
export type ProcessingCostPermit = { attemptId: string; dispatchToken: string | null };
export interface ProcessingCosts {
  /** Actual paid reservation/proof and final dispatch CAS, never a browser budget boolean. */
  before(
    input: {
      service: "container" | "asr" | "model" | "storage";
      identity: string;
      byteLength: number;
      durationSeconds: number | null;
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
    kind: "probe" | "process",
    input: {
      byteLength: number;
      contentHash: string;
      open: () => ReadableStream<Uint8Array>;
      unit?: number;
    },
    access: ProcessingAccess,
  ) => {
    if (!(await authorize(access))) throw new ProcessingError("STALE_REVISION");
    const permit = await options.costs.before(
      {
        service: "container",
        identity: `${kind}:${input.contentHash}:${input.unit ?? 0}`,
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
      const request = new Request(`http://processor.internal/${kind}`, {
        method: "POST",
        headers: {
          "x-baro-capability": hex(crypto.getRandomValues(new Uint8Array(32))),
          "x-baro-bytes": String(input.byteLength),
          "x-baro-hash": input.contentHash,
          "x-baro-unit": String(input.unit ?? 0),
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
    async probe(
      input: { byteLength: number; contentHash: string; open: () => ReadableStream<Uint8Array> },
      access: ProcessingAccess,
    ) {
      try {
        const response = await start("probe", input, access);
        const reader = response.body!.getReader();
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
    async process(
      input: {
        byteLength: number;
        contentHash: string;
        open: () => ReadableStream<Uint8Array>;
        unit?: number;
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
        const response = await start("process", input, access);
        for await (const raw of processorLines(response.body!, access.signal)) {
          if (!(await authorize(access)) || complete) throw new ProcessingError("STALE_REVISION");
          const record = processorRecordSchema.parse(raw);
          if (record.type === "manifest") {
            if (manifest || index) throw new ProcessingError("FILE_REJECTED");
            manifest = record.value;
            if (manifest.probe.byteLength !== input.byteLength)
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
