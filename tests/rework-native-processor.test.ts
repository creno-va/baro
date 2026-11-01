import { expect, test } from "bun:test";
import sharp from "sharp";
import { v2FileProbeSchema } from "../src/contracts/v2";
import {
  decodeArtifact,
  MAX_ARTIFACT_BYTES,
  processorLines,
  processorRecordSchema,
} from "../src/server/modules/file-processing/protocol";
import { digest } from "../src/server/modules/files/binary";
import { createReworkNativeProcessor } from "./helpers/rework-native-processor";

const textBytes = (text: string) => new TextEncoder().encode(text);
async function request(
  path: string,
  bytes: Uint8Array<ArrayBuffer>,
  options: { unit?: number; headers?: Record<string, string>; signal?: AbortSignal } = {},
) {
  return new Request(`http://synthetic-processor.internal${path}`, {
    method: "POST",
    body: bytes.slice(),
    headers: {
      "x-baro-capability": "a".repeat(64),
      "x-baro-bytes": String(bytes.length),
      "x-baro-hash": await digest(bytes),
      "x-baro-unit": String(options.unit ?? 0),
      "x-baro-frame-offset": "0",
      ...options.headers,
    },
    ...(options.signal ? { signal: options.signal } : {}),
  });
}
async function result(response: Response) {
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/x-ndjson");
  if (!response.body) throw new Error("SYNTHETIC_BODY_MISSING");
  const rows = [];
  for await (const row of processorLines(response.body, new AbortController().signal))
    rows.push(processorRecordSchema.parse(row));
  const first = rows.shift(),
    last = rows.pop();
  if (first?.type !== "manifest") throw new Error("SYNTHETIC_MANIFEST_MISSING");
  expect(last).toEqual({ type: "complete" });
  const artifacts = [];
  for (const row of rows) {
    if (row.type !== "artifact") throw new Error("SYNTHETIC_ARTIFACT_EXPECTED");
    const metadata = first.value.artifacts[row.index];
    if (!metadata) throw new Error("SYNTHETIC_ARTIFACT_METADATA_MISSING");
    const bytes = decodeArtifact(row.data, metadata.byteLength);
    expect(await digest(bytes)).toBe(metadata.contentHash);
    artifacts.push({ metadata, bytes });
  }
  expect(artifacts.length).toBe(first.value.artifacts.length);
  expect(artifacts.reduce((sum, artifact) => sum + artifact.bytes.length, 0)).toBe(
    first.value.outputBytes,
  );
  return { manifest: first.value, artifacts };
}

test("native external binding decodes actual TXT bytes and preserves page coordinates, whitespace and hashes", async () => {
  const fixture = createReworkNativeProcessor(),
    stub = fixture.binding.get(fixture.binding.idFromName("synthetic-file"));
  const bytes = textBytes(" 첫 합성 쪽 \n\f둘째 합성 쪽  ");
  expect(await stub.prepareCapacity()).toBe(true);
  const probe = await stub.fetch(await request("/probe", bytes));
  expect(probe.status).toBe(200);
  const value = (await probe.json()) as { version: number; probe: unknown };
  expect(value.version).toBe(1);
  expect(v2FileProbeSchema.parse(value.probe)).toEqual({
    category: "document",
    format: "txt",
    byteLength: bytes.length,
    pageCount: 2,
  });
  const first = await result(await stub.fetch(await request("/process", bytes)));
  const second = await result(await stub.fetch(await request("/process_unit", bytes, { unit: 1 })));
  expect(new TextDecoder().decode(first.artifacts[0]?.bytes)).toBe(" 첫 합성 쪽 \n");
  expect(new TextDecoder().decode(second.artifacts[0]?.bytes)).toBe("둘째 합성 쪽  ");
  expect(second.artifacts[0]?.metadata.position).toEqual({
    kind: "document",
    page: 2,
    paragraph: null,
    table: null,
  });
  expect(second.manifest.coverage).toEqual({
    category: "document",
    status: "complete",
    pageCount: 2,
    pages: [{ page: 2, status: "processed" }],
  });
  await stub.stopProcessing();
  expect(fixture.counters).toMatchObject({
    prepare: 1,
    probe: 1,
    process: 2,
    stop: 1,
    rejected: 0,
    failed: 0,
    inputBytes: bytes.length * 3,
  });
});

