import { expect, test } from "bun:test";
import observation from "../docs/operations/AI-RUNTIME-OBSERVATION.json";
import { modelBounds, modelCapabilitySchema } from "../scripts/provision-ai-budget";
import { runtimeDigest } from "../src/server/db/v2-paid-runtime";
import { configuredMediaPolicy } from "../src/server/modules/budget/media-capability";
import { digest } from "../src/server/modules/files/binary";
import { MODEL_ID } from "../src/server/modules/llm-gateway/prompts";
import {
  documentedVisionSupport,
  isBoundedVisionWire,
  isDocumentedVisionSupport,
  prepareVisionWire,
} from "../src/server/modules/llm-gateway/vision-wire";

const now = "2026-10-15T03:00:00.000Z";
function config() {
  return modelBounds(
    modelCapabilitySchema.parse({
      ...observation,
      checkedAt: "2026-10-07T00:00:00.000Z",
      validUntil: "2026-10-08T00:00:00.000Z",
    }),
    "a".repeat(64),
  );
}
function policy(value: unknown = config(), enabled = false) {
  return configuredMediaPolicy({
    AI_MODEL_TOKEN_BOUNDS_JSON: JSON.stringify(value),
    APPLICATION_COST_LIMITS_ENABLED: String(enabled),
  } as Env);
}
async function input() {
  const wire = prepareVisionWire(new Uint8Array([255, 216, 255, 217]));
  const bytes = new TextEncoder().encode(JSON.stringify(wire));
  return {
    service: "model" as const,
    action: "vision" as const,
    model: MODEL_ID,
    identity: await digest(bytes),
    byteLength: bytes.length,
    durationSeconds: null,
    wire,
  };
}
const inputHash = "b".repeat(64);
test("documented support is immutable server identity, not a fake live observation", async () => {
  const capability = await policy().visionCapability(now);
  expect(capability).toBe(documentedVisionSupport());
  expect(isDocumentedVisionSupport({ ...capability })).toBe(false);
  expect(capability).not.toHaveProperty("validUntil");
  expect(capability).not.toHaveProperty("verifiedAt");
  expect(capability).not.toHaveProperty("liveVerified");
});
test("stale cost observation permits exact full-context technical execution without changing provenance", async () => {
  const original = config(),
    before = JSON.stringify(original),
    runtime = policy(original);
  const prepared = await runtime.bounds(await input(), inputHash, now);
  expect(prepared).toMatchObject({
    inputDigest: inputHash,
    quantities: [
      { sku: "model_input_tokens", maximumQuantity: "1046000" },
      { sku: "model_output_tokens", maximumQuantity: "4000" },
    ],
    verifiedAt: now,
    validUntil: "2026-10-15T03:05:00.000Z",
  });
  expect(JSON.stringify(original)).toBe(before);
  expect(prepared?.evidenceHash).toMatch(/^[a-f0-9]{64}$/);
  expect(await policy(original, true).bounds(await input(), inputHash, now)).toBeNull();
});
for (const condition of [
  "missing",
  "future",
  "context",
  "input",
  "output",
  "basis",
  "vision",
] as const)
  test(`technical ${condition} constraint cannot be bypassed by observation-only mode`, async () => {
    const value = config();
    if (condition === "future") value.verifiedAt = "2099-01-01T00:00:00.000Z";
    if (condition === "context") Object.assign(value.bounds, { modelContextTokenLimit: 1_050_001 });
    if (condition === "input") value.bounds.modelInputTokenLimit = 100;
    if (condition === "output") Object.assign(value.bounds, { modelOutputTokenLimit: 3999 });
    if (condition === "basis") value.bounds.basis = "unverified";
    if (condition === "vision")
      Object.assign(value.bounds, {
        vision: {
          imageCount: 1,
          maximumTokens: 1,
          capabilityEvidenceHash: "a".repeat(64),
          dimensionsAndDetailHash: "b".repeat(64),
        },
      });
    const p = policy(condition === "missing" ? null : value);
    expect(await p.visionCapability(now)).toBeNull();
    expect(await p.bounds(await input(), inputHash, now)).toBeNull();
  });
for (const change of [
  "model",
  "operation",
  "service",
  "identity",
  "length",
  "duration",
  "detail",
  "output",
  "url",
  "store",
  "extra",
] as const)
  test(`vision execution rejects changed ${change}`, async () => {
    const value = await input();
    const mutable = value as unknown as {
      service: string;
      action: string;
      model: string;
      identity: string;
      byteLength: number;
      durationSeconds: number | null;
      wire: Record<string, unknown>;
    };
    const wire = mutable.wire as unknown as {
      messages: [unknown, { content: [{ image_url: { detail: string; url: string } }] }];
      max_completion_tokens: number;
      store: boolean;
      tools?: unknown[];
    };
    if (change === "model") mutable.model = "different-model";
    if (change === "operation") mutable.action = "asr";
    if (change === "service") mutable.service = "asr";
    if (change === "identity") mutable.identity = "0".repeat(64);
    if (change === "length") mutable.byteLength++;
    if (change === "duration") mutable.durationSeconds = 1;
    if (change === "detail") wire.messages[1].content[0].image_url.detail = "high";
    if (change === "output") wire.max_completion_tokens = 4001;
    if (change === "url")
      wire.messages[1].content[0].image_url.url = "https://example.test/private";
    if (change === "store") wire.store = true;
    if (change === "extra") wire.tools = [];
    // Mutated builder settings must fail even with a self-consistent input hash.
    if (["detail", "output", "url", "store", "extra"].includes(change)) {
      const bytes = new TextEncoder().encode(JSON.stringify(wire));
      mutable.byteLength = bytes.length;
      mutable.identity = await digest(bytes);
    }
    expect(await policy().bounds(value, inputHash, now)).toBeNull();
  });
test("vision wire image limit and canonical base64 are checked independently of token count", () => {
  expect(isBoundedVisionWire(prepareVisionWire(new Uint8Array([255, 216])))).toBe(true);
  const big = new Uint8Array(1_048_577);
  big.set([255, 216]);
  expect(isBoundedVisionWire(prepareVisionWire(big))).toBe(false);
  expect(isBoundedVisionWire(prepareVisionWire(new Uint8Array([0, 0])))).toBe(false);
});
test("wire changes retain a distinct execution evidence digest", async () => {
  const a = await input(),
    b = await input();
  b.wire = prepareVisionWire(new Uint8Array([255, 216, 1, 2]));
  const bytes = new TextEncoder().encode(JSON.stringify(b.wire));
  b.identity = await digest(bytes);
  b.byteLength = bytes.length;
  const p = policy();
  const first = await p.bounds(a, await runtimeDigest(a), now),
    second = await p.bounds(b, await runtimeDigest(b), now);
  expect(first).not.toBeNull();
  expect(second).not.toBeNull();
  expect(first?.evidenceHash).not.toBe(second?.evidenceHash);
});
