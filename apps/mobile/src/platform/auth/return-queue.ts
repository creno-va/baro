/** Ephemeral handoff only: no return URL enters route params, storage or logs. */
export function createAuthReturnQueue() {
  let pending: string[] = [];
  let receiver: ((raw: string) => Promise<void>) | undefined;
  const flush = () => {
    const target = receiver;
    if (!target) return;
    const queued = pending;
    pending = [];
    for (const raw of queued) void target(raw).catch(() => {});
  };
  return {
    push(raw: string) {
      pending = [...new Set([...pending, raw])].slice(-4);
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
