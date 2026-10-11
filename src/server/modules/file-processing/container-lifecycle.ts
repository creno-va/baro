import { type ProcessorContainerPort, proxyProcessorRequest } from "./container-proxy";

type ActiveRequest = {
  controller: AbortController;
  starting: Promise<void> | null;
  finishing: Promise<void> | null;
};
type NativeLifecyclePort = Omit<ProcessorContainerPort, "stop"> & {
  isRevoked(): Promise<boolean>;
  persistRevoked(): Promise<void>;
  destroy(): Promise<void>;
};

/** Kept outside the platform class so races can be exercised with the same
 * proxy/stream implementation. The durable tombstone contains no case data. */
export function createProcessorLifecycle(port: NativeLifecyclePort) {
  let revoked = false;
  let active: ActiveRequest | null = null;
  let idleCleanup: Promise<void> | null = null;

  function finish(current: ActiveRequest): Promise<void> {
    current.controller.abort();
    if (current.finishing) return current.finishing;
    current.finishing = (async () => {
      // A cancelled start can finish late. Do not acknowledge destruction until
      // that start has settled, and never let it dispatch another raw request.
      await current.starting?.catch(() => {});
      await port.destroy();
      if (active === current) active = null;
    })().catch((error: unknown) => {
      current.finishing = null;
      throw error;
    });
    return current.finishing;
  }

  function stop(): Promise<void> {
    if (active) return finish(active);
    if (!idleCleanup)
      idleCleanup = port.destroy().finally(() => {
        idleCleanup = null;
      });
    return idleCleanup;
  }

  return {
    stop,
    async revoke() {
      revoked = true;
      active?.controller.abort();
      // Persist before issuing a deletion receipt, including after a DO restart.
      // A failed write or destroy is propagated so the journal remains pending.
      await port.persistRevoked();
      await stop();
    },
    async fetch(request: Request): Promise<Response> {
      if (revoked) return Response.json({ code: "REVOKED" }, { status: 410 });
      if (active || idleCleanup) return Response.json({ code: "BUSY" }, { status: 409 });
      const current: ActiveRequest = {
        controller: new AbortController(),
        starting: null,
        finishing: null,
      };
      active = current;
      const response = await proxyProcessorRequest(
        request,
        {
          start(signal) {
            current.starting = (async () => {
              if (await port.isRevoked()) revoked = true;
              if (revoked || signal.aborted) throw new Error("REVOKED");
              // A reconstructed DO may still have an old native process. Every
              // unit starts on an empty instance, never on its leftover plaintext.
              await port.destroy();
              if (revoked || signal.aborted) throw new Error("REVOKED");
              await port.start(signal);
            })();
            return current.starting;
          },
          fetch(incoming) {
            if (revoked || current.controller.signal.aborted) throw new Error("REVOKED");
            return port.fetch(incoming);
          },
          stop: () => finish(current),
        },
        undefined,
        current.controller.signal,
      );
      if (response.status === 400 && active === current) active = null;
      return response;
    },
  };
}
