import { expect, test } from "bun:test";
import { createCaseDataCipher } from "../src/server/crypto";
import { decryptArtifact, encryptArtifact } from "../src/server/modules/file-processing/artifacts";
import {
  MAX_LINE_BYTES,
  processorLines,
  processorManifestSchema,
} from "../src/server/modules/file-processing/protocol";
import {
  createProcessorTransport,
  type ProcessingCosts,
} from "../src/server/modules/file-processing/transport";
import { digest } from "../src/server/modules/files/binary";

const controller = () => new AbortController();
const input = new TextEncoder().encode("합성 원본 💙");
const probe = {
  category: "document" as const,
  format: "txt" as const,
  byteLength: input.byteLength,
  pageCount: 1,
};

test("native unit fragment preserves 100000-page source identity without sending whole-file missing coverage", () => {
  const value = {
    version: 1,
    unit: 99999,
    totalUnits: 100000,
    frameOffset: 0,
    decodedFrameCount: 0,
    probe: { category: "document", format: "txt", byteLength: 200000, pageCount: 100000 },
    coverage: {
      category: "document",
      status: "complete",
      pageCount: 100000,
      pages: [{ page: 100000, status: "processed" }],
    },
    artifacts: [],
    outputBytes: 0,
  };
  expect(processorManifestSchema.safeParse(value).success).toBe(true);
  expect(JSON.stringify(value).length).toBeLessThan(600);
  expect(
    processorManifestSchema.safeParse({
      ...value,
      coverage: { ...value.coverage, pages: [{ page: 1, status: "processed" }] },
    }).success,
  ).toBe(false);
  expect(processorManifestSchema.safeParse({ ...value, totalUnits: 1 }).success).toBe(false);
  expect(processorManifestSchema.safeParse({ ...value, decodedFrameCount: 1 }).success).toBe(false);
});
async function fixture(
  options: { reserve?: () => void; allowed?: boolean; records?: unknown[] } = {},
) {
  let allowed = options.allowed ?? true,
    calls = 0,
    stops = 0;
  const receipts: string[] = [];
  const contentHash = await digest(input);
  const manifest = {
    version: 1 as const,
    unit: 0,
    totalUnits: 1,
    frameOffset: 0,
    decodedFrameCount: 0,
    probe,
    coverage: {
      category: "document" as const,
      status: "complete" as const,
      pageCount: 1,
      pages: [{ page: 1, status: "processed" as const }],
    },
    artifacts: [
      {
        index: 0,
        kind: "extracted_text" as const,
        position: { kind: "document" as const, page: 1, paragraph: null, table: null },
        byteLength: input.byteLength,
        contentHash,
      },
    ],
    outputBytes: input.byteLength,
  };
  const costs: ProcessingCosts = {
    before: async () => {
      options.reserve?.();
      return { attemptId: "attempt", dispatchToken: "dispatch" };
    },
    after: async (_, r) => {
      receipts.push(r.transport);
    },
  };
  const transport = createProcessorTransport({
    costs,
    stop: async () => {
      stops++;
    },
    fetch: async (request) => {
      calls++;
      expect(request.headers.has("cookie")).toBe(false);
      expect(request.headers.has("authorization")).toBe(false);
      const body = await request.arrayBuffer();
      expect(new Uint8Array(body)).toEqual(input);
      const raw = String.fromCharCode(...input);
      const records = options.records ?? [
        { type: "manifest", value: manifest },
        { type: "artifact", index: 0, data: btoa(raw) },
        { type: "complete" },
      ];
      return new Response(`${records.map((r) => JSON.stringify(r)).join("\n")}\n`, {
        headers: { "content-type": "application/x-ndjson" },
      });
    },
  });
  return {
    transport,
    manifest,
    access: { authorize: async () => allowed, signal: controller().signal },
    source: {
      byteLength: input.byteLength,
      contentHash,
      open: () => new Response(input.slice()).body!,
    },
    setAllowed(v: boolean) {
      allowed = v;
    },
    state: () => ({ calls, stops, receipts }),
  };
}
test("actual AES artifact byte roundtrip binds owner/environment/file/revision/blob and rejects mutation", async () => {
  const cipher = await createCaseDataCipher({
    CASE_DATA_KEY_V1: btoa("q".repeat(32)).replace(/=+$/, ""),
  });
  const id = {
    environment: "preview" as const,
    ownerId: "owner",
    fileId: "file",
    fileRevision: 2,
    blobId: "blob",
  };
  const encrypted = await encryptArtifact(cipher, id, input);
  expect(new TextDecoder().decode(encrypted).includes("합성")).toBe(false);
  expect(await decryptArtifact(cipher, id, encrypted)).toEqual(input);
  for (const change of [
    { ownerId: "other" },
    { fileId: "other" },
    { fileRevision: 3 },
    { blobId: "other" },
    { environment: "production" as const },
  ])
    await expect(decryptArtifact(cipher, { ...id, ...change }, encrypted)).rejects.toThrow(
      "FILE_REJECTED",
    );
  const corrupted = encrypted.slice();
  const finalIndex = corrupted.length - 1;
  corrupted[finalIndex] = (corrupted[finalIndex] ?? 0) ^ 1;
  await expect(decryptArtifact(cipher, id, corrupted)).rejects.toThrow("FILE_REJECTED");
});
test("one artifact at a time with validated manifest/hash/order/completion", async () => {
  const f = await fixture();
  let artifacts = 0;
  await f.transport.processUnit(f.source, f.access, {
    manifest: async (m) => {
      expect(m).toEqual(f.manifest);
    },
    artifact: async (a, bytes) => {
      artifacts++;
      expect(a.index).toBe(0);
      expect(bytes).toEqual(input);
    },
  });
  expect(artifacts).toBe(1);
  expect(f.state()).toEqual({ calls: 1, stops: 1, receipts: ["response"] });
});
test("revocation while reservation awaits causes zero native calls and not_sent receipt", async () => {
  let revoke: () => void = () => {};
  const f = await fixture({ reserve: () => revoke() });
  revoke = () => f.setAllowed(false);
  await expect(
    f.transport.processUnit(f.source, f.access, {
      manifest: async () => {},
      artifact: async () => {},
    }),
  ).rejects.toThrow("STALE_REVISION");
  expect(f.state()).toEqual({ calls: 0, stops: 1, receipts: ["not_sent"] });
});
test("authorization throw after paid reserve does not disclose bytes", async () => {
  const f = await fixture();
  let authCalls = 0;
  f.access.authorize = async () => {
    if (++authCalls > 1) throw new Error("synthetic");
    return true;
  };
  await expect(
    f.transport.processUnit(f.source, f.access, {
      manifest: async () => {},
      artifact: async () => {},
    }),
  ).rejects.toThrow("STALE_REVISION");
  expect(f.state().calls).toBe(0);
  expect(f.state().receipts).toEqual(["not_sent"]);
});
test("cancel after manifest prevents artifact sink and always stops native job", async () => {
  const f = await fixture(),
    signal = controller();
  f.access.signal = signal.signal;
  let count = 0;
  await expect(
    f.transport.processUnit(f.source, f.access, {
      manifest: async () => {
        signal.abort();
      },
      artifact: async () => {
        count++;
      },
    }),
  ).rejects.toThrow();
  expect(count).toBe(0);
  expect(f.state().stops).toBe(1);
});
for (const kind of [
  "missing_complete",
  "wrong_hash",
  "wrong_order",
  "extra_after_complete",
  "unknown_field",
] as const)
  test(`rejects actual wire ${kind}`, async () => {
    const base = await fixture();
    const raw = btoa(String.fromCharCode(...input));
    const records: unknown[] = [
      { type: "manifest", value: base.manifest },
      { type: "artifact", index: 0, data: raw },
      { type: "complete" },
    ];
    if (kind === "missing_complete") records.pop();
    if (kind === "wrong_hash")
      records[1] = { type: "artifact", index: 0, data: btoa("x".repeat(input.length)) };
    if (kind === "wrong_order") records[1] = { type: "artifact", index: 1, data: raw };
    if (kind === "extra_after_complete") records.push({ type: "complete" });
    if (kind === "unknown_field")
      records[1] = { type: "artifact", index: 0, data: raw, escapedUrl: "https://example.invalid" };
    const f = await fixture({ records });
    await expect(
      f.transport.processUnit(f.source, f.access, {
        manifest: async () => {},
        artifact: async () => {},
      }),
    ).rejects.toThrow();
    expect(f.state().stops).toBe(1);
  });