test("UTF-8 artifact boundaries retain multibyte characters while empty pages remain explicitly missing", async () => {
  const fixture = createReworkNativeProcessor(),
    stub = fixture.binding.get("synthetic-file");
  const text = "합성🌿".repeat(110_000);
  const output = await result(await stub.fetch(await request("/process", textBytes(text))));
  expect(output.artifacts.length).toBeGreaterThan(1);
  expect(output.artifacts.every((artifact) => artifact.bytes.length <= MAX_ARTIFACT_BYTES)).toBe(
    true,
  );
  expect(
    output.artifacts
      .map((artifact) => new TextDecoder("utf-8", { fatal: true }).decode(artifact.bytes))
      .join(""),
  ).toBe(text);
  const blank = await result(
    await stub.fetch(await request("/process", textBytes("합성 앞쪽\f"), { unit: 1 })),
  );
  expect(blank.artifacts).toHaveLength(0);
  expect(blank.manifest.coverage).toEqual({
    category: "document",
    status: "partial",
    pageCount: 2,
    pages: [{ page: 2, status: "missing" }],
  });
});

test("registered authored PDF bytes alone select the declared synthetic pages; tampered and unknown PDFs are rejected", async () => {
  const bytes = new Uint8Array(
    await Bun.file(new URL("./fixtures/media/text-two-pages.pdf", import.meta.url)).arrayBuffer(),
  );
  const corpus = (await Bun.file(
    new URL("./fixtures/media/manifest.json", import.meta.url),
  ).json()) as { fixtures: { fixtureId: string; expectedVisibleTextByPage?: string[][] }[] };
  const declaredPages = corpus.fixtures.find(
    (fixture) => fixture.fixtureId === "text-two-pages-pdf",
  )?.expectedVisibleTextByPage;
  if (!declaredPages) throw new Error("SYNTHETIC_PDF_DECLARATION_MISSING");
  const pages = declaredPages.map((page) => page.join("\n"));
  const fixture = createReworkNativeProcessor({ pdfFixtures: [{ bytes, pages }] }),
    stub = fixture.binding.get("synthetic-pdf");
  const output = await result(await stub.fetch(await request("/process", bytes, { unit: 1 })));
  expect(output.manifest.probe).toEqual({
    category: "document",
    format: "pdf",
    byteLength: bytes.length,
    pageCount: 2,
  });
  const expectedPage = pages[1];
  if (expectedPage === undefined) throw new Error("SYNTHETIC_PDF_PAGE_MISSING");
  expect(new TextDecoder().decode(output.artifacts[0]?.bytes)).toBe(expectedPage);
  const changed = bytes.slice();
  changed[changed.length - 1] = (changed[changed.length - 1] ?? 0) ^ 1;
  expect((await stub.fetch(await request("/probe", changed))).status).toBe(422);
  const unknown = createReworkNativeProcessor().binding.get("synthetic-unknown");
  expect((await unknown.fetch(await request("/probe", bytes))).status).toBe(422);
  expect(() =>
    createReworkNativeProcessor({ pdfFixtures: [{ bytes: textBytes("not pdf"), pages }] }),
  ).toThrow("SYNTHETIC_PDF_FIXTURE_INVALID");
});

for (const format of ["png", "jpeg"] as const)
  test(`actual ${format} pixels produce a bounded JPEG for the real downstream vision path`, async () => {
    const bytes = new Uint8Array(
      await sharp({
        create: { width: 32, height: 24, channels: 3, background: { r: 16, g: 80, b: 190 } },
      })
        .toFormat(format)
        .toBuffer(),
    );
    const fixture = createReworkNativeProcessor(),
      stub = fixture.binding.get("synthetic-photo");
    const sourceHash = await digest(bytes);
    const probe = await stub.fetch(await request("/probe", bytes));
    expect(probe.status).toBe(200);
    expect(((await probe.json()) as { probe: unknown }).probe).toEqual({
      category: "image",
      format,
      byteLength: bytes.length,
      width: 32,
      height: 24,
    });
    const output = await result(await stub.fetch(await request("/process", bytes)));
    expect(output.manifest.coverage).toEqual({
      category: "image",
      status: "complete",
      observation: "processed",
    });
    expect(output.artifacts[0]?.metadata).toMatchObject({
      kind: "image",
      position: { kind: "image", region: null },
    });
    const image = output.artifacts[0]?.bytes;
    if (!image) throw new Error("SYNTHETIC_JPEG_MISSING");
    const metadata = await sharp(image).metadata(),
      stats = await sharp(image).stats();
    expect(metadata).toMatchObject({ format: "jpeg", width: 32, height: 24, channels: 3 });
    expect(metadata.exif).toBeUndefined();
    expect(Math.abs((stats.channels[2]?.mean ?? 0) - 190)).toBeLessThan(5);
    expect(await digest(bytes)).toBe(sourceHash);
    expect(fixture.counters.artifactBytes).toBe(image.length);
  });

