import type { SessionModel } from "../../features/session/model";
import type { createAuthReturnQueue } from "./return-queue";

export function bindSessionLifecycle(dependencies: {
  model: SessionModel;
  returns: ReturnType<typeof createAuthReturnQueue>;
  currentState: () => string | null;
  subscribe: (listener: (state: string) => void) => () => void;
  receiveSpecialReturn?: (raw: string) => Promise<boolean>;
}) {
  let live = true;
  let pendingReturns = 0;
  const resume = () => {
    if (live && !pendingReturns && dependencies.currentState() === "active")
      void dependencies.model.resume();
  };
  if (dependencies.currentState() !== "active") dependencies.model.pause();
  const unsubscribeReturn = dependencies.returns.subscribe(async (raw) => {
    pendingReturns++;
    try {
      const handled = dependencies.receiveSpecialReturn
        ? await dependencies.receiveSpecialReturn(raw)
        : false;
      if (!handled) await dependencies.model.receiveReturn(raw);
    } finally {
      pendingReturns--;
      resume();
    }
  });
  const unsubscribe = dependencies.subscribe((state) => {
    if (state === "active") resume();
    else dependencies.model.pause();
  });
  // A queued cold return reserves this gate synchronously, including while a
  // separate deletion journal is being checked before the normal auth lookup.
  resume();
  return () => {
    live = false;
    unsubscribeReturn();
    unsubscribe();
    dependencies.model.pause();
  };
}
