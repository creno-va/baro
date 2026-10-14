import { expect, test } from "bun:test";
import { measureD1Work } from "./helpers/d1-work";
import {
  createNativeMeasurements,
  createNativeRecoveryMeasurements,
  nativeHostMeasurements,
  nativeHostMeasurementsSchema,
  nativeRecoveryWork,
} from "./helpers/native-measurements";
import { createNativeProgress } from "./helpers/native-progress";

test("native wall measurements include sync bridge time and distinguish overlapping calls from SQL time", () => {
  let now = 0;
  const measured = createNativeMeasurements(() => now);
  const prepare = measured.begin("prepare");
  now = 3;
  prepare();
  prepare(); // Closing twice cannot inflate evidence.
  const first = measured.begin("first");
  now = 5;
  const second = measured.begin("first");
  now = 7;
  expect(measured.snapshot()).toMatchObject({
    pending: 2,
    oldestPendingOperation: "first",
    oldestPendingMs: 4,
  });
  second();
  expect(measured.snapshot()).toMatchObject({ pending: 1, oldestPendingMs: 4 });
  now = 11;
  first(true);
  measured.sql(0.25);
  measured.sql(undefined);
  measured.sql(Number.NaN);
  expect(measured.snapshot()).toMatchObject({
    pending: 0,
    oldestPendingMs: null,
    sqlMs: 0.25,
    sqlStatementsKnown: 1,
    sqlStatementsUnknown: 2,
  });
  expect(measured.snapshot().operations.filter((row) => row.calls)).toEqual([
    { operation: "prepare", calls: 1, completed: 1, failed: 0, wallMs: 3, maximumWallMs: 3 },
    { operation: "first", calls: 2, completed: 2, failed: 1, wallMs: 10, maximumWallMs: 8 },
  ]);
});

test("native D1 wrapper measures existing operations without added calls and preserves pending/failure", async () => {
  let now = 0,
    resolve = (_value: D1Result) => {},
    reject = (_error: Error) => {};
  let prepareCalls = 0,
    bindCalls = 0,
    allCalls = 0;
  const statement = {
    bind() {
      bindCalls++;
      now += 2;
      return statement;
    },
    all() {
      allCalls++;
      return new Promise<D1Result>((yes, no) => {
        resolve = yes;
        reject = no;
      });
    },
  };
  const binding = {
    prepare() {
      prepareCalls++;
      now += 3;
      return statement;
    },
  } as unknown as D1Database;
  const measured = measureD1Work(binding, undefined, () => now);
  const query = measured.binding.prepare("private SQL").bind("private value");
  const first = query.first<number>("value");
  now += 7;
  expect(measured.measurements()).toMatchObject({
    pending: 1,
    oldestPendingOperation: "first",
    oldestPendingMs: 7,
  });
  resolve({
    results: [{ value: 17 }],
    meta: { rows_read: 1, rows_written: 0, duration: 0.5 },
  } as D1Result);
  expect(await first).toBe(17);
  const failed = query.all();
  now += 4;
  reject(new Error("private error"));
  await expect(failed).rejects.toThrow("private error");
  expect({ prepareCalls, bindCalls, allCalls }).toEqual({
    prepareCalls: 1,
    bindCalls: 1,
    allCalls: 2,
  });
  expect(measured.measurements()).toMatchObject({ pending: 0, sqlMs: 0.5, sqlStatementsKnown: 1 });
  expect(measured.measurements().operations.filter((row) => row.calls)).toEqual([
    { operation: "prepare", calls: 1, completed: 1, failed: 0, wallMs: 3, maximumWallMs: 3 },
    { operation: "bind", calls: 1, completed: 1, failed: 0, wallMs: 2, maximumWallMs: 2 },
    { operation: "all", calls: 1, completed: 1, failed: 1, wallMs: 4, maximumWallMs: 4 },
    { operation: "first", calls: 1, completed: 1, failed: 0, wallMs: 7, maximumWallMs: 7 },
  ]);
  expect(JSON.stringify(measured.measurements())).not.toContain("private");
});

