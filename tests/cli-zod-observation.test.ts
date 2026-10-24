import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { z } from "zod";

const counter = z.strictObject({
  rejected: z.literal(true),
  elementVisits: z.number().int().min(0).max(512),
  issues: z.number().int().min(1).max(2048),
});
const observation = z.strictObject({
  observedAt: z.iso.datetime().optional(),
  kind: z.literal("bounded-cli-zod-schema-observation"),
  cliVersion: z.string().regex(/^58\.\d+\.\d+$/),
  cliZodVersion: z.string().regex(/^3\.\d+\.\d+$/),
  productZodVersion: z.string().regex(/^4\.\d+\.\d+$/),
  pluginAccepted: z.literal(true),
  validOutputAccepted: z.literal(true),
  commandAccepted: z.literal(true),
  unknownCommandRejected: z.literal(true),
  extraCommandFieldRejected: z.literal(true),
  constrainedLegacy: counter,
  constrainedProduct: counter,
  malformedOutputs: z
    .array(
      z.strictObject({
        syntheticElements: z.union([z.literal(128), z.literal(256), z.literal(512)]),
        rejected: z.literal(true),
        topLevelIssues: z.number().int().min(1).max(2048),
      }),
    )
    .length(3),
  arbitraryLargeInputTested: z.literal(false),
  peakMemoryProven: z.literal(false),
  networkStarted: z.literal(false),
  devServerStarted: z.literal(false),
  providerCalled: z.literal(false),
  rawValuesExported: z.literal(false),
  rawAuditPassed: z.literal(false),
  entireCliReachabilityProven: z.literal(false),
});
test("actual CLI validators accept supported synthetic commands and reject malformed input in a bounded Node child", async () => {
  const node = Bun.which("node");
  if (!node) throw Error("NODE_RUNTIME_REQUIRED");
  const child = Bun.spawn(
    [
      node,
      "--max-old-space-size=128",
      resolve("tests/fixtures/toolchain-security/zod-cli-probe.cjs"),
      process.cwd(),
    ],
    {
      stdout: "pipe",
      stderr: "ignore",
      env: { PATH: process.env.PATH, NODE_ENV: "test" },
    },
  );
  const timer = setTimeout(() => child.kill(), 7500);
  try {
    const output = await new Response(child.stdout).text();
    expect(await child.exited).toBe(0);
    expect(output.length).toBeLessThan(8192);
    const result = observation.parse(JSON.parse(output));
    // The fixed production validator must reject the excessive array before running its elements.
    expect(result.constrainedProduct.elementVisits).toBe(0);
    expect(result.constrainedProduct.issues).toBe(1);
    expect(result.malformedOutputs.map((v) => v.syntheticElements)).toEqual([128, 256, 512]);
  } finally {
    clearTimeout(timer);
  }
}, 10000);
test("stored bounded observations cannot turn into raw-input, audit-success or whole-CLI reachability proof", async () => {
  const stored = await Bun.file("docs/quality/cli-zod-2026-10-24/schema-observation.json").json();
  expect(observation.safeParse(stored).success).toBe(true);
  for (const patch of [
    { rawInput: "synthetic-private" },
    { rawValuesExported: true },
    { rawAuditPassed: true },
    { peakMemoryProven: true },
    { entireCliReachabilityProven: true },
    { arbitraryLargeInputTested: true },
    { constrainedLegacy: { ...stored.constrainedLegacy, elementVisits: 1000000 } },
  ])
    expect(observation.safeParse({ ...stored, ...patch }).success).toBe(false);
});
