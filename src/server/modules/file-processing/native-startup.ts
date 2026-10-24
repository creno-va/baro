import { processorFailureCategory } from "./container-diagnostics";

export interface NativeStartupPort {
  running(): boolean;
  start(): void;
  monitor(): Promise<void>;
  ready(signal: AbortSignal): Promise<boolean>;
  configureIdle(): Promise<void>;
}

function aborted() {
  return new Error("ABORTED");
}
function deadline() {
  return new Error("Container did not start after 20000ms");
}

async function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw aborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(aborted());
    signal.addEventListener("abort", abort, { once: true });
    void work.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

async function pause(signal: AbortSignal) {
  await new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, 300);
    signal.addEventListener("abort", finish, { once: true });
    if (signal.aborted) finish();
  });
}

/** Readiness never sends source bytes. Only a confirmed unavailable allocation
 * may be requested again, within the existing15s allocation/20s total budget.
 * Once the VM/port is observed, an exited process is a real failed attempt. */
export async function startNativeProcessor(
  port: NativeStartupPort,
  signal: AbortSignal,
  options: { now?: () => number; pause?: (signal: AbortSignal) => Promise<void> } = {},
) {
  const now = options.now ?? (() => performance.now());
  const wait = options.pause ?? pause;
  const began = now();
  const total = AbortSignal.any([signal, AbortSignal.timeout(20_000)]);
  if (total.aborted) throw aborted();
  if (port.running()) throw new Error("Container still running after reset");
  await abortable(port.configureIdle(), total);
  let allocated = false,
    starts = 0,
    generation = 0;
  let lastError: unknown;
  let stopped: { error: unknown } | null = null;
  const readStop = (): { error: unknown } | null => stopped;
  const unavailable = (error: unknown) =>
    processorFailureCategory(error) === "instance_unavailable";
  for (let round = 0; round < 67 && now() - began < 20_000; round++) {
    if (total.aborted) throw signal.aborted ? aborted() : deadline();
    const observed = readStop();
    if (!allocated && now() - began >= 15_000) {
      const cause = observed?.error ?? lastError;
      throw unavailable(cause) ? cause : deadline();
    }
    if (!port.running()) {
      if (allocated || (starts && !unavailable(observed?.error ?? lastError)))
        throw observed?.error ?? new Error("Container exited before readiness");
      if (starts >= 50 || now() - began >= 15_000) throw deadline();
      const current = ++generation;
      stopped = null;
      starts++;
      try {
        port.start();
        void port.monitor().then(
          () => {
            if (generation === current)
              stopped = { error: new Error("Container exited before readiness") };
          },
          (error: unknown) => {
            if (generation === current) stopped = { error };
          },
        );
      } catch (error) {
        if (!unavailable(error)) throw error;
        lastError = error;
        await wait(total);
        continue;
      }
    }
    try {
      const ping = AbortSignal.any([
        total,
        AbortSignal.timeout(Math.min(5_000, Math.max(1, 20_000 - (now() - began)))),
      ]);
      if (ping.aborted) throw aborted();
      if (await abortable(port.ready(ping), ping)) {
        if (total.aborted || now() - began >= 20_000) throw signal.aborted ? aborted() : deadline();
        const currentStop = readStop();
        if (currentStop || !port.running())
          throw currentStop?.error ?? new Error("Container exited before readiness");
        return;
      }
      allocated = true;
    } catch (error) {
      if (total.aborted) throw signal.aborted ? aborted() : deadline();
      lastError = error;
      if (processorFailureCategory(error) === "port_not_ready") allocated = true;
      const observed = readStop();
      if (observed && !unavailable(observed.error))
        throw observed.error ?? new Error("Container exited before readiness");
    }
    await wait(total);
  }
  throw signal.aborted ? aborted() : deadline();
}
