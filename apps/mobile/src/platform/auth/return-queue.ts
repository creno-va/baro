/** Ephemeral handoff only: no return URL enters route params, storage or logs. */
export function createAuthReturnQueue() {
  let pending: string | undefined;
  let receiver: ((raw: string) => Promise<void>) | undefined;
  const flush = () => {
    const raw = pending,
      target = receiver;
    if (!raw || !target) return;
    pending = undefined;
    void target(raw).catch(() => {});
  };
  return {
    push(raw: string) {
      pending = raw;
      flush();
    },
    subscribe(next: (raw: string) => Promise<void>) {
      receiver = next;
      flush();
      return () => {
        if (receiver === next) receiver = undefined;
      };
    },
  };
}
