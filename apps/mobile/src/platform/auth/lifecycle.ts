import type { SessionModel } from "../../features/session/model";
import type { createAuthReturnQueue } from "./return-queue";

export function bindSessionLifecycle(dependencies: {
  model: SessionModel;
  returns: ReturnType<typeof createAuthReturnQueue>;
  currentState: () => string | null;
  subscribe: (listener: (state: string) => void) => () => void;
}) {
  let live = true;
  const resume = () => {
    if (live && dependencies.currentState() === "active") void dependencies.model.resume();
  };
  if (dependencies.currentState() !== "active") dependencies.model.pause();
  const unsubscribeReturn = dependencies.returns.subscribe(async (raw) => {
    await dependencies.model.receiveReturn(raw);
    resume();
  });
  const unsubscribe = dependencies.subscribe((state) => {
    if (state === "active") resume();
    else dependencies.model.pause();
  });
  // A queued cold return begins its ownership lookup synchronously and prevents
  // this foreground refresh from superseding the exchange.
  resume();
  return () => {
    live = false;
    unsubscribeReturn();
    unsubscribe();
    dependencies.model.pause();
  };
}
