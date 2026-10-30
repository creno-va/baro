import type { WorkspaceDependencies } from "./service";

/** Only scheduling is request-scoped. The admitted operation and outbox are
 * durable, and cron reconciles the same immutable Workflow ID after a disconnect. */
export function backgroundDispatch(
  dependencies: WorkspaceDependencies,
  waitUntil: (work: Promise<unknown>) => void,
): WorkspaceDependencies {
  const dispatch = dependencies.dispatch;
  if (!dispatch) return dependencies;
  return {
    ...dependencies,
    dispatch: async () => {
      try {
        waitUntil(
          Promise.resolve()
            .then(dispatch)
            .catch(() => undefined),
        );
      } catch {
        // A missing HTTP context does not undo the committed outbox.
      }
    },
  };
}
