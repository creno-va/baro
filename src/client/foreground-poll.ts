/** Polling only reads server state. Closing the page never cancels the job.
 * Browser timers can be suspended in background tabs or in the back/forward cache. */
export function startForegroundPolling(read: () => Promise<unknown>, interval: number) {
  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout>;
  const poll = async () => {
    clearTimeout(timer);
    if (stopped || running) return;
    running = true;
    try {
      if (!document.hidden) await read();
    } catch {
      // The caller owns its error UI. A read failure must not end recovery.
    } finally {
      running = false;
      if (!stopped) timer = setTimeout(() => void poll(), interval);
    }
  };
  const foreground = () => {
    if (!document.hidden) void poll();
  };
  timer = setTimeout(() => void poll(), interval);
  document.addEventListener("visibilitychange", foreground);
  window.addEventListener("pageshow", foreground);
  window.addEventListener("online", foreground);
  return () => {
    stopped = true;
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", foreground);
    window.removeEventListener("pageshow", foreground);
    window.removeEventListener("online", foreground);
  };
}
