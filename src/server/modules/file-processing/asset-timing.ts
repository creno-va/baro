const stages = [
  "initialization",
  "lease_acquisition",
  "source_authorization",
  "original_open",
  "processor_roundtrip",
  "output_preparation",
  "output_stream_put",
  "publication",
  "cleanup",
  "failure_record",
] as const;
type AssetStage = (typeof stages)[number];
export type AssetStageTiming = { stage: AssetStage; durationMs: number };

/** Exclusive wall-time spans for private Workflow history. No source, identity,
 * provider headers or error data is accepted. Roundtrip/stream time includes
 * authorization, backpressure and cleanup; it is never native CPU or billing. */
export function createAssetTiming(clock = () => performance.now()) {
  const timings: AssetStageTiming[] = [];
  let current: { stage: AssetStage; started: number } | undefined;
  const leave = () => {
    const previous = current;
    current = undefined;
    if (!previous) return;
    try {
      const elapsed = clock() - previous.started;
      if (Number.isSafeInteger(Math.round(elapsed)) && elapsed >= 0 && timings.length < 32)
        timings.push({ stage: previous.stage, durationMs: Math.round(elapsed) });
    } catch {
      // An unavailable clock must not affect transport, publication or cleanup.
    }
  };
  return {
    enter(stage: AssetStage) {
      if (current?.stage === stage) return;
      leave();
      if (!stages.includes(stage)) return;
      try {
        const started = clock();
        if (Number.isFinite(started)) current = { stage, started };
      } catch {
        // No fabricated zero duration for an unavailable observation.
      }
    },
    leave,
    finish() {
      leave();
      return timings.map((timing) => ({ ...timing }));
    },
  };
}
export type AssetTiming = ReturnType<typeof createAssetTiming>;
