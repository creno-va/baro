import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNativeProgress } from "./helpers/native-progress";

function fixture() {
  let now = 0,
    callback = () => {};
  const emitted: unknown[] = [],
    cancelled: unknown[] = [];
  const progress = createNativeProgress(true, {
    clock: () => now,
    emit: (snapshot) => emitted.push(snapshot),
    schedule: (action, delay) => {
      expect(delay).toBe(25000);
      callback = action;
      return 17;
    },
    cancel: (timer) => {
      cancelled.push(timer);
    },
  });
  return {
    progress,
    emitted,
    cancelled,
    tick: () => callback(),
    at: (time: number) => {
      now = time;
    },
  };
}

test("slow native progress snapshots one fixed boundary and completed phase timings without IO", () => {
  const f = fixture();
  f.at(100);
  f.progress.enter("schema", "migrate");
  f.at(300);
  f.progress.enter("baseline", "create");
  f.at(400);
  f.progress.boundary("prepare_job");
  let reads = 0;
  f.progress.observe(() => {
    reads++;
    return {
      providerCalls: 2,
      requestOrdinal: 1,
      databaseTrace: {
        operation: "bind",
        state: "pending",
        measurementMetadataPresent: null,
        maximumBoundParameters: 33,
        maximumBatchStatements: 2,
      },
    };
  });
  f.at(26000);
  f.tick();
  expect(f.emitted).toEqual([
    {
      event: "native_runtime_progress",
      reason: "slow",
      requestedCostLimitsEnabled: true,
      activeCostLimitsEnabled: null,
      elapsedMs: 26000,
      timerDelayMs: 1000,
      phase: "baseline",
      phaseElapsedMs: 25700,
      boundary: "prepare_job",
      boundaryElapsedMs: 25600,
      completedPhases: [
        { phase: "bootstrap", durationMs: 100 },
        { phase: "schema", durationMs: 200 },
      ],
      providerCalls: 2,
      requestOrdinal: 1,
      lastMeasuredPreviewTrace: {
        operation: "bind",
        state: "pending",
        measurementMetadataPresent: null,
        maximumBoundParameters: 33,
        maximumBatchStatements: 2,
      },
    },
  ]);
  f.progress.finish(false);
  f.tick();
  expect(reads).toBe(1);
  expect(f.emitted).toHaveLength(1);
  expect(f.cancelled.every((timer) => timer === 17)).toBe(true);
});

test("completed native tests clear the timer and never emit later", () => {
  const f = fixture();
  f.progress.finish(true);
  f.at(30000);
  f.tick();
  f.progress.finish(false);
  expect(f.emitted).toEqual([]);
  expect(f.cancelled).toContain(17);
});

test("native progress allowlists hostile runtime fields and preserves unavailable clock as null", () => {
  const f = fixture();
  f.progress.enter("private-owner" as never, "private-sql" as never);
  f.progress.observe(() => ({
    providerCalls: Number.NaN,
    requestOrdinal: -1,
    databaseFailureHistory: {
      first: [
        {
          operation: "first",
          details: [{ name: "Error", code: "private-id", category: "unknown", knownFailure: null }],
        },
      ],
      omitted: 0,
    },
    databaseTrace: {
      operation: "private-sql",
      state: "private-error",
      maximumBoundParameters: Infinity,
    },
    privateInput: "NEVER_SERIALIZE",
  }));
  f.at(Number.NaN);
  f.progress.finish(false);
  const encoded = JSON.stringify(f.emitted);
  expect(encoded).not.toContain("private-");
  expect(encoded).not.toContain("NEVER_SERIALIZE");
  expect(f.emitted[0]).toMatchObject({
    reason: "incomplete_test",
    phase: "bootstrap",
    boundary: "get_d1",
    elapsedMs: null,
    timerDelayMs: null,
    providerCalls: null,
    requestOrdinal: null,
    lastMeasuredPreviewTrace: { operation: null, state: null, maximumBoundParameters: null },
  });
  const broken = createNativeProgress(false, {
    clock: () => {
      throw new Error("private-error");
    },
    emit: () => {
      throw new Error("private-error");
    },
    schedule: () => 1,
    cancel: () => {
      throw new Error("private-error");
    },
  });
  expect(() => broken.finish(false)).not.toThrow();
});

test("Bun afterEach snapshots a timed-out pending test and clears its diagnostic timer", async () => {
  const directory = await mkdtemp(join(tmpdir(), "baro-native-progress-"));
  try {
    const path = join(directory, "pending.test.ts");
    await writeFile(
      path,
      `
import { afterEach, test } from "bun:test";
import { createNativeProgress } from ${JSON.stringify(new URL("./helpers/native-progress.ts", import.meta.url).pathname)};
let progress;
afterEach(() => progress?.finish(false));
test("synthetic pending boundary", async () => {
  progress = createNativeProgress(true, {
    schedule: () => 1,
    cancel: () => console.log("SYNTHETIC_TIMER_CLEARED"),
  });
  progress.enter("migration", "upgrade");
  await new Promise(() => {});
}, 30);
`,
    );
    const child = Bun.spawn([process.execPath, "test", path], { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(code).toBe(1);
    const snapshots = stderr
      .split("\n")
      .filter((line) => line.startsWith('{"event":"native_runtime_progress"'))
      .map((line) => JSON.parse(line));
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      reason: "incomplete_test",
      phase: "migration",
      boundary: "upgrade",
    });
    expect(stdout).toContain("SYNTHETIC_TIMER_CLEARED");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
