import { expect, test } from "bun:test";
import { createMediaGateway, WHISPER_MODEL } from "../src/server/modules/llm-gateway/transcription";
import { MODEL_ID } from "../src/server/modules/llm-gateway/prompts";
import type { ProcessingCosts } from "../src/server/modules/file-processing/transport";

const wav = () => {
  const bytes = new Uint8Array(32044);
  bytes.set(new TextEncoder().encode("RIFF"));
  bytes.set(new TextEncoder().encode("WAVEfmt "), 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(4, bytes.length - 8, true);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  bytes.set(new TextEncoder().encode("data"), 36);
  view.setUint32(40, 32000, true);
  return bytes;
};
const valid = {
  text: "synthetic speech",
  transcription_info: { duration: 1 },
  segments: [
    {
      start: 0,
      end: 1,
      text: "synthetic speech",
      avg_logprob: -0.2,
      no_speech_prob: 0.1,
      compression_ratio: 1,
    },
  ],
};
function setup(
  options: {
    reserve?: () => void;
    output?: unknown;
    run?: () => Promise<unknown>;
    timeoutMs?: number;
  } = {},
) {
  let allowed = true,
    capable = true,
    calls = 0;
  const controller = new AbortController();
  const receipts: { transport: string; rawUsage?: unknown }[] = [];
  const pending: Promise<void>[] = [];
  const wires: Record<string, unknown>[] = [];
  const models: string[] = [];
  const costs: ProcessingCosts = {
    before: async (input) => {
      expect(input.identity).toMatch(/^[a-f0-9]{64}$/);
      expect(input.wire).toBeDefined();
      options.reserve?.();
      return { attemptId: "synthetic-attempt", dispatchToken: "synthetic-dispatch" };
    },
    after: async (_, receipt) => {
      receipts.push(receipt);
    },
  };
  const gateway = createMediaGateway(
    {
      AI_GATEWAY_ID: "synthetic-gateway",
      AI: {
        run: (model, wire, opts) => {
          calls++;
          models.push(model);
          wires.push(wire);
          expect(opts.gateway.collectLog).toBe(false);
          expect(opts.gateway.skipCache).toBe(true);
          return options.run?.() ?? Promise.resolve(options.output ?? valid);
        },
      },
    },
    {
      costs,
      waitUntil: (p) => pending.push(p),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      visionCapability: async () =>
        capable
          ? { model: MODEL_ID, wire: "chat_image_url", validUntil: "2099-01-01T00:00:00Z" }
          : null,
    },
  );
  return {
    gateway,
    access: { authorize: async () => allowed, signal: controller.signal },
    receipts,
    models,
    wires,
    pending,
    revoke: () => {
      allowed = false;
    },
    disableVision: () => {
      capable = false;
    },
    state: () => calls,
  };
}

test("pinned Whisper uses full chunk with absolute timestamps and truthful raw receipt", async () => {
  const s = setup();
  const result = await s.gateway.transcribe(wav(), 30, 31, s.access);
  expect(s.models).toEqual([WHISPER_MODEL]);
  expect(s.wires[0]?.vad_filter).toBe(false);
  expect(s.wires[0]?.condition_on_previous_text).toBe(false);
  expect(result.segments).toEqual([{ startSeconds: 30, endSeconds: 31, text: "synthetic speech" }]);
  expect(result.status).toBe("processed");
  expect(s.receipts).toEqual([{ transport: "response", rawUsage: valid }]);
});

test("consent revocation during paid reservation makes zero model calls", async () => {
  let s: ReturnType<typeof setup>;
  s = setup({ reserve: () => s.revoke() });
  await expect(s.gateway.transcribe(wav(), 0, 1, s.access)).rejects.toMatchObject({
    code: "STALE_REVISION",
  });
  expect(s.state()).toBe(0);
  expect(s.receipts).toEqual([{ transport: "not_sent" }]);
});

test("missing or revoked vision capability never assumes model image support", async () => {
  let s: ReturnType<typeof setup>;
  s = setup({ reserve: () => s.disableVision() });
  await expect(
    s.gateway.observe(new Uint8Array([255, 216, 255, 217]), s.access),
  ).rejects.toMatchObject({ code: "STALE_REVISION" });
  expect(s.state()).toBe(0);
  expect(s.receipts).toEqual([{ transport: "not_sent" }]);
  await expect(
    s.gateway.observe(new Uint8Array([255, 216, 255, 217]), s.access),
  ).rejects.toMatchObject({ code: "MODEL_UNAVAILABLE" });
});

for (const segments of [
  [{ start: 0, end: 2, text: "synthetic" }],
  [
    { start: 0, end: 0.7, text: "synthetic" },
    { start: 0.6, end: 1, text: "synthetic" },
  ],
])
  test("out-of-chunk or overlapping ASR timestamps reject after recording actual response", async () => {
    const s = setup({ output: { ...valid, segments } });
    await expect(s.gateway.transcribe(wav(), 0, 1, s.access)).rejects.toMatchObject({
      code: "MODEL_SCHEMA_INVALID",
    });
    expect(s.receipts[0]?.transport).toBe("response");
  });

test("missing confidence and empty text preserve low-quality coverage", async () => {
  const s = setup({ output: { text: "", segments: [] } });
  expect((await s.gateway.transcribe(wav(), 0, 1, s.access)).status).toBe("low_quality");
});

test("timeout retains unknown charge exposure and observes the late real outcome", async () => {
  let resolve!: (value: unknown) => void;
  const s = setup({
    timeoutMs: 1,
    run: () =>
      new Promise((r) => {
        resolve = r;
      }),
  });
  await expect(s.gateway.transcribe(wav(), 0, 1, s.access)).rejects.toMatchObject({
    code: "JOB_TIMEOUT",
  });
  expect(s.receipts).toEqual([{ transport: "unknown" }]);
  resolve(valid);
  await Promise.all(s.pending);
  expect(s.receipts).toEqual([
    { transport: "unknown" },
    { transport: "response", rawUsage: valid },
  ]);
});

test("synchronous binding failure is sanitized and keeps unknown exposure", async () => {
  const s = setup({
    run: () => {
      throw new Error("synthetic provider error");
    },
  });
  await expect(s.gateway.transcribe(wav(), 0, 1, s.access)).rejects.toMatchObject({
    code: "MODEL_UNAVAILABLE",
  });
  expect(s.receipts).toEqual([{ transport: "unknown" }]);
});

test("WAV duration and PCM format are proven before any paid/provider call", async () => {
  const s = setup(),
    invalid = wav();
  new DataView(invalid.buffer).setUint32(24, 8000, true);
  await expect(s.gateway.transcribe(invalid, 0, 1, s.access)).rejects.toMatchObject({
    code: "FILE_REJECTED",
  });
  await expect(s.gateway.transcribe(wav(), 0, 2, s.access)).rejects.toMatchObject({
    code: "FILE_REJECTED",
  });
  expect(s.state()).toBe(0);
  expect(s.receipts).toEqual([]);
});
