import { z } from "zod";

const duration = z.number().finite().nonnegative();
const count = z.number().int().nonnegative();
export const nativeD1Operations = [
  "prepare",
  "bind",
  "all",
  "run",
  "first",
  "raw",
  "batch",
] as const;
type Operation = (typeof nativeD1Operations)[number];
const operation = z.enum(nativeD1Operations);
export const nativeD1MeasurementsSchema = z.strictObject({
  operations: z
    .array(
      z.strictObject({
        operation,
        calls: count,
        completed: count,
        failed: count,
        wallMs: duration,
        maximumWallMs: duration,
      }),
    )
    .max(7),
  pending: count,
  oldestPendingOperation: operation.nullable(),
  oldestPendingMs: duration.nullable(),
  sqlStatementsKnown: count,
  sqlStatementsUnknown: count,
  sqlMs: duration,
});
export type NativeD1Measurements = z.infer<typeof nativeD1MeasurementsSchema>;

/** Test-only wall/SQL split. No SQL, bindings, result rows or error values are accepted.
 * Async wrapper wall includes the native call/bridge and can overlap another call;
 * summed wall is not elapsed time or remote network time. SQL time is only the
 * existing native meta.duration, with unavailable statements counted explicitly.
 * These counters are cumulative and independent of the caller's work/trace reset. */
export function createNativeMeasurements(clock = () => performance.now()) {
  const operations = nativeD1Operations.map((operation) => ({
    operation,
    calls: 0,
    completed: 0,
    failed: 0,
    wallMs: 0,
    maximumWallMs: 0,
  }));
  const pending = new Map<object, { operation: Operation; started: number }>();
  let sqlStatementsKnown = 0,
    sqlStatementsUnknown = 0,
    sqlMs = 0;
  const ms = (value: number) => Math.max(0, Math.round(value * 1000) / 1000);
  return {
    begin(operation: Operation) {
      const row = operations.find((row) => row.operation === operation);
      if (!row) throw new Error("Invalid native measurement operation");
      const token = {},
        started = clock();
      row.calls++;
      pending.set(token, { operation, started });
      return (failed = false) => {
        if (!pending.delete(token)) return;
        const elapsed = ms(clock() - started);
        row.completed++;
        row.failed += Number(failed);
        row.wallMs += elapsed;
        row.maximumWallMs = Math.max(row.maximumWallMs, elapsed);
      };
    },
    sql(value: unknown) {
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
        sqlStatementsKnown++;
        sqlMs += value;
      } else sqlStatementsUnknown++;
    },
    snapshot(): NativeD1Measurements {
      const first = pending.values().next().value;
      return {
        operations: operations.map((row) => ({ ...row, wallMs: ms(row.wallMs) })),
        pending: pending.size,
        oldestPendingOperation: first?.operation ?? null,
        oldestPendingMs: first ? ms(clock() - first.started) : null,
        sqlStatementsKnown,
        sqlStatementsUnknown,
        sqlMs: ms(sqlMs),
      };
    },
  };
}

export const nativeRecoverySteps = [
  "outage_runtime",
  "outage_latest",
  "policy_retry_revision",
  "policy_retry_request",
  "policy_rejected_runtime",
  "policy_job_readback",
  "policy_flag_readback",
  "policy_intake_readback",
  "recovery_revision",
  "recovery_request",
  "recovery_runtime",
] as const;
const recoveryStep = z.enum(nativeRecoverySteps);
const recoveryWorkSchema = z.strictObject({
  bridgeCalls: count,
  bridgeWallMs: duration,
  queryCalls: count,
  queryWallMs: duration,
  sqlStatements: count,
  sqlMs: duration,
  providerCalls: count,
  providerWallMs: duration,
});
type RecoveryWork = z.infer<typeof recoveryWorkSchema>;
const emptyWork = (): RecoveryWork => ({
  bridgeCalls: 0,
  bridgeWallMs: 0,
  queryCalls: 0,
  queryWallMs: 0,
  sqlStatements: 0,
  sqlMs: 0,
  providerCalls: 0,
  providerWallMs: 0,
});
export function nativeRecoveryWork(
  database: NativeD1Measurements,
  provider: { calls: number; wallMs: number },
): RecoveryWork {
  const result = emptyWork();
  for (const row of database.operations) {
    if (row.operation === "prepare" || row.operation === "bind") {
      result.bridgeCalls += row.calls;
      result.bridgeWallMs += row.wallMs;
    } else {
      result.queryCalls += row.calls;
      result.queryWallMs += row.wallMs;
    }
  }
  result.sqlStatements = database.sqlStatementsKnown + database.sqlStatementsUnknown;
  result.sqlMs = database.sqlMs;
  result.providerCalls = provider.calls;
  result.providerWallMs = provider.wallMs;
  return result;
}
export const nativeRecoveryMeasurementsSchema = z.strictObject({
  active: recoveryStep.nullable(),
  activeMs: duration.nullable(),
  activeWork: recoveryWorkSchema.nullable(),
  completed: z
    .array(z.strictObject({ step: recoveryStep, durationMs: duration, work: recoveryWorkSchema }))
    .max(11),
});
export function createNativeRecoveryMeasurements(clock = () => performance.now()) {
  let active: (typeof nativeRecoverySteps)[number] | null = null,
    started = 0;
  let read = emptyWork,
    baseline = emptyWork();
  const completed: z.infer<typeof nativeRecoveryMeasurementsSchema>["completed"] = [];
  const delta = () => {
    const current = read(),
      result = emptyWork();
    for (const key of Object.keys(result) as (keyof RecoveryWork)[]) {
      result[key] = Math.max(0, Math.round((current[key] - baseline[key]) * 1000) / 1000);
    }
    return result;
  };
  return {
    observe(observe: () => RecoveryWork) {
      read = observe;
    },
    async run<T>(step: (typeof nativeRecoverySteps)[number], action: () => Promise<T>) {
      if (active || !nativeRecoverySteps.includes(step))
        throw new Error("Invalid native recovery step");
      active = step;
      started = clock();
      baseline = read();
      try {
        return await action();
      } finally {
        if (completed.length < 11)
          completed.push({
            step,
            durationMs: Math.max(0, Math.round(clock() - started)),
            work: delta(),
          });
        active = null;
      }
    },
    snapshot() {
      return {
        active,
        activeMs: active ? Math.max(0, Math.round(clock() - started)) : null,
        activeWork: active ? delta() : null,
        completed: completed.map((row) => ({ ...row, work: { ...row.work } })),
      };
    },
  };
}

export const nativeHostMeasurementsSchema = z.strictObject({
  rssBytes: count,
  heapUsedBytes: count,
  userCpuMicros: count,
  systemCpuMicros: count,
});
export function nativeHostMeasurements() {
  const memory = process.memoryUsage(),
    cpu = process.cpuUsage();
  // Host process only: excludes child workerd CPU and memory; no environment or handles.
  return {
    rssBytes: memory.rss,
    heapUsedBytes: memory.heapUsed,
    userCpuMicros: cpu.user,
    systemCpuMicros: cpu.system,
  };
}

export const nativeProviderMeasurementsSchema = z.strictObject({
  calls: count,
  wallMs: duration,
  maximumWallMs: duration,
});