test("native failures, invalid actual bytes/hash/length/coordinates and cancelled delays never return a successful manifest", async () => {
  const fixture = createReworkNativeProcessor(),
    stub = fixture.binding.get("synthetic-failures"),
    bytes = textBytes("합성 원문");
  for (const headers of [
    { "x-baro-hash": "b".repeat(64) },
    { "x-baro-bytes": String(bytes.length - 1) },
    { "x-baro-bytes": String(bytes.length + 1) },
    { "x-baro-frame-offset": "1" },
    { "x-baro-capability": "bad" },
  ]) {
    const response = await stub.fetch(await request("/probe", bytes, { headers }));
    expect([400, 422]).toContain(response.status);
    expect(await response.text()).not.toContain("합성 원문");
  }
  expect((await stub.fetch(await request("/process", bytes, { unit: 1 }))).status).toBe(422);
  expect((await stub.fetch(await request("/probe", new Uint8Array([0, 1, 2])))).status).toBe(422);
  fixture.controls.failNative = true;
  const failed = await stub.fetch(await request("/process", bytes));
  expect(failed.status).toBe(503);
  expect((await failed.json()) as { code: string }).toEqual({
    code: "SYNTHETIC_NATIVE_UNAVAILABLE",
  });
  fixture.controls.failNative = false;
  fixture.controls.delayMs = 1000;
  const controller = new AbortController(),
    before = fixture.counters.inputBytes;
  const pending = stub.fetch(await request("/probe", bytes, { signal: controller.signal }));
  for (let index = 0; index < 100 && fixture.counters.inputBytes === before; index++)
    await Bun.sleep(1);
  expect(fixture.counters.inputBytes).toBe(before + bytes.length);
  controller.abort();
  expect((await pending).status).toBe(503);
  expect(fixture.counters.failed).toBe(2);
  const beforeStop = fixture.counters.inputBytes;
  const stopped = stub.fetch(await request("/process", bytes));
  for (let index = 0; index < 100 && fixture.counters.inputBytes === beforeStop; index++)
    await Bun.sleep(1);
  expect(fixture.counters.inputBytes).toBe(beforeStop + bytes.length);
  await stub.stopProcessing();
  expect((await stopped).status).toBe(503);
  expect(fixture.counters.stop).toBe(1);
});

test("report rendering requires the injected native renderer and never substitutes a mocked PDF", async () => {
  const html = "<!doctype html><html><body>합성 리포트</body></html>",
    bytes = textBytes(html);
  const absent = createReworkNativeProcessor();
  const response = await absent.binding
    .get("synthetic-report")
    .fetch(await request("/report", bytes));
  expect(response.status).toBe(503);
  expect((await response.json()) as { code: string }).toEqual({
    code: "SYNTHETIC_RENDERER_UNAVAILABLE",
  });
  let received = "";
  const failed = createReworkNativeProcessor({
    renderPdf: async (source) => {
      received = source;
      throw new Error("synthetic renderer diagnostic must remain private");
    },
  });
  const unavailable = await failed.binding
    .get("synthetic-report")
    .fetch(await request("/report", bytes));
  expect(received).toBe(html);
  expect(unavailable.status).toBe(503);
  expect(await unavailable.text()).not.toContain("diagnostic");
  const invalid = createReworkNativeProcessor({ renderPdf: async () => new Uint8Array([1, 2, 3]) });
  expect(
    (await invalid.binding.get("synthetic-report").fetch(await request("/report", bytes))).status,
  ).toBe(503);
});

test("stopping one external processor identity does not stop another identity", async () => {
  const fixture = createReworkNativeProcessor();
  fixture.controls.delayMs = 40;
  const first = fixture.binding.get(fixture.binding.idFromName("synthetic-first"));
  const second = fixture.binding.get(fixture.binding.idFromName("synthetic-second"));
  expect(fixture.binding.get("synthetic-first")).toBe(first);
  const bytes = textBytes("합성 분리 작업");
  const a = first.fetch(await request("/process", bytes)),
    b = second.fetch(await request("/process", bytes));
  for (let index = 0; index < 100 && fixture.counters.inputBytes < bytes.length * 2; index++)
    await Bun.sleep(1);
  expect(fixture.counters.inputBytes).toBe(bytes.length * 2);
  await first.stopProcessing();
  expect((await a).status).toBe(503);
  await result(await b);
  expect(fixture.counters.stop).toBe(1);
});
