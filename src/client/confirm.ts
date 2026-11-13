type Pending = {
  message: string;
  resolve: (confirmed: boolean) => void;
  source: Element | null;
  path: string;
};
let pending: Pending | null = null;
const listeners = new Set<() => void>();
function publish() {
  for (const listener of listeners) listener();
}
export function confirmAction(message: string): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (pending) return Promise.resolve(false);
  return new Promise((resolve) => {
    pending = { message, resolve, source: document.activeElement, path: location.pathname };
    publish();
  });
}
export function confirmation() {
  return pending;
}
export function subscribeConfirmation(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function resolveConfirmation(confirmed: boolean) {
  const request = pending;
  pending = null;
  publish();
  if (request)
    request.resolve(
      confirmed && request.path === location.pathname && Boolean(request.source?.isConnected),
    );
}
