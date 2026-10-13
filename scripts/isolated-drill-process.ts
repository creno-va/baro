import { resolve } from "node:path";

export type DrillCommandObservation = {
  runtime: "node";
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  durationMs: number;
  stdoutBytes: number;
  stderrBytes: number;
};
export class DrillCommandError extends Error {
  constructor(
    code: "WRANGLER_COMMAND_FAILED" | "WRANGLER_OUTCOME_UNKNOWN",
    readonly observation: DrillCommandObservation,
  ) {
    super(code);
  }
}

/** Fixed Node CLI entry avoids the upstream wrapper's null/signal exit -> 0 conversion.
 * The optional entry is a local subprocess test seam, never supplied by workflow inputs.
 * Output is drained to byte counts; no raw diagnostic text is retained or forwarded.
 */
export async function runDrillWrangler(
  args: string[],
  timeout: number,
  environment = process.env,
  entry = resolve("node_modules/wrangler/wrangler-dist/cli.js"),
): Promise<DrillCommandObservation> {
  const started = performance.now();
  const observation: DrillCommandObservation = {
    runtime: "node",
    exitCode: null,
    signal: null,
    timedOut: false,
    durationMs: 0,
    stdoutBytes: 0,
    stderrBytes: 0,
  };
  if (!Number.isFinite(timeout) || timeout <= 0)
    throw new DrillCommandError("WRANGLER_OUTCOME_UNKNOWN", observation);
  let child: ReturnType<typeof Bun.spawn> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function drain(stream: ReadableStream<Uint8Array>, field: "stdoutBytes" | "stderrBytes") {
    const reader = stream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        observation[field] = Math.min(
          Number.MAX_SAFE_INTEGER,
          observation[field] + value.byteLength,
        );
      }
    } finally {
      reader.releaseLock();
    }
  }
  try {
    const result = Bun.spawn(["node", "--no-warnings", entry, ...args], {
      env: { ...environment, WRANGLER_SEND_METRICS: "false", CI: "true" },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    child = result;
    timer = setTimeout(() => {
      observation.timedOut = true;
      result.kill("SIGKILL");
    }, timeout);
    await Promise.all([
      drain(result.stdout, "stdoutBytes"),
      drain(result.stderr, "stderrBytes"),
      result.exited,
    ]);
    observation.exitCode = result.exitCode;
    observation.signal = result.signalCode;
    if (observation.timedOut || observation.signal)
      throw new DrillCommandError("WRANGLER_OUTCOME_UNKNOWN", observation);
    if (observation.exitCode !== 0)
      throw new DrillCommandError("WRANGLER_COMMAND_FAILED", observation);
    return observation;
  } catch (error) {
    if (error instanceof DrillCommandError) throw error;
    child?.kill("SIGKILL");
    if (child) await child.exited;
    throw new DrillCommandError("WRANGLER_COMMAND_FAILED", observation);
  } finally {
    clearTimeout(timer);
    observation.durationMs = Math.round(performance.now() - started);
  }
}
