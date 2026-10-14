const phases = [
  "bootstrap",
  "schema",
  "provision",
  "baseline",
  "migration",
  "advance",
  "recovery",
  "summary",
  "chat",
  "replay",
  "cleanup",
] as const;
const boundaries = [
  "get_d1",
  "migrate",
  "provision",
  "seed",
  "create",
  "request",
  "prepare_job",
  "dispatch",
  "receipt",
  "runtime",
  "runtime_receipts",
  "readback",
  "copy",
  "rollback",
  "upgrade",
  "dispose",
] as const;
type Phase = (typeof phases)[number];
type Boundary = (typeof boundaries)[number];
type Counters = {
  activeCostLimitsEnabled?: boolean;
  providerCalls?: number;
  requestOrdinal?: number;
  databaseTrace?: {
    operation?: string;
    state?: string;
    measurementMetadataPresent?: boolean | null;
    maximumBoundParameters?: number;
    maximumBatchStatements?: number;
  };
};
const count = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
const member = (value: unknown, allowed: readonly string[]) =>
  typeof value === "string" && allowed.includes(value) ? value : null;

/** One failure/slow snapshot from memory only; never accepts SQL, IDs or errors.
 * The 25s timer may itself be delayed by a synchronous native bridge wait.
 * The test's afterEach fallback reports an incomplete test if that timer cannot run. */
export function createNativeProgress(
  applicationCostLimitsEnabled: boolean,
  options: {
    clock?: () => number;
    emit?: (snapshot: unknown) => void;
    schedule?: (callback: () => void, delay: number) => unknown;
    cancel?: (timer: unknown) => void;
  } = {},
) {
  const clock = options.clock ?? (() => performance.now());
  const now = () => {
    try {
      const value = clock();
      return Number.isFinite(value) ? value : null;
    } catch {
      return null;
    }
  };
  const elapsed = (from: number | null, at: number | null) =>
    from === null || at === null ? null : count(Math.round(at - from));
  const started = now();
  let phase: Phase = "bootstrap",
    boundary: Boundary = "get_d1";
  let phaseStarted = started,
    boundaryStarted = started,
    reported = false,
    finished = false;
  let observe: () => Counters = () => ({});
  const completedPhases: { phase: Phase; durationMs: number | null }[] = [];
  const cancel = (timer: unknown) => {
    try {
      if (options.cancel) options.cancel(timer);
      else clearTimeout(timer as ReturnType<typeof setTimeout>);
    } catch {
      /* Diagnostic cleanup cannot replace the test result. */
    }
  };
  const report = (reason: "slow" | "failure" | "incomplete_test") => {
    if (reported || finished || !["slow", "failure", "incomplete_test"].includes(reason)) return;
    reported = true;
    cancel(timer);
    try {
      const at = now(),
        counters = observe(),
        trace = counters.databaseTrace;
      (options.emit ?? ((snapshot) => console.error(JSON.stringify(snapshot))))({
        event: "native_runtime_progress",
        reason,
        requestedCostLimitsEnabled: applicationCostLimitsEnabled,
        activeCostLimitsEnabled:
          typeof counters.activeCostLimitsEnabled === "boolean"
            ? counters.activeCostLimitsEnabled
            : null,
        elapsedMs: elapsed(started, at),
        timerDelayMs:
          at === null || started === null
            ? null
            : count(Math.round(Math.max(0, at - started - 25000))),
        phase,
        phaseElapsedMs: elapsed(phaseStarted, at),
        boundary,
        boundaryElapsedMs: elapsed(boundaryStarted, at),
        completedPhases: completedPhases.map((value) => ({ ...value })),
        providerCalls: count(counters.providerCalls),
        requestOrdinal: count(counters.requestOrdinal),
        // Setup/migration also use direct bindings. This is the last measured
        // preview operation, not necessarily the current boundary's database.
        lastMeasuredPreviewTrace: trace
          ? {
              operation: member(trace.operation, [
                "none",
                "prepare",
                "bind",
                "all",
                "run",
                "first",
                "raw",
                "batch",
              ]),
              state: member(trace.state, ["idle", "pending", "completed", "failed"]),
              measurementMetadataPresent:
                typeof trace.measurementMetadataPresent === "boolean"
                  ? trace.measurementMetadataPresent
                  : null,
              maximumBoundParameters: count(trace.maximumBoundParameters),
              maximumBatchStatements: count(trace.maximumBatchStatements),
            }
          : null,
      });
    } catch {
      /* Optional observations cannot change test cleanup. */
    }
  };
  const timer = (options.schedule ?? setTimeout)(() => report("slow"), 25000);
  return {
    observe(read: () => Counters) {
      observe = read;
    },
    enter(nextPhase: Phase, nextBoundary: Boundary) {
      if (finished || !phases.includes(nextPhase) || !boundaries.includes(nextBoundary)) return;
      const at = now();
      if (phase !== nextPhase) {
        if (completedPhases.length < 24)
          completedPhases.push({ phase, durationMs: elapsed(phaseStarted, at) });
        phase = nextPhase;
        phaseStarted = at;
      }
      boundary = nextBoundary;
      boundaryStarted = at;
    },
    boundary(next: Boundary) {
      if (!finished && boundaries.includes(next)) {
        boundary = next;
        boundaryStarted = now();
      }
    },
    report,
    finish(success: boolean) {
      if (!success) report("incomplete_test");
      finished = true;
      cancel(timer);
    },
  };
}
