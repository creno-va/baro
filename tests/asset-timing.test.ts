import { expect, test } from "bun:test";
import { runAssetProcessing } from "../src/server/modules/file-processing/asset-runner";
import { createAssetTiming } from "../src/server/modules/file-processing/asset-timing";

test("asset stage spans exclude scheduling gaps and do not double count cleanup", () => {
  let now = 0;
  const timing = createAssetTiming(() => now);
  timing.enter("initialization");
  now = 5;
  timing.leave();
  now = 1005; // Time between factory initialization and Workflow step execution.
  timing.enter("lease_acquisition");
  now = 1010;
  timing.enter("processor_roundtrip");
  now = 1040;
  timing.enter("cleanup");
  now = 1045;
  timing.enter("cleanup"); // Catch and finally share one exclusive cleanup span.
  now = 1050;
  const result = timing.finish();
  expect(result).toEqual([
    { stage: "initialization", durationMs: 5 },
    { stage: "lease_acquisition", durationMs: 5 },
    { stage: "processor_roundtrip", durationMs: 30 },
    { stage: "cleanup", durationMs: 10 },
  ]);
  now = 2000;
  expect(timing.finish()).toEqual(result);
  const first = result[0];
  if (!first) throw new Error("Expected initial timing observation");
  first.durationMs = 9000;
  expect(timing.finish()[0]?.durationMs).toBe(5);
});

test("absent or invalid clock observations never fabricate a duration or break execution", () => {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_VALUE, -1]) {
    let now = 0;
    const timing = createAssetTiming(() => now);
    timing.enter("publication");
    now = bad;
    expect(timing.finish()).toEqual([]);
  }
  let broken = true;
  let now = 0;
  const timing = createAssetTiming(() => {
    if (broken) throw new Error("Synthetic unavailable clock");
    return now;
  });
  timing.enter("initialization");
  expect(timing.finish()).toEqual([]);
  broken = false;
  timing.enter("cleanup");
  now = 4;
  expect(timing.finish()).toEqual([{ stage: "cleanup", durationMs: 4 }]);
});

const step = {
  do: async (_name: string, options: unknown, callback: () => Promise<unknown>) => {
    expect(options).toEqual({ retries: { limit: 0, delay: "1 second" }, timeout: "5 minutes" });
    return callback();
  },
};

for (const fail of [false, true]) {
  test(`Workflow keeps ${fail ? "sanitized failure" : "success"} result and final signal cleanup with private stage timings`, async () => {
    let now = 0;
    const timing = createAssetTiming(() => now);
    let signal: AbortSignal | undefined;
    const success = { status: "ready" as const, assetId: "synthetic-asset", revision: 3 };
    const failure = { status: "stopped" as const, code: "FILE_PROCESSING_FAILED" as const };
    const result = await runAssetProcessing(
      {
        run: async (input) => {
          signal = input;
          timing.enter("processor_roundtrip");
          now = 12;
          if (fail) throw new Error("Synthetic private provider failure");
          return success;
        },
        fail: async () => {
          timing.enter("failure_record");
          await Promise.resolve();
          expect(signal?.aborted).toBe(true);
          now = 15;
          return failure;
        },
        timings: timing.finish,
      },
      step as never,
    );
    expect(result).toEqual({
      ...(fail ? failure : success),
      stageTimings: [
        { stage: "processor_roundtrip", durationMs: 12 },
        ...(fail ? [{ stage: "failure_record" as const, durationMs: 3 }] : []),
      ],
    });
    expect(signal?.aborted).toBe(true);
    expect(JSON.stringify(result)).not.toContain("private provider");
  });
}

test("optional timing observer failure preserves the successful result and signal cleanup", async () => {
  let signal: AbortSignal | undefined;
  const success = { status: "ready" as const, assetId: "synthetic-asset", revision: 3 };
  const result = await runAssetProcessing(
    {
      run: async (input) => {
        signal = input;
        return success;
      },
      fail: async () => {
        throw new Error("Unexpected product failure");
      },
      timings: () => {
        throw new Error("Synthetic observation failure");
      },
    },
    step as never,
  );
  expect(result).toEqual(success);
  expect(signal?.aborted).toBe(true);
});
