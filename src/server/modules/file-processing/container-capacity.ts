/** A namespace-wide physical slot, independent of cost observations. The slot
 * survives a coordinator restart and is never freed by elapsed time alone. */
export type ProcessorCapacityHolder = { instance: string; token: string; since: number };
type CapacityPort = {
  read(): Promise<ProcessorCapacityHolder | null>;
  replace(
    expected: ProcessorCapacityHolder | null,
    next: ProcessorCapacityHolder | null,
  ): Promise<boolean>;
  stop(instance: string, token: string): Promise<void>;
  now(): number;
};

export function sameCapacityHolder(
  left: ProcessorCapacityHolder | null,
  right: ProcessorCapacityHolder | null,
) {
  return (
    left === right ||
    (!!left &&
      !!right &&
      left.instance === right.instance &&
      left.token === right.token &&
      left.since === right.since)
  );
}

export function createProcessorCapacity(port: CapacityPort) {
  return {
    async claim(instance: string, token: string): Promise<boolean> {
      const previous = await port.read();
      if (previous?.instance === instance && previous.token === token) return true;
      if (previous) {
        if (port.now() - previous.since < 265_000) return false;
        // An abandoned caller may still own a native process. Stop it and wait
        // for its cleanup receipt before considering another start.
        await port.stop(previous.instance, previous.token);
        await port.replace(previous, null);
      }
      return port.replace(null, { instance, token, since: port.now() });
    },
    async release(instance: string, token: string) {
      const previous = await port.read();
      if (!previous || previous.instance !== instance || previous.token !== token) return;
      await port.replace(previous, null);
    },
  };
}

/** Waiting consumes the existing request deadline; it never starts another
 * provider attempt. Abort must also interrupt the polling delay. */
export async function waitForProcessorCapacity(
  claim: () => Promise<boolean>,
  signal: AbortSignal,
  intervalMs = 1_000,
) {
  while (!signal.aborted) {
    if (await claim()) {
      if (signal.aborted) throw new Error("ABORTED");
      return;
    }
    await new Promise<void>((resolve) => {
      if (signal.aborted) return resolve();
      const done = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", done);
        resolve();
      };
      const timer = setTimeout(done, intervalMs);
      signal.addEventListener("abort", done, { once: true });
    });
  }
  throw new Error("ABORTED");
}
