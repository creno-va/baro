import { AsyncLocalStorage } from "node:async_hooks";
import { observeD1Awaits } from "../../db/observe-d1-awaits";
import type { PrivateBucket } from "../files/service";

const phases = ["prepare_publication", "stage_result"] as const;
type Phase = (typeof phases)[number];
const maximum = 1_000_000_000;
const bounded = (value: number) =>
  Number.isFinite(value) && value >= 0 && value <= maximum ? value : null;
const milliseconds = (value: number) => {
  const valid = bounded(value);
  return valid === null ? null : Math.round(valid * 1000) / 1000;
};
const counter = () => ({ calls: 0, failed: 0, timedCalls: 0, waitMs: 0 });
type Counter = ReturnType<typeof counter>;
type Observation = { sealed: boolean; d1: Counter; r2: Counter };

/** Preview-only sums of existing method awaits, not pure network time. R2 body
 * consumption, crypto and all other work remain in overall time. Concurrent
 * awaits may overlap, so these sums must not be subtracted as a partition.
 * No SQL, bindings, object keys, results or exception details are retained. */
export function createFilePhaseObservation(
  database: D1Database,
  bucket: PrivateBucket,
  environment: string,
  clock: () => number = () => performance.now(),
) {
  if (environment !== "preview") return null;
  const storage = new AsyncLocalStorage<Observation>();
  const now = () => {
    try {
      const value = clock();
      return Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER
        ? value
        : null;
    } catch {
      return null;
    }
  };
  const elapsed = (started: number | null, ended: number | null) =>
    started === null || ended === null ? null : milliseconds(ended - started);
  const capture = async <T>(kind: "d1" | "r2", action: () => Promise<T>): Promise<T> => {
    const observation = storage.getStore();
    if (!observation || observation.sealed) return action();
    const work = observation[kind];
    const started = now();
    work.calls++;
    try {
      return await action();
    } catch (error) {
      if (!observation.sealed) work.failed++;
      throw error;
    } finally {
      if (!observation.sealed) {
        const duration = elapsed(started, now());
        if (duration !== null) {
          work.timedCalls++;
          work.waitMs += duration;
        }
      }
    }
  };
  const observedBucket = {
    get: (...args: Parameters<PrivateBucket["get"]>) => capture("r2", () => bucket.get(...args)),
    put: (...args: Parameters<PrivateBucket["put"]>) => capture("r2", () => bucket.put(...args)),
    head: (...args: Parameters<PrivateBucket["head"]>) => capture("r2", () => bucket.head(...args)),
    delete: (...args: Parameters<PrivateBucket["delete"]>) =>
      capture("r2", () => bucket.delete(...args)),
  } as PrivateBucket;
  return {
    database: observeD1Awaits(database, (_statements, action) => capture("d1", action)),
    bucket: observedBucket,
    async measure<T>(phase: Phase, action: () => Promise<T>): Promise<T> {
      if (!phases.includes(phase)) return action();
      const observation = { sealed: false, d1: counter(), r2: counter() };
      const started = now();
      let outcome: "success" | "failure" = "failure";
      try {
        const result = await storage.run(observation, action);
        outcome = "success";
        return result;
      } finally {
        observation.sealed = true;
        try {
          const overallMs = elapsed(started, now());
          const d1Calls = bounded(observation.d1.calls);
          const d1Failed = bounded(observation.d1.failed);
          const d1TimedCalls = bounded(observation.d1.timedCalls);
          const d1AwaitMs = d1TimedCalls ? milliseconds(observation.d1.waitMs) : null;
          const r2Calls = bounded(observation.r2.calls);
          const r2Failed = bounded(observation.r2.failed);
          const r2TimedCalls = bounded(observation.r2.timedCalls);
          const r2AwaitMs = r2TimedCalls ? milliseconds(observation.r2.waitMs) : null;
          console.info(
            JSON.stringify({
              event: "preview_file_phase_awaits",
              phase,
              outcome,
              overallMs,
              d1Calls,
              d1Failed,
              d1TimedCalls,
              d1AwaitMs,
              r2Calls,
              r2Failed,
              r2TimedCalls,
              r2AwaitMs,
            }),
          );
        } catch {
          // Observation failure cannot change the original result or exception.
        }
      }
    },
  };
}