test("one-byte UTF-8 boundaries preserve supplementary Unicode and reject unfinished/oversized line", async () => {
  const bytes = new TextEncoder().encode(`${JSON.stringify({ text: "한글💙" })}\n`);
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (const byte of bytes) c.enqueue(Uint8Array.of(byte));
      c.close();
    },
  });
  const values = [];
  for await (const value of processorLines(stream, controller().signal)) values.push(value);
  expect(values).toEqual([{ text: "한글💙" }]);
  for (const bad of ["{}", `${"x".repeat(MAX_LINE_BYTES + 1)}\n`]) {
    await expect(
      (async () => {
        for await (const _ of processorLines(new Response(bad).body!, controller().signal)) {
        }
      })(),
    ).rejects.toThrow("FILE_REJECTED");
  }
});
test("shared manifest rejects outside source positions and impossible complete coverage", async () => {
  const f = await fixture();
  expect(
    processorManifestSchema.safeParse({
      ...f.manifest,
      artifacts: [
        { ...f.manifest.artifacts[0], position: { kind: "audio", startSeconds: 0, endSeconds: 1 } },
      ],
    }).success,
  ).toBe(false);
  expect(
    processorManifestSchema.safeParse({
      ...f.manifest,
      coverage: { ...f.manifest.coverage, pages: [{ page: 1, status: "missing" }] },
    }).success,
  ).toBe(false);
});
