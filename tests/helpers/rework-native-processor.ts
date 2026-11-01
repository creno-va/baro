/** Synthetic external Container capability only. Real admission, capacity accounting,
 * ownership/consent/lease guards, encryption, jobs and the model gateway stay intact.
 * TXT/image bytes are decoded here. PDFs are exact, pre-registered authored fixtures,
 * not evidence that a real PDF/OCR processor or deployed Container succeeded. */
import sharp from "sharp";
import type { V2FileProbe } from "../../src/contracts/v2";
import {
  MAX_ARTIFACT_BYTES,
  type ProcessorArtifact,
  processorManifestSchema,
} from "../../src/server/modules/file-processing/protocol";
import { digest } from "../../src/server/modules/files/binary";

export type ReworkPdfFixture = { bytes: Uint8Array; pages: readonly string[] };
export type ReworkNativeProcessorOptions = {
  pdfFixtures?: readonly ReworkPdfFixture[];
  /** Must be the actual native renderer supplied by the report integration harness. */
  renderPdf?: (html: string) => Promise<Uint8Array<ArrayBuffer>>;
};
const encoder = new TextEncoder();
const error = (status: number, code: string) =>
  Response.json({ code }, { status, headers: { "cache-control": "no-store" } });
const hasMagic = (bytes: Uint8Array, prefix: readonly number[]) =>
  prefix.every((byte, index) => bytes[index] === byte);
