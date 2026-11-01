import { fileURLToPath } from "node:url";

const MAX_INPUT = 20_000_000;
const MAX_OUTPUT = 24_000_000;
const RENDER_TIMEOUT = 240_000;
const CONTROL_TIMEOUT = 10_000;
const IMAGE = "baro-report-rendering:latest";
const renderer = fileURLToPath(new URL("../../services/file-processor/report.py", import.meta.url));
const python = `import logging, signal, sys
logging.disable(logging.CRITICAL)
signal.alarm(240)
try:
    from report import render
    source = sys.stdin.buffer.read(20000001)
    if len(source) > 20000000:
        raise ValueError("LIMIT")
    sys.stdout.buffer.write(render(source.decode("utf-8")))
except Exception:
    sys.stderr.write("REWORK_PDF_RENDER_FAILED\\n")
    sys.exit(1)
`;

type Failure =
  | "REWORK_PDF_INPUT_LIMIT"
  | "REWORK_PDF_OUTPUT_LIMIT"
  | "REWORK_PDF_START_FAILED"
  | "REWORK_PDF_RENDER_FAILED"
  | "REWORK_PDF_TIMEOUT"
  | "REWORK_PDF_CLEANUP_FAILED";
export class ReworkPdfProcessorError extends Error {
  constructor(readonly code: Failure) {
    super(code);
    this.name = "ReworkPdfProcessorError";
  }
}

async function collect(
  stream: ReadableStream<Uint8Array>,
  limit: number,
  code: Failure,
): Promise<Uint8Array<ArrayBuffer>> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > limit) throw new ReworkPdfProcessorError(code);
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function control(args: string[]) {
  const child = Bun.spawn(["docker", ...args], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: CONTROL_TIMEOUT,
    killSignal: "SIGKILL",
    maxBuffer: 16384,
  });
  try {
    const [status, output, error] = await Promise.all([
      child.exited,
      collect(child.stdout, 4096, "REWORK_PDF_START_FAILED"),
      collect(child.stderr, 8192, "REWORK_PDF_START_FAILED"),
    ]);
    return {
      status,
      output: new TextDecoder().decode(output),
      error: new TextDecoder().decode(error),
    };
  } finally {
    child.kill("SIGKILL");
    await child.exited;
  }
}

/** Actual offline native port for FILE_PROCESSOR /report. HTML is streamed
 * unchanged to the product render function. No provider, storage, authority or
 * cost behavior is replaced here; the calling Hono fixture owns those paths.
 * timeoutMs can shorten the native deadline for failure tests, never extend it. */
export async function renderReworkPdf(
  source: string,
  options: { timeoutMs?: number } = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const timeout = options.timeoutMs ?? RENDER_TIMEOUT;
  if (
    typeof source !== "string" ||
    source.length > MAX_INPUT ||
    !Number.isSafeInteger(timeout) ||
    timeout < 1 ||
    timeout > RENDER_TIMEOUT
  )
    throw new ReworkPdfProcessorError("REWORK_PDF_INPUT_LIMIT");
  const input = new TextEncoder().encode(source);
  if (input.byteLength > MAX_INPUT) throw new ReworkPdfProcessorError("REWORK_PDF_INPUT_LIMIT");
  const name = `baro-rework-pdf-${crypto.randomUUID()}`;
  let result: Uint8Array<ArrayBuffer> | undefined;
  let failure: ReworkPdfProcessorError | undefined;
  try {
    const created = await control([
      "create",
      "--pull=never",
      "--rm",
      "--name",
      name,
      "--label",
      `baro-rework-pdf-owner=${process.pid}`,
      "--network",
      "none",
      "--user",
      "node",
      "--memory",
      "6g",
      "--cpus",
      "1",
      "--pids-limit",
      "128",
      "--cap-drop",
      "ALL",
      "--read-only",
      "--tmpfs",
      "/tmp:rw,nosuid,nodev,size=256m",
      "--env",
      "XDG_CACHE_HOME=/tmp",
      "--env",
      "PYTHONDONTWRITEBYTECODE=1",
      "--mount",
      `type=bind,source=${renderer},target=/app/report.py,readonly`,
      "--workdir",
      "/app",
      "--interactive",
      IMAGE,
      "python3",
      "-c",
      python,
    ]);
    if (created.status !== 0 || !/^[a-f0-9]{64}$/u.test(created.output.trim()))
      throw new ReworkPdfProcessorError("REWORK_PDF_START_FAILED");
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeout);
    let child: ReturnType<typeof Bun.spawn<Blob, "pipe", "pipe">> | undefined;
    try {
      child = Bun.spawn(["docker", "start", "--attach", "--interactive", name], {
        stdin: new Blob([input]),
        stdout: "pipe",
        stderr: "pipe",
        signal: abort.signal,
        timeout: timeout + 1000,
        killSignal: "SIGKILL",
        maxBuffer: MAX_OUTPUT,
      });
      const [status, output] = await Promise.all([
        child.exited,
        collect(child.stdout, MAX_OUTPUT, "REWORK_PDF_OUTPUT_LIMIT"),
        collect(child.stderr, 8192, "REWORK_PDF_RENDER_FAILED"),
      ]);
      if (abort.signal.aborted) throw new ReworkPdfProcessorError("REWORK_PDF_TIMEOUT");
      if (status !== 0 || new TextDecoder().decode(output.subarray(0, 5)) !== "%PDF-")
        throw new ReworkPdfProcessorError("REWORK_PDF_RENDER_FAILED");
      result = output;
    } finally {
      clearTimeout(timer);
      child?.kill("SIGKILL");
      await child?.exited;
    }
  } catch (cause) {
    failure =
      cause instanceof ReworkPdfProcessorError
        ? cause
        : new ReworkPdfProcessorError("REWORK_PDF_RENDER_FAILED");
  } finally {
    try {
      const removed = await control(["rm", "--force", name]);
      if (removed.status !== 0 && !/No such container:/iu.test(removed.error))
        failure = new ReworkPdfProcessorError("REWORK_PDF_CLEANUP_FAILED");
    } catch {
      failure = new ReworkPdfProcessorError("REWORK_PDF_CLEANUP_FAILED");
    }
  }
  if (failure) throw failure;
  if (!result) throw new ReworkPdfProcessorError("REWORK_PDF_RENDER_FAILED");
  return result;
}