test("recovery spans preserve result/error and show the active await independently of completed work", async () => {
  let now = 0,
    release = () => {};
  const measured = createNativeRecoveryMeasurements(() => now);
  const task = measured.run("policy_job_readback", async () => {
    await new Promise<void>((yes) => {
      release = yes;
    });
    return 17;
  });
  now = 11;
  expect(measured.snapshot()).toMatchObject({
    active: "policy_job_readback",
    activeMs: 11,
    completed: [],
  });
  release();
  expect(await task).toBe(17);
  await expect(
    measured.run("recovery_request", async () => {
      now += 9;
      throw new Error("private");
    }),
  ).rejects.toThrow("private");
  expect(measured.snapshot()).toMatchObject({
    active: null,
    activeMs: null,
    completed: [
      { step: "policy_job_readback", durationMs: 11 },
      { step: "recovery_request", durationMs: 9 },
    ],
  });
});

test("progress emits only schema-validated numeric profiles and fixed recovery steps", () => {
  const emitted: unknown[] = [];
  const measured = createNativeMeasurements(() => 0);
  const progress = createNativeProgress(true, {
    schedule: () => 1,
    cancel() {},
    emit: (value) => emitted.push(value),
  });
  progress.observe(() => ({
    databaseMeasurements: measured.snapshot(),
    recoveryMeasurements: { active: "private input", activeMs: 2, completed: [] },
    providerMeasurements: { calls: 1, wallMs: 0.1, maximumWallMs: 0.1 },
    hostBaseline: { rssBytes: 1, heapUsedBytes: 1, userCpuMicros: 1, systemCpuMicros: 1 },
    hostMeasurements: { ...nativeHostMeasurements(), private: "secret" },
  }));
  progress.finish(false);
  expect(emitted[0]).toMatchObject({
    databaseMeasurements: { pending: 0 },
    providerMeasurements: { calls: 1 },
    hostBaseline: { rssBytes: 1 },
  });
  expect(emitted[0]).not.toHaveProperty("recoveryMeasurements");
  expect(emitted[0]).not.toHaveProperty("hostMeasurements");
  expect(JSON.stringify(emitted)).not.toMatch(/private|secret/);
  expect(nativeHostMeasurementsSchema.safeParse(nativeHostMeasurements()).success).toBe(true);
});

test("recovery work deltas isolate each await while retaining native bridge and SQL costs", async () => {
  let now = 0;
  const database = createNativeMeasurements(() => now);
  const provider = { calls: 0, wallMs: 0 };
  const recovery = createNativeRecoveryMeasurements(() => now);
  recovery.observe(() => nativeRecoveryWork(database.snapshot(), provider));
  const earlier = database.begin("first");
  now += 5;
  earlier();
  database.sql(1);
  await recovery.run("recovery_request", async () => {
    const prepare = database.begin("prepare");
    now += 2;
    prepare();
    const query = database.begin("first");
    now += 8;
    query();
    database.sql(0.4);
    provider.calls++;
    provider.wallMs += 0.1;
  });
  expect(recovery.snapshot().completed).toEqual([
    {
      step: "recovery_request",
      durationMs: 10,
      work: {
        bridgeCalls: 1,
        bridgeWallMs: 2,
        queryCalls: 1,
        queryWallMs: 8,
        sqlStatements: 1,
        sqlMs: 0.4,
        providerCalls: 1,
        providerWallMs: 0.1,
      },
    },
  ]);
  await recovery.run("recovery_runtime", async () => {
    const query = database.begin("first");
    now += 4;
    expect(recovery.snapshot().activeWork).toMatchObject({
      queryCalls: 1,
      queryWallMs: 0,
      sqlStatements: 0,
    });
    query();
    database.sql(0.2);
  });
  expect(recovery.snapshot().completed[1]?.work).toMatchObject({
    queryCalls: 1,
    queryWallMs: 4,
    sqlStatements: 1,
    sqlMs: 0.2,
    providerCalls: 0,
  });
});