function textParts(text: string) {
  const bytes = encoder.encode(text),
    parts: Uint8Array<ArrayBuffer>[] = [];
  for (let start = 0; start < bytes.length; ) {
    let end = Math.min(bytes.length, start + MAX_ARTIFACT_BYTES);
    while (end < bytes.length && ((bytes[end] ?? 0) & 0xc0) === 0x80) end--;
    parts.push(bytes.slice(start, end));
    start = end;
  }
  return parts;
}
async function delay(ms: number, signal: AbortSignal) {
  if (!Number.isFinite(ms) || ms < 0 || ms > 5000) throw new Error("SYNTHETIC_NATIVE_DELAY");
  signal.throwIfAborted();
  if (!ms) return;
  await new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(new Error("SYNTHETIC_NATIVE_ABORT"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

export function createReworkNativeProcessor(options: ReworkNativeProcessorOptions = {}) {
  const controls = {
    failNative: false,
    failProbe: false,
    failProcess: false,
    failReport: false,
    delayMs: 0,
  };
  const counters = {
    prepare: 0,
    probe: 0,
    process: 0,
    report: 0,
    stop: 0,
    rejected: 0,
    failed: 0,
    inputBytes: 0,
    artifactBytes: 0,
  };
  const pdfFixtures = (options.pdfFixtures ?? []).map(({ bytes: input, pages }) => {
    const bytes = input.slice();
    if (!hasMagic(bytes, [37, 80, 68, 70, 45]) || !pages.length || pages.length > 500)
      throw new Error("SYNTHETIC_PDF_FIXTURE_INVALID");
    return { bytes, pages: [...pages] };
  });

  async function inspect(
    bytes: Uint8Array<ArrayBuffer>,
  ): Promise<{ probe: V2FileProbe; pages?: readonly string[]; image?: Uint8Array<ArrayBuffer> }> {
    if (hasMagic(bytes, [37, 80, 68, 70, 45])) {
      const registeredPdfs = new Map(
        await Promise.all(
          pdfFixtures.map(async (fixture) => [await digest(fixture.bytes), fixture.pages] as const),
        ),
      );
      const pages = registeredPdfs.get(await digest(bytes));
      if (!pages) throw new Error("SYNTHETIC_PDF_UNREGISTERED");
      return {
        probe: {
          category: "document",
          format: "pdf",
          byteLength: bytes.length,
          pageCount: pages.length,
        },
        pages,
      };
    }
    if (hasMagic(bytes, [255, 216, 255]) || hasMagic(bytes, [137, 80, 78, 71, 13, 10, 26, 10])) {
      const metadata = await sharp(bytes, {
        limitInputPixels: 40_000_000,
        failOn: "error",
      }).metadata();
      if (
        !metadata.width ||
        !metadata.height ||
        (metadata.pages ?? 1) !== 1 ||
        !["jpeg", "png"].includes(metadata.format ?? "")
      )
        throw new Error("SYNTHETIC_IMAGE_INVALID");
      const image = new Uint8Array(
        await sharp(bytes, { limitInputPixels: 40_000_000, failOn: "error" })
          .rotate()
          .flatten({ background: "#fff" })
          .resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 75 })
          .toBuffer(),
      );
      if (!image.length || image.length > MAX_ARTIFACT_BYTES)
        throw new Error("SYNTHETIC_IMAGE_LIMIT");
      return {
        probe: {
          category: "image",
          format: metadata.format === "png" ? "png" : "jpeg",
          byteLength: bytes.length,
          width: metadata.width,
          height: metadata.height,
        },
        image,
      };
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (!text.trim()) throw new Error("SYNTHETIC_TEXT_INVALID");
    for (const character of text) {
      const code = character.codePointAt(0) ?? 0;
      if ((code < 32 && ![9, 10, 12, 13].includes(code)) || code === 127)
        throw new Error("SYNTHETIC_TEXT_INVALID");
    }
    const pages = text.split("\f");
    if (pages.length > 100_000) throw new Error("SYNTHETIC_TEXT_LIMIT");
    return {
      probe: {
        category: "document",
        format: "txt",
        byteLength: bytes.length,
        pageCount: pages.length,
      },
      pages,
    };
  }

  const createStub = () => {
    const active = new Set<AbortController>();
    return {
      /** Explicit synthetic external capability; never a production capacity receipt. */
      async prepareCapacity() {
        counters.prepare++;
        return true;
      },
      async stopProcessing() {
        counters.stop++;
        for (const controller of active) controller.abort();
      },
      async fetch(request: Request) {
        const path = new URL(request.url).pathname;
        const processing = path === "/process" || path === "/process_unit";
        if (
          request.method !== "POST" ||
          !["/probe", "/process", "/process_unit", "/report"].includes(path)
        )
          return error(404, "UNSUPPORTED_SYNTHETIC_ROUTE");
        if (path === "/probe") counters.probe++;
        else if (processing) counters.process++;
        else counters.report++;
        const declaredBytes = Number(request.headers.get("x-baro-bytes"));
        const hash = request.headers.get("x-baro-hash") ?? "";
        const unit = Number(request.headers.get("x-baro-unit") ?? "0");
        const frameOffset = Number(request.headers.get("x-baro-frame-offset") ?? "0");
        if (
          !/^[a-f0-9]{64}$/.test(request.headers.get("x-baro-capability") ?? "") ||
          !Number.isSafeInteger(declaredBytes) ||
          declaredBytes < 1 ||
          declaredBytes > (path === "/report" ? 20_000_000 : 100_000_000) ||
          !/^[a-f0-9]{64}$/.test(hash) ||
          !Number.isInteger(unit) ||
          unit < 0 ||
          unit >= 100_000 ||
          frameOffset !== 0
        ) {
          counters.rejected++;
          return error(400, "INVALID_REQUEST");
        }
        const chunks: Uint8Array<ArrayBuffer>[] = [];
        const controller = new AbortController();
        const signal = AbortSignal.any([request.signal, controller.signal]);
        active.add(controller);
        let received = 0,
          bytes: Uint8Array<ArrayBuffer> | undefined;
        const reader = request.body?.getReader();
        const cancelRead = () => {
          void reader?.cancel().catch(() => {});
        };
        signal.addEventListener("abort", cancelRead, { once: true });
        try {
          if (!reader) throw new Error("SYNTHETIC_INPUT_MISSING");
          for (;;) {
            signal.throwIfAborted();
            const chunk = await reader.read();
            if (chunk.done) break;
            received += chunk.value.length;
            if (received > declaredBytes) throw new Error("SYNTHETIC_INPUT_LENGTH");
            chunks.push(chunk.value.slice());
          }
          bytes = new Uint8Array(received);
          signal.throwIfAborted();
          let offset = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.length;
            chunk.fill(0);
          }
          if (received !== declaredBytes || (await digest(bytes)) !== hash)
            throw new Error("SYNTHETIC_INPUT_HASH");
          counters.inputBytes += received;
        } catch {
          for (const chunk of chunks) chunk.fill(0);
          bytes?.fill(0);
          counters.rejected++;
          active.delete(controller);
          return error(422, "INVALID_MEDIA");
        } finally {
          signal.removeEventListener("abort", cancelRead);
          await reader?.cancel().catch(() => {});
          reader?.releaseLock();
        }
        const outputBuffers: Uint8Array<ArrayBuffer>[] = [];
        try {
          await delay(controls.delayMs, signal);
          if (
            controls.failNative ||
            (path === "/probe" && controls.failProbe) ||
            (processing && controls.failProcess) ||
            (path === "/report" && controls.failReport)
          ) {
            counters.failed++;
            return error(503, "SYNTHETIC_NATIVE_UNAVAILABLE");
          }
          if (path === "/report") {
            if (!options.renderPdf) {
              counters.failed++;
              return error(503, "SYNTHETIC_RENDERER_UNAVAILABLE");
            }
            const pdf = await options.renderPdf(
              new TextDecoder("utf-8", { fatal: true }).decode(bytes),
            );
            signal.throwIfAborted();
            if (pdf.length < 8 || pdf.length > 24_000_000 || !hasMagic(pdf, [37, 80, 68, 70, 45]))
              throw new Error("SYNTHETIC_RENDERER_OUTPUT");
            return new Response(pdf.slice(), {
              headers: { "content-type": "application/pdf", "cache-control": "no-store" },
            });
          }
          let inspected: Awaited<ReturnType<typeof inspect>>;
          try {
            inspected = await inspect(bytes);
          } catch {
            counters.rejected++;
            return error(422, "INVALID_MEDIA");
          }
          const { probe, pages } = inspected;
          if (inspected.image) outputBuffers.push(inspected.image);
          if (path === "/probe") {
            inspected.image?.fill(0);
            return Response.json(
              { version: 1, probe },
              { headers: { "cache-control": "no-store" } },
            );
          }
          const totalUnits = probe.category === "document" ? probe.pageCount : 1;
          if (unit >= totalUnits) {
            counters.rejected++;
            return error(422, "INVALID_MEDIA");
          }
          const position: ProcessorArtifact["position"] =
            probe.category === "document"
              ? { kind: "document", page: unit + 1, paragraph: null, table: null }
              : { kind: "image", region: null };
          const output =
            probe.category === "document"
              ? textParts(pages?.[unit] ?? "")
              : inspected.image
                ? [inspected.image]
                : [];
          if (probe.category === "document") outputBuffers.push(...output);
          const artifacts = await Promise.all(
            output.map(async (value, index) => ({
              index,
              kind:
                probe.category === "document" ? ("extracted_text" as const) : ("image" as const),
              position,
              byteLength: value.length,
              contentHash: await digest(value),
            })),
          );
          const status = output.length ? ("complete" as const) : ("partial" as const);
          const manifest = processorManifestSchema.parse({
            version: 1,
            probe,
            unit,
            totalUnits,
            frameOffset: 0,
            decodedFrameCount: 0,
            coverage:
              probe.category === "document"
                ? {
                    category: "document",
                    status,
                    pageCount: probe.pageCount,
                    pages: [{ page: unit + 1, status: output.length ? "processed" : "missing" }],
                  }
                : { category: "image", status: "complete", observation: "processed" },
            artifacts,
            outputBytes: output.reduce((sum, value) => sum + value.length, 0),
          });
          counters.artifactBytes += manifest.outputBytes;
          const records = [
            { type: "manifest", value: manifest },
            ...output.map((value, index) => ({
              type: "artifact",
              index,
              data: Buffer.from(value).toString("base64"),
            })),
            { type: "complete" },
          ];
          const response = new Response(
            `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
            { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" } },
          );
          return response;
        } catch {
          counters.failed++;
          return error(503, "SYNTHETIC_NATIVE_UNAVAILABLE");
        } finally {
          active.delete(controller);
          for (const output of outputBuffers) output.fill(0);
          bytes.fill(0);
        }
      },
    };
  };
  const stubs = new Map<unknown, ReturnType<typeof createStub>>();
  return {
    binding: {
      idFromName: (name: string) => name,
      get: (id: unknown) => {
        let stub = stubs.get(id);
        if (!stub) {
          stub = createStub();
          stubs.set(id, stub);
        }
        return stub;
      },
    },
    controls,
    counters,
  };
}
