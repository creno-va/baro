import type { SessionModel } from "../../features/session/model";

/** Background checking hides UI but does not unlink a file already handed to a native preview/share sheet. */
export function bindPrivateFileLifecycle(
  session: Pick<SessionModel, "getSnapshot" | "subscribe">,
  reset: () => Promise<void>,
) {
  let identity: string | undefined;
  const clear = () => {
    void reset().catch(() => {});
  };
  clear();
  const observe = () => {
    const state = session.getSnapshot();
    const next = ["anonymous", "error", "authorizing"].includes(state.phase)
      ? "closed"
      : state.session?.user
        ? `${state.session.user.id}:${state.session.user.accountType}:${state.session.needsConsent}`
        : undefined;
    if (next === undefined) return;
    if (identity !== undefined && next !== identity) clear();
    identity = next;
  };
  observe();
  return session.subscribe(observe);
}
