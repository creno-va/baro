const regions = ["ENAM", "WNAM", "WEUR", "EEUR", "APAC", "OC"] as const;
const maximum = 1_000_000_000;
const number = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= maximum;
// Workers uses the UNIX epoch as performance.timeOrigin (0). Apply the
// telemetry duration ceiling to the difference, never the absolute samples.
const clockSample = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= Number.MAX_SAFE_INTEGER;
const optional = <T>(read: () => T): T | null => {
  try {
    return read();
  } catch {
    return null;
  }
};
const milliseconds = (value: unknown) => (number(value) ? Math.round(value * 1000) / 1000 : null);

/** One existing LIMIT 1 projection at runtime entry. This observes the first
 * call, not a warm-call average or pure network latency. No extra SQL or writes.
 * Production keeps its original first(column) method and never reads metadata. */
export async function readRuntimeAdmission(
  statement: D1PreparedStatement,
  environment: string,
  clock: () => number = () => performance.now(),
): Promise<string | null> {
  if (environment !== "preview") return statement.first<string>("attempt_id");
  const started = optional(clock);
  let result: D1Result<{ attempt_id: string }> | undefined;
  let outcome: "success" | "failure" = "failure";
  try {
    result = await statement.all<{ attempt_id: string }>();
    const attemptId = result.results[0]?.attempt_id ?? null;
    outcome = "success";
    return attemptId;
  } finally {
    // Only this closed set of primitive metadata reaches telemetry. Query text,
    // parameters, result rows, IDs and the original exception are never logged.
    try {
      const ended = optional(clock);
      const wallMs =
        clockSample(started) && clockSample(ended) ? milliseconds(ended - started) : null;
      const meta = optional(() => result?.meta);
      const sqlMs = milliseconds(optional(() => meta?.timings?.sql_duration_ms));
      const regionInput = optional(() => meta?.served_by_region);
      const region = regions.some((allowed) => allowed === regionInput) ? regionInput : null;
      const coloInput = optional(() => meta?.served_by_colo);
      const colo = typeof coloInput === "string" && /^[A-Z]{3}$/.test(coloInput) ? coloInput : null;
      const primaryInput = optional(() => meta?.served_by_primary);
      const primary = typeof primaryInput === "boolean" ? primaryInput : null;
      const attemptsInput = optional(() => meta?.total_attempts);
      const attempts =
        number(attemptsInput) && Number.isSafeInteger(attemptsInput) && attemptsInput > 0
          ? attemptsInput
          : null;
      console.info(
        JSON.stringify({
          event: "preview_file_runtime_d1",
          phase: "runtime_admission",
          outcome,
          wallMs,
          sqlMs,
          region,
          colo,
          primary,
          attempts,
        }),
      );
    } catch {
      // Optional clock, metadata or log failures cannot change the query result.
    }
  }
}
