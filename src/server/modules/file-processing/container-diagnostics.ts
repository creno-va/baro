const stages = [
  "revocation_read",
  "reset",
  "startup",
  "dispatch",
  "response",
  "stream",
  "cleanup",
] as const;
type ProcessorStage = (typeof stages)[number];
const reported = new WeakSet<object>();

/** Match the pinned SDK/platform messages locally; never serialize their text. */
export function processorFailureCategory(error: unknown) {
  try {
    const message =
      typeof error === "string"
        ? error
        : error && typeof error === "object" && "message" in error
          ? error.message
          : "";
    if (typeof message !== "string") return "unknown";
    if (/there is no container instance that can be provided/i.test(message))
      return "instance_unavailable";
    if (/you are requesting too many containers per second/i.test(message))
      return "start_rate_limited";
    if (/container is not listening|failed to verify port/i.test(message)) return "port_not_ready";
    if (/container (?:exited|crashed)|runtime signalled the container to exit/i.test(message))
      return "instance_stopped";
    if (/network connection lost/i.test(message)) return "connection_lost";
    if (/container did not start after/i.test(message)) return "startup_timeout";
    if (
      /^(?:ABORTED|REVOKED)$|aborted waiting for container|container request aborted/i.test(
        message,
      ) ||
      (error && typeof error === "object" && "name" in error && error.name === "AbortError")
    )
      return "cancelled";
    if (message === "INVALID_OUTPUT") return "invalid_output";
    if (message === "NATIVE_RESPONSE_FAILED") return "native_response_failed";
    return "unknown";
  } catch {
    return "unknown";
  }
}

/** Worker telemetry only. Native output, headers, request identities and error
 * objects never reach logs, even when the SDK embeds them in its exception. */
export function reportProcessorFailure(
  stage: string,
  error: unknown,
  durationMs: number,
  httpStatus?: number,
) {
  try {
    if (error && typeof error === "object") {
      if (reported.has(error)) return;
      reported.add(error);
    }
    console.error(
      JSON.stringify({
        event: "file_processor_failure",
        stage: stages.includes(stage as ProcessorStage) ? stage : "unclassified",
        category: processorFailureCategory(error),
        durationMs: Number.isFinite(durationMs)
          ? Math.min(3_600_000, Math.max(0, Math.round(durationMs)))
          : null,
        httpStatus:
          typeof httpStatus === "number" &&
          Number.isInteger(httpStatus) &&
          httpStatus >= 400 &&
          httpStatus <= 599
            ? httpStatus
            : null,
      }),
    );
  } catch {
    // Diagnostic transport cannot alter cleanup, cancellation or access checks.
  }
}

export async function processorStage<T>(stage: ProcessorStage, action: () => Promise<T>) {
  const started = performance.now();
  try {
    return await action();
  } catch (error) {
    reportProcessorFailure(stage, error, performance.now() - started);
    throw error;
  }
}
